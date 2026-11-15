import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A session that fails before its shell opens (refused login, unreachable
// host, rejected host key) used to stay in the backend's session map for the
// life of the process: only a shell's close removed a session, and the
// renderer forgets the session id once it has seen the failure, so it never
// sends DELETE. These tests connect to a closed loopback port, so no traffic
// leaves the machine.

async function closedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === "string") {
    throw new Error("no port");
  }
  return address.port;
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("timed out waiting");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("failed backend sessions", () => {
  let stateDir: string;
  let previousStateDir: string | undefined;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "tw-failed-session-"));
    previousStateDir = process.env.TERMSNIP_STATE_DIR;
    process.env.TERMSNIP_STATE_DIR = stateDir;
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

  async function makeManager(retentionMs: number) {
    const { createSshSessionManager } = await import(
      "../../apps/desktop/server/backend-ssh-session.mjs"
    );
    const { createHostKeyStore } = await import("../../apps/desktop/server/backend-host-keys.mjs");
    const store = createHostKeyStore();
    const sessions = new Map();
    const closedForwards: string[] = [];
    const manager = createSshSessionManager({
      sessions,
      getHostKeyStore: () => store,
      closeForwardsForSession: async (id: string) => {
        closedForwards.push(id);
      },
      broadcast: () => {},
      failSession: (session: { state: string; failureMessage: string | null }, error: unknown) => {
        session.state = "error";
        session.failureMessage = error instanceof Error ? error.message : "failed";
      },
      expandHome: (path: string) => path,
      failedSessionRetentionMs: retentionMs,
    });
    return { manager, sessions, closedForwards };
  }

  async function failingHost() {
    return {
      agentForwarding: false,
      authMethod: "password",
      environment: {},
      hostKeyPolicy: "allowUnknown",
      hostname: "127.0.0.1",
      password: "not-a-real-password",
      passphrase: "",
      port: await closedLoopbackPort(),
      privateKeyPath: "",
      protocol: "ssh",
      username: "nobody",
    };
  }

  it("removes a session that failed before its shell opened, after the retention time", async () => {
    const { manager, sessions, closedForwards } = await makeManager(300);
    const session = await manager.createSshSession(await failingHost());
    expect(sessions.has(session.id)).toBe(true);

    await waitFor(() => session.failureMessage !== null);
    // Kept long enough for a late websocket to read the reason...
    expect(sessions.has(session.id)).toBe(true);
    // ...then removed.
    await waitFor(() => !sessions.has(session.id));
    expect(closedForwards).toContain(session.id);
    expect(session.retireTimer).toBeNull();
  });

  it("retireSession removes it at once and cancels the retention timer", async () => {
    const { manager, sessions } = await makeManager(60_000);
    const session = await manager.createSshSession(await failingHost());
    await waitFor(() => session.failureMessage !== null && session.retireTimer !== null);

    await manager.retireSession(session);
    expect(sessions.has(session.id)).toBe(false);
    expect(session.retireTimer).toBeNull();
    // Retiring twice is harmless.
    await manager.retireSession(session);
    expect(sessions.has(session.id)).toBe(false);
  });
});
