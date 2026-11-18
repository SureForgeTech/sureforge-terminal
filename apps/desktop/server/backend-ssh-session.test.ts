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
    expect(failures[0]).toContain("write after end");
    expect(session.state).toBe("error");
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
    const scrub = vi.spyOn(SecretBuffer.prototype, "scrub");
    const { manager } = await makeManager();

    const failing = manager.createSshSession(
      host({ jumpHost: host({ hostname: "127.0.0.2" }) })
    );

    // The jump connection authenticates, then the jump host refuses.
    const jumpClient = await waitForClientWithListener("error");
    jumpClient.emit("error", Object.assign(new Error("refused"), { level: "client-socket" }));

    await expect(failing).rejects.toThrow();
    // The jump client was released rather than left authenticated.
    expect(jumpClient.ended).toBe(true);
    // The credentials were wiped rather than left on the heap.
    expect(scrub).toHaveBeenCalled();
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
