import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "ssh2";
import {
  buildInteractiveShellCommand,
  getChannelEnvironment,
} from "./backend-shell.mjs";
import { requestAuthContext, sshAuthOptions } from "./backend-ssh-auth.mjs";
import { waitForSshReady } from "./backend-command-operations.mjs";
import { SecretBuffer } from "./secrets.mjs";
import { selectHostKeyVerifier, safeHostLabel } from "./backend-host-keys.mjs";
import { assertHostRequestIsAllowed } from "./backend-host-validation.mjs";
import { bufferPendingInput } from "./backend-buffers.mjs";
import {
  SSH_FAILURE_CODES,
  SshConnectError,
  sshConnectFailure,
} from "./backend-ssh-failure.mjs";

/**
 * How long a session that ended before its shell opened stays in the session
 * map. It is kept so a websocket that attaches after the failure still gets
 * the reason (see failSession); after this it is removed, so failed sessions
 * do not pile up for the life of the backend process.
 */
export const FAILED_SESSION_RETENTION_MS = 60_000;

/**
 * How long a session that authenticated successfully waits for its shell.
 *
 * ssh2's `readyTimeout` bounds the handshake only, and it is cleared once the
 * sign-in succeeds. A server that authenticates and then never answers the
 * channel open left the session in "connecting" for ever: no error, no
 * timeout, and the connection held open. The native shell opens the shell as
 * part of the connect, so it never had this window; the browser backend
 * returns the session id first and opens the shell afterwards.
 *
 * 30s is the same budget the backend already allows an SFTP control
 * operation (SFTP_CONTROL_TIMEOUT_MS), so the two paths time out on the same
 * scale.
 */
export const SHELL_OPEN_TIMEOUT_MS = 30_000;

/**
 * How long a jump host has to open the tunnel to the target host.
 *
 * The tunnel request is a channel open on an established connection, and
 * ssh2 does not bound it. A bastion that accepts the sign-in and then never
 * answers left an authenticated connection open for the life of the backend
 * process, which is the same class of leak the deadline in
 * backend-deadline.mjs exists to close.
 */
export const JUMP_FORWARD_TIMEOUT_MS = 30_000;

export function createSshSessionManager({
  sessions,
  getHostKeyStore,
  closeForwardsForSession,
  broadcast,
  failSession,
  expandHome,
  failedSessionRetentionMs = FAILED_SESSION_RETENTION_MS,
  shellOpenTimeoutMs = SHELL_OPEN_TIMEOUT_MS,
  jumpForwardTimeoutMs = JUMP_FORWARD_TIMEOUT_MS,
}) {
  /**
   * Remove a session and release everything it holds. Safe to call more than
   * once and from any path: the shell's close, the client's close, a
   * websocket closing on a failed session, or the retention timer.
   */
  async function retireSession(session) {
    if (session.retireTimer) {
      clearTimeout(session.retireTimer);
      session.retireTimer = null;
    }
    if (session.shellTimer) {
      clearTimeout(session.shellTimer);
      session.shellTimer = null;
    }
    try {
      await closeForwardsForSession(session.id);
    } finally {
      if (sessions.get(session.id) === session) {
        sessions.delete(session.id);
      }
      session.client.end();
      session.jumpClient?.end();
    }
  }

  async function createConnectConfig(host) {
    // #473: every SSH connection (sessions, file transfer, remote commands,
    // each jump hop) is built here, so these rules cover them all. Checked
    // before anything else, so a refused request opens no connection.
    const authOptions = sshAuthOptions(host, {
      authorizedBy: requestAuthContext.getStore()?.authorizedBy,
      agentSocket: process.env.SSH_AUTH_SOCK,
    });

    // Defense-in-depth: even if a caller bypasses connections.ts (e.g. talks to
    // the backend HTTP API directly), refuse to connect when the host requires
    // a trusted key and we were not given one. See parity-and-hardening-review §3.S-1.
    if (host.hostKeyPolicy === "requireTrusted" && !host.knownHostPublicKey) {
      throw new Error(
        `Trusted host key required for ${host.hostname}:${host.port} but none was provided. Scan and trust the host first.`
      );
    }

    // The host record arrives in the request body, so the parts the backend must
    // not take on trust are checked before anything is done with it: an
    // unrecognised authMethod, and agent forwarding the backend was not
    // authorised to perform. See backend-host-validation.mjs.
    assertHostRequestIsAllowed(host);

    const connectConfig = {
      host: host.hostname,
      port: host.port,
      username: host.username,
      tryKeyboard: false,
      readyTimeout: 10000,
    };

    // Filled in by the verifier when it refuses the host, so the connect path
    // can report why instead of ssh2's bare "Host denied (verification failed)".
    let hostKeyFailure;
    // #489: an approved key decides alone; otherwise trust on first use
    // against the durable store (SEC-2). `hostVerifier` is NEVER left undefined:
    // ssh2's default accepts whatever answers the socket. The verifier runs
    // during the handshake, before authentication, so a refused host never
    // receives the password or the private key, and it fills in `failure` so
    // the connect path can report why.
    const verifier = selectHostKeyVerifier({ host, getStore: getHostKeyStore });
    connectConfig.hostVerifier = verifier.verify;
    hostKeyFailure = verifier.failure;

    Object.assign(connectConfig, authOptions);

    // Secret-handling: wrap any password / passphrase / private-key bytes in a
    // SecretBuffer and remember a scrub callback for each. The caller is
    // responsible for invoking `scrub()` on the returned bundle after
    // ssh2's `client.connect()` has consumed the values (i.e. on both the
    // ready and error edges). See parity-and-hardening-review §3.S-3 / plan
    // P1-S3.
    const cleanups = [];
    const scrubBundle = () => {
      while (cleanups.length > 0) {
        const fn = cleanups.pop();
        try {
          fn();
        } catch {
          // Ignore — best-effort cleanup must not throw.
        }
      }
    };

    if (host.authMethod === "password") {
      // ssh2 only accepts a string for the password field (the implementation
      // explicitly checks `typeof === 'string'`). We keep our own copy as a
      // SecretBuffer; the string version is materialised here, lives on
      // connectConfig.password until scrub, and ssh2 will internalise its own
      // copy synchronously when client.connect() runs.
      const passwordSecret = SecretBuffer.fromString(host.password ?? "");
      connectConfig.password = passwordSecret.asString();
      cleanups.push(() => {
        passwordSecret.scrub();
        // Drop our reference to the materialised string so the V8 heap copy
        // becomes garbage-collectable (does not zero the V8 string itself).
        connectConfig.password = "";
      });
    } else if (host.authMethod === "privateKey") {
      // Read the private key as a Buffer (the default for fs.readFile without
      // an encoding) so we can fill it with zeros after ssh2 has parsed it.
      const keyBuffer = await readFile(expandHome(host.privateKeyPath));
      connectConfig.privateKey = keyBuffer;
      cleanups.push(() => {
        keyBuffer.fill(0);
        connectConfig.privateKey = Buffer.alloc(0);
      });

      if (host.passphrase) {
        // ssh2's parseKey accepts Buffer for the passphrase (used by
        // bcrypt_pbkdf and crypto.createHash().update()), so we can pass the
        // SecretBuffer's underlying Buffer directly.
        const passphraseSecret = SecretBuffer.fromString(host.passphrase);
        connectConfig.passphrase = passphraseSecret.asBuffer();
        cleanups.push(() => {
          passphraseSecret.scrub();
          connectConfig.passphrase = Buffer.alloc(0);
        });
      }
    }

    return { config: connectConfig, scrub: scrubBundle, hostKeyFailure };
  }

  async function openJumpSocket(host, setStage) {
    const jumpClient = await connectClient(host.jumpHost, setStage);

    try {
      const socket = await new Promise((resolve, reject) => {
        // ssh2 does not bound a channel open, so a bastion that accepts the
        // sign-in and then never answers the tunnel request left an
        // authenticated connection open for the life of the backend process.
        // Bound the wait, and release the connection when it expires.
        const timer = setTimeout(() => {
          reject(
            new SshConnectError(
              `The jump host did not open a tunnel to ${safeHostLabel(host.hostname, host.port)} ` +
                `within ${Math.round(jumpForwardTimeoutMs / 1000)} seconds.`,
              { code: SSH_FAILURE_CODES.timeout }
            )
          );
        }, jumpForwardTimeoutMs);
        timer.unref?.();

        jumpClient.forwardOut("127.0.0.1", 0, host.hostname, host.port, (error, stream) => {
          clearTimeout(timer);
          if (error) {
            reject(error);
            return;
          }

          resolve(stream);
        });
      });

      return { jumpClient, socket };
    } catch (error) {
      jumpClient.end();
      throw error;
    }
  }

  async function connectClient(host, setStage) {
    setStage?.("configuration");
    const client = new Client();
    const { config: connectConfig, scrub, hostKeyFailure } = await createConnectConfig(host);
    setStage?.("connect");
    try {
      // Inside the try, so a jump host that refuses to connect still scrubs
      // the credentials this connection was built with. The jump connection
      // uses its own credentials; these belong to the host being reached
      // through it, and they were on the heap for as long as the attempt
      // took.
      const jumpConnection = host.jumpHost ? await openJumpSocket(host, setStage) : undefined;

      if (jumpConnection?.socket) {
        connectConfig.sock = jumpConnection.socket;
      }

      return await waitForSshReady(
        client,
        connectConfig,
        jumpConnection?.jumpClient,
        setStage
      );
    } catch (error) {
      // The client never became usable, and nothing else would close it: the
      // short-lived path (an SFTP operation, a forward, a remote command)
      // threw away the client it built. End it here so a refused or
      // unreachable host does not leave a connection behind.
      client.end();
      // A refused host key is reported with the reason, not ssh2's bare
      // "Host denied (verification failed)".
      if (hostKeyFailure.error) {
        throw hostKeyFailure.error;
      }
      // Every other connection failure is reported with a code and a message
      // the user can act on, instead of "Internal server error.".
      throw sshConnectFailure(error, host);
    } finally {
      // Whether the SSH handshake succeeded or failed, ssh2 has already read
      // password / passphrase / private-key bytes off connectConfig (the
      // copies happen synchronously inside client.connect()). Wipe our
      // copies so they do not sit on the heap for the lifetime of the
      // session. ssh2 keeps its own internal copy of `password` (out of our
      // scrub reach) — see parity-and-hardening-review §3.S-3.
      scrub();
    }
  }

  async function createSshSession(host) {
    const session = {
      id: randomUUID(),
      host,
      client: new Client(),
      jumpClient: null,
      stream: null,
      ws: null,
      state: "connecting",
      buffer: [],
      bufferBytes: 0,
      droppedBytes: 0,
      // Input typed before the shell opened, and the window size that came
      // with it. The session id reaches the client before the shell exists,
      // so both can arrive before there is a stream to apply them to.
      pendingInput: [],
      pendingInputBytes: 0,
      pendingInputDroppedBytes: 0,
      pendingResize: null,
      // Set when the session fails, and replayed to a websocket that attaches
      // after the failure. See failSession.
      failureMessage: null,
      // Set while a session that ended before its shell opened waits to be
      // removed. See FAILED_SESSION_RETENTION_MS.
      retireTimer: null,
      // Set while the session waits for its shell. See SHELL_OPEN_TIMEOUT_MS.
      shellTimer: null,
    };
    // M05 / #87: connectClient (the short-lived path) properly destructures
    // both fields and runs scrub() in finally. createSshSession (the
    // long-lived path) previously discarded the scrub callback entirely —
    // password / passphrase / private-key bytes sat on the heap for the
    // session's whole lifetime. Capture both, scrub right after connect()
    // returns synchronously (ssh2 has consumed the secrets by then per the
    // contract documented in connectClient's finally block).
    const { config: connectConfig, scrub: scrubConfig, hostKeyFailure } =
      await createConnectConfig(host);

    try {
      const jumpConnection = host.jumpHost ? await openJumpSocket(host) : undefined;

      if (jumpConnection?.socket) {
        connectConfig.sock = jumpConnection.socket;
        session.jumpClient = jumpConnection.jumpClient;
      }

      session.client.on("ready", () => {
        const shellWindow = {
          term: "xterm-256color",
          cols: 120,
          rows: 36,
        };
        const shellEnvironment = getChannelEnvironment(host.environment);
        const interactiveShellCommand = buildInteractiveShellCommand(host.environment);

        // ssh2's readyTimeout covers the handshake and is cleared once the
        // sign-in succeeds, so nothing bounded the wait for the shell. A
        // server that authenticates and then never answers the channel open
        // left the session in "connecting" for ever, with the connection
        // held open. Bound it here so the session fails with a reason.
        session.shellTimer = setTimeout(() => {
          session.shellTimer = null;
          failSession(
            session,
            new Error(
              `The host did not open a shell within ${Math.round(shellOpenTimeoutMs / 1000)} seconds.`
            )
          );
          session.client.end();
        }, shellOpenTimeoutMs);
        session.shellTimer.unref?.();

        const onShellReady = (error, stream) => {
          if (session.shellTimer) {
            clearTimeout(session.shellTimer);
            session.shellTimer = null;
          }
          if (error) {
            failSession(session, error);
            // Nothing can be done with a connection whose shell was refused.
            // Ending it lets the client's close handler retire the session
            // (it used to stay open, with its session, indefinitely).
            session.client.end();
            return;
          }

          session.stream = stream;
          session.state = "connected";
          broadcast(session, {
            type: "status",
            state: "connected",
          });

          stream.on("data", (chunk) => {
            broadcast(session, {
              type: "data",
              data: chunk.toString("utf8"),
            });
          });

          // A write to a stream the server has closed raises an error on the
          // stream. With no listener, that error is an uncaught exception:
          // the backend logged it and carried on, the session stayed
          // "connected", and the keystrokes the user typed vanished with
          // nothing on screen to say why.
          stream.on("error", (error) => {
            failSession(session, error);
          });

          stream.on("close", async () => {
            // M09 / #91: closeForwardsForSession used to run concurrently
            // with sessions.delete(session.id), which let forward
            // onConnection handlers reference a deleted sessionId and
            // error out. Await the forward cleanup BEFORE removing the
            // session from the map. The client.end() + jumpClient.end()
            // calls are idempotent; they can run regardless of state.
            session.state = "disconnected";
            broadcast(session, {
              type: "status",
              state: "disconnected",
            });
            await retireSession(session);
          });

          // The window size that arrived before the shell existed, then
          // everything typed before it — in the order it was typed.
          if (session.pendingResize) {
            applySessionResize(session, session.pendingResize.rows, session.pendingResize.cols);
            session.pendingResize = null;
          }
          flushPendingInput(session);
        };

        if (interactiveShellCommand) {
          session.client.exec(
            interactiveShellCommand,
            shellEnvironment ? { env: shellEnvironment, pty: shellWindow } : { pty: shellWindow },
            onShellReady
          );
        } else if (shellEnvironment) {
          session.client.shell(shellWindow, { env: shellEnvironment }, onShellReady);
        } else {
          session.client.shell(shellWindow, onShellReady);
        }
      });

      session.client.on("error", (error) => {
        session.jumpClient?.end();
        // The connection failed, so the wait for the shell is over: leaving
        // the timer armed would replace this reason with a timeout one, and
        // the user would be told the host went quiet when the real fault was
        // a dropped connection.
        if (session.shellTimer) {
          clearTimeout(session.shellTimer);
          session.shellTimer = null;
        }
        // A refused host key is reported with the reason, not ssh2's bare
        // "Host denied (verification failed)". Every other failure is
        // reported with a code and a message the user can act on.
        failSession(session, hostKeyFailure.error ?? sshConnectFailure(error, host));
      });

      session.client.on("close", () => {
        if (session.shellTimer) {
          clearTimeout(session.shellTimer);
          session.shellTimer = null;
          // The connection ended before the shell opened and nothing has said
          // why. Say so now: a bare "disconnected" leaves the user with a
          // session that ended for no stated reason, and the timeout that
          // used to cover this case waited 30 seconds to say less.
          if (!session.failureMessage) {
            failSession(
              session,
              new Error("The connection closed before the shell opened.")
            );
          }
        }
        if (session.state !== "disconnected") {
          session.state = "disconnected";
          broadcast(session, {
            type: "status",
            state: "disconnected",
          });
        }
        if (session.stream) {
          // The shell's own close handler retires the session.
          void closeForwardsForSession(session.id);
          session.jumpClient?.end();
          return;
        }
        // The connection ended before a shell opened (a refused login, an
        // unreachable host, a rejected host key). Nothing else would ever
        // remove it, so keep it only long enough to report the failure to a
        // websocket that has not attached yet. The jump connection has nothing
        // left to carry, so it ends now rather than at removal.
        session.jumpClient?.end();
        if (!session.retireTimer && sessions.get(session.id) === session) {
          session.retireTimer = setTimeout(() => {
          session.retireTimer = null;
          void retireSession(session);
        }, failedSessionRetentionMs);
        session.retireTimer.unref?.();
      }
    });

    try {
      session.client.connect(connectConfig);
    } finally {
      // ssh2 reads password / passphrase / privateKey synchronously inside
      // client.connect() (same contract connectClient relies on). Wipe our
      // copies so they do not sit on the heap for the session lifetime.
      scrubConfig();
    }
      sessions.set(session.id, session);
      return session;
    } catch (error) {
      // The session never reached the session map, so nothing else would ever
      // release what it took: the jump connection, the client, and the
      // credentials it was built with. The jump client in particular stayed
      // authenticated to the bastion for the life of the backend process.
      if (session.shellTimer) {
        clearTimeout(session.shellTimer);
        session.shellTimer = null;
      }
      scrubConfig();
      session.jumpClient?.end();
      session.client.end();
      throw sshConnectFailure(error, host);
    }
  }

  return {    createConnectConfig,
    openJumpSocket,
    connectClient,
    createSshSession,
    retireSession,
  };
}

/**
 * Send input to the session's shell.
 *
 * The session id is returned to the client as soon as the connection is
 * established, which is before the shell exists, so the first keystrokes can
 * arrive before there is a stream to write them to. Dropping them loses what
 * the user typed; holding them until the shell opens does not.
 */
export function writeSessionInput(session, data) {
  if (session.stream) {
    session.stream.write(data);
    return;
  }
  bufferPendingInput(session, data);
}

/**
 * Write out everything typed before the shell opened, in the order it was
 * typed.
 */
export function flushPendingInput(session) {
  if (!session.stream || session.pendingInput.length === 0) {
    return;
  }
  const pending = session.pendingInput;
  session.pendingInput = [];
  session.pendingInputBytes = 0;
  for (const chunk of pending) {
    session.stream.write(chunk);
  }
}

/**
 * Apply a terminal size to the session's shell.
 *
 * A size that arrives before the shell exists is held, and applied when the
 * shell opens: otherwise the session ran at the default 120x36 until the
 * client happened to send another resize.
 */
export function applySessionResize(session, rows, cols) {
  if (session.stream) {
    session.stream.setWindow(rows, cols, rows * 16, cols * 8);
    return;
  }
  session.pendingResize = { rows, cols };
}
