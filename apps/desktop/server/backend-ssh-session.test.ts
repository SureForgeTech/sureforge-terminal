// The browser backend's SSH session lifecycle.
//
// The session id reaches the client as soon as the connection is established,
// which is BEFORE the shell exists — the native shell opens the shell as part
// of the connect, so it never had that window. Everything typed in that window
// used to be dropped, the shell had no deadline, a stream error was an
// uncaught exception, and a failed jump host left an authenticated connection
// and the host's credentials on the heap.
//
// ssh2 is replaced with a fake client here: these are the paths that need a
// server that answers on its own schedule — one that authenticates and then
// never opens a shell, one that never opens a tunnel — and no such server
// exists on a test machine. Nothing here reaches the network.

import { mkdtemp, rm } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ssh2 = vi.hoisted(() => ({
  clients: [] as Array<{
    ended: boolean;
    destroyed: boolean;
    shellCallback?: (error: Error | undefined, stream?: unknown) => void;
    forwardCallback?: (error: Error | undefined, stream?: unknown) => void;
    emit: (event: string, ...args: unknown[]) => boolean;
  }>,
}));

vi.mock("ssh2", async () => {
  const { EventEmitter } = await import("node:events");

  class FakeClient extends EventEmitter {
    ended = false;
    destroyed = false;
    shellCallback?: (error: Error | undefined, stream?: unknown) => void;
    forwardCallback?: (error: Error | undefined, stream?: unknown) => void;

    constructor() {
      super();
      ssh2.clients.push(this);
    }

    connect() {
      // The real client starts a handshake here. The fake waits for the test
      // to say the host answered.
    }

    shell(
      _window: unknown,
      optionsOrCallback: unknown,
      maybeCallback?: (error: Error | undefined, stream?: unknown) => void
    ) {
      this.shellCallback =
        typeof optionsOrCallback === "function"
          ? (optionsOrCallback as (error: Error | undefined, stream?: unknown) => void)
          : maybeCallback;
    }

    exec(
      _command: unknown,
      _options: unknown,
      callback: (error: Error | undefined, stream?: unknown) => void
    ) {
      this.shellCallback = callback;
    }

    forwardOut(
      _srcIp: string,
      _srcPort: number,
      _dstIp: string,
      _dstPort: number,
      callback: (error: Error | undefined, stream?: unknown) => void
    ) {
      this.forwardCallback = callback;
    }

    end() {
      this.ended = true;
    }

    destroy() {
      this.destroyed = true;
    }
  }

  return { Client: FakeClient };
});

class FakeStream extends EventEmitter {
  written: string[] = [];
  windows: Array<{ rows: number; cols: number; height: number; width: number }> = [];

  write(data: string) {
    this.written.push(data);
  }

  setWindow(rows: number, cols: number, height: number, width: number) {
    this.windows.push({ rows, cols, height, width });
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("timed out waiting");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * Wait for a client that is ready to be driven, and return it.
 *
 * The client is constructed before the manager attaches its listeners, so
 * waiting for an instance alone is not enough: an event emitted before the
 * listener is attached is lost, and an "error" emitted with no listener is
 * thrown by the emitter. The client wanted is the one with the listener
 * attached, not simply the first one built — a session builds its own client
 * before it opens the jump connection.
 */
async function waitForClientWithListener(event: "ready" | "error") {
  let found: (typeof ssh2.clients)[number] | undefined;
  await waitFor(() => {
    found = ssh2.clients.find((client) => {
      const emitter = client as unknown as { listenerCount?: (name: string) => number };
      return (emitter.listenerCount?.(event) ?? 0) > 0;
    });
    return found !== undefined;
  });
  return found!;
}

function host(overrides: Record<string, unknown> = {}) {
  return {
    agentForwarding: false,
    authMethod: "password",
    environment: {},
    hostKeyPolicy: "allowUnknown",
    hostname: "127.0.0.1",
    password: "not-a-real-password",
    passphrase: "",
    port: 22,
    privateKeyPath: "",
    protocol: "ssh",
    username: "nobody",
    ...overrides,
  };
}

describe("backend ssh session lifecycle", () => {
  let stateDir: string;
  let previousStateDir: string | undefined;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "tw-session-lifecycle-"));
    previousStateDir = process.env.TERMSNIP_STATE_DIR;
    process.env.TERMSNIP_STATE_DIR = stateDir;
    ssh2.clients.length = 0;
    vi.resetModules();
  });

  afterEach(async () => {
    if (previousStateDir === undefined) {
      delete process.env.TERMSNIP_STATE_DIR;
    } else {
      process.env.TERMSNIP_STATE_DIR = previousStateDir;
    }
    await rm(stateDir, { recursive: true, force: true });
  });

  async function makeManager(overrides: Record<string, unknown> = {}) {
    const { createSshSessionManager } = await import("./backend-ssh-session.mjs");
    const { createHostKeyStore } = await import("./backend-host-keys.mjs");
    const store = createHostKeyStore();
    const sessions = new Map();
    const failures: string[] = [];
    const manager = createSshSessionManager({
      sessions,
      getHostKeyStore: () => store,
      closeForwardsForSession: async () => {},
      broadcast: () => {},
      failSession: (session: { state: string; failureMessage: string | null }, error: unknown) => {
        session.state = "error";
        session.failureMessage = error instanceof Error ? error.message : "failed";
        failures.push(session.failureMessage);
      },
      expandHome: (path: string) => path,
      ...overrides,
    });
    return { manager, sessions, failures };
  }

  it("keeps input typed before the shell opened, and sends it once the shell is ready", async () => {
    const { manager } = await makeManager();
    const session = await manager.createSshSession(host());

    // The session id is returned before the shell exists, so the client's
    // first keystrokes arrive with nothing to write them to.
    const { writeSessionInput } = await import("./backend-ssh-session.mjs");
    writeSessionInput(session, "ls -l\r");
    writeSessionInput(session, "whoami\r");
    expect(session.stream).toBeNull();

    const client = ssh2.clients[0];
    client.emit("ready");

    const stream = new FakeStream();
    await waitFor(() => client.shellCallback !== undefined);
    client.shellCallback?.(undefined, stream);

    expect(stream.written).toEqual(["ls -l\r", "whoami\r"]);
  });

  it("applies a window size that arrived before the shell opened", async () => {
    const { manager } = await makeManager();
    const session = await manager.createSshSession(host());

    const { applySessionResize } = await import("./backend-ssh-session.mjs");
    applySessionResize(session, 40, 100);

    const client = ssh2.clients[0];
    client.emit("ready");
    const stream = new FakeStream();
    await waitFor(() => client.shellCallback !== undefined);
    client.shellCallback?.(undefined, stream);

    expect(stream.windows).toEqual([{ rows: 40, cols: 100, height: 40 * 16, width: 100 * 8 }]);
  });

  it("holds the size that arrives over the HTTP resize route, the only one the client uses", async () => {
    // The pane lays out as soon as it mounts, which is before the shell has
    // opened, so the size arrives over the HTTP route. That route used to
    // answer "pending" and drop the size, leaving the session at the default
    // 120x36 until the window happened to change again — while the websocket
    // frame, which nothing sends, held it.
    //
    // Source-contract test because importing backend.mjs binds a port.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("apps/desktop/server/backend.mjs", "utf8");

    expect(source).toMatch(/applySessionResize\(session, body\.rows, body\.cols\)/);
    expect(source).not.toContain("pending: true");
  });

  it("bounds the input it holds before the shell opens", async () => {
    // The byte cap alone does not bound the array: an empty frame grows it
    // without growing the accounted bytes, and a client sending many one-byte
    // frames fills it with entries.
    const { bufferPendingInput } = await import("./backend-buffers.mjs");
    const session = {
      pendingInput: [] as string[],
      pendingInputBytes: 0,
      pendingInputDroppedBytes: 0,
    };

    for (let index = 0; index < 10_000; index += 1) {
      bufferPendingInput(session, "");
    }
    expect(session.pendingInput.length).toBe(0);
    expect(session.pendingInputBytes).toBe(0);

    for (let index = 0; index < 10_000; index += 1) {
      bufferPendingInput(session, "x");
    }
    expect(session.pendingInput.length).toBeLessThanOrEqual(1024);
    expect(session.pendingInputBytes).toBeLessThanOrEqual(64 * 1024);
  });

  it("reports the input it had to drop, rather than losing it quietly", async () => {
    // The output buffer says how much output it dropped; the input buffer
    // says the same about what was typed.
    const frames: Array<{ type: string; data?: string }> = [];
    const { manager } = await makeManager({
      broadcast: (session: unknown, frame: { type: string; data?: string }) => {
        frames.push(frame);
      },
    });
    const session = await manager.createSshSession(host());

    const { writeSessionInput } = await import("./backend-ssh-session.mjs");
    writeSessionInput(session, "x".repeat(70 * 1024));

    const client = ssh2.clients[0];
    client.emit("ready");
    const stream = new FakeStream();
    await waitFor(() => client.shellCallback !== undefined);
    client.shellCallback?.(undefined, stream);

    const note = frames.find((frame) => frame.data?.includes("were dropped"));
    expect(note?.data).toContain("bytes of input typed");
    expect(note?.data).not.toContain("x".repeat(100));
  });

  it("fails the session when the shell stream errors, instead of throwing", async () => {
    const { manager, failures } = await makeManager();
    const session = await manager.createSshSession(host());

    const client = ssh2.clients[0];
    client.emit("ready");
    const stream = new FakeStream();
    await waitFor(() => client.shellCallback !== undefined);
    client.shellCallback?.(undefined, stream);

    // A write to a stream the server closed raises an error on the stream.
    // With no listener that error is an uncaught exception: the backend
    // logged it and carried on, the session stayed "connected", and the
    // keystrokes the user typed vanished with nothing on screen to say why.
    expect(() => stream.emit("error", new Error("write after end"))).not.toThrow();
    await waitFor(() => failures.length > 0);
    // The reason is fixed text: the raw error can carry a local path, and the
    // terminal is not the place for one.
    expect(failures[0]).toContain("connection to the host failed");
    expect(failures[0]).not.toContain("write after end");
    expect(session.state).toBe("error");
    // The connection is released: an error is not always followed by a close,
    // and nothing else would retire the session.
    expect(client.ended).toBe(true);
  });

  it("does not resurrect a session whose shell timed out when the shell answers late", async () => {
    // The shell-open timeout reports the failure and ends the client. A
    // server that answers the channel open afterwards must not bring the
    // session back — and the input the user typed in the meantime must not
    // be run on a shell they were told they do not have.
    const { manager, failures } = await makeManager({ shellOpenTimeoutMs: 50 });
    const session = await manager.createSshSession(host());

    const client = ssh2.clients[0];
    client.emit("ready");
    await waitFor(() => failures.length > 0);
    expect(failures[0]).toContain("did not open a shell");

    // The late answer.
    const { writeSessionInput } = await import("./backend-ssh-session.mjs");
    writeSessionInput(session, "rm -rf /tmp/important\r");
    const stream = new FakeStream();
    client.shellCallback?.(undefined, stream);

    expect(session.state).toBe("error");
    expect(session.stream).toBeNull();
    // The typed command never reached a shell.
    expect(stream.written).toEqual([]);
  });

  it("does not resurrect a session that was closed before its shell opened", async () => {
    const { manager } = await makeManager();
    const session = await manager.createSshSession(host());

    const client = ssh2.clients[0];
    client.emit("ready");
    // The connection ends before the shell opens. The session is kept for a
    // moment so a websocket that attaches late can still read the reason,
    // but it is over.
    client.emit("close");
    await waitFor(() => session.state === "disconnected");

    const stream = new FakeStream();
    client.shellCallback?.(undefined, stream);

    expect(session.state).not.toBe("connected");
    expect(session.stream).toBeNull();
    expect(stream.written).toEqual([]);
  });

  it("does not resurrect a session that was retired before its shell opened", async () => {
    // The DELETE path: the user closed the tab, and the session was retired.
    // A shell that answers afterwards must not bring it back.
    const { manager, sessions } = await makeManager();
    const session = await manager.createSshSession(host());

    const client = ssh2.clients[0];
    client.emit("ready");
    await manager.retireSession(session);
    expect(sessions.has(session.id)).toBe(false);

    const { writeSessionInput } = await import("./backend-ssh-session.mjs");
    writeSessionInput(session, "echo should-not-run\r");
    const stream = new FakeStream();
    client.shellCallback?.(undefined, stream);

    expect(session.state).not.toBe("connected");
    expect(session.stream).toBeNull();
    expect(stream.written).toEqual([]);
  });

  it("reports a private key that cannot be read, in fixed words", async () => {
    // The raw error names the absolute path on this machine, which has no
    // business in a client's terminal. The category says it is not worth
    // retrying with the same key.
    const { manager } = await makeManager();
    const missing = join(stateDir, "no-such-key");

    const failure = await manager
      .createSshSession(
        host({ authMethod: "privateKey", privateKeyPath: missing, password: "" })
      )
      .catch((error: unknown) => error);

    expect((failure as Error).message).toContain("private key could not be read");
    expect((failure as Error).message).not.toContain(missing);
    expect((failure as { code?: string }).code).toBe("auth_failed");
  });

  it("reports a refused shell with fixed text, not the server's wording", async () => {
    // ssh2's text for a refused channel is written by the server ("Channel
    // open failure: ..."), and the server does not get to write into the
    // user's terminal.
    const { manager, failures } = await makeManager();
    await manager.createSshSession(host());

    const client = ssh2.clients[0];
    client.emit("ready");
    await waitFor(() => client.shellCallback !== undefined);
    client.shellCallback?.(new Error("Channel open failure: administratively prohibited"));

    await waitFor(() => failures.length > 0);
    expect(failures[0]).toContain("refused to open a shell");
    expect(failures[0]).not.toContain("administratively prohibited");
  });

  it("fails a session whose shell never opens, instead of waiting for ever", async () => {
    const { manager, failures } = await makeManager({ shellOpenTimeoutMs: 50 });
    const session = await manager.createSshSession(host());

    const client = ssh2.clients[0];
    client.emit("ready");

    await waitFor(() => failures.length > 0);
    expect(failures[0]).toContain("did not open a shell");
    expect(session.state).toBe("error");
    expect(client.ended).toBe(true);
  });

  it("releases the jump connection and scrubs the credentials when the jump host refuses", async () => {
    const { SecretBuffer } = await import("./secrets.mjs");
    // Which secret was scrubbed matters: the jump host's credentials are
    // scrubbed by connectClient's finally, which pre-dates this change. The
    // claim is about the TARGET host's credentials, which were left on the
    // heap because the jump connect happened before the scrub.
    const created: Array<{ value: string; secret: InstanceType<typeof SecretBuffer> }> = [];
    const originalFromString = SecretBuffer.fromString;
    vi.spyOn(SecretBuffer, "fromString").mockImplementation((value: string) => {
      const secret = originalFromString.call(SecretBuffer, value) as InstanceType<
        typeof SecretBuffer
      >;
      created.push({ value, secret });
      return secret;
    });
    const { manager } = await makeManager();

    const targetPassword = "target-host-password";
    const jumpPassword = "jump-host-password";
    const failing = manager.createSshSession(
      host({ password: targetPassword, jumpHost: host({ hostname: "127.0.0.2", password: jumpPassword }) })
    );

    // The jump connection authenticates, then the jump host refuses.
    const jumpClient = await waitForClientWithListener("error");
    jumpClient.emit("error", Object.assign(new Error("refused"), { level: "client-socket" }));

    await expect(failing).rejects.toThrow();
    // The jump client was released rather than left authenticated.
    expect(jumpClient.ended).toBe(true);
    // The TARGET host's credentials were wiped rather than left on the heap.
    const target = created.find((entry) => entry.value === targetPassword);
    expect(target).toBeDefined();
    expect(target?.secret.isScrubbed).toBe(true);
  });

  it("gives up on a jump host that never opens the tunnel", async () => {
    const { manager } = await makeManager({ jumpForwardTimeoutMs: 50 });

    const pending = manager.createSshSession(host({ jumpHost: host({ hostname: "127.0.0.3" }) }));

    const jumpClient = await waitForClientWithListener("ready");
    jumpClient.emit("ready");
    // The bastion accepts the sign-in and never answers the tunnel request.
    await waitFor(() => jumpClient.forwardCallback !== undefined);

    await expect(pending).rejects.toThrow(/did not open a tunnel/);
    expect(jumpClient.ended).toBe(true);
  });
});
