import { EventEmitter, once } from "node:events";
import { connect } from "node:net";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createServer as createNetServer } from "node:net";
import {
  createForwardOperations,
  ForwardPortInUseError,
  validateForwardPorts,
} from "./backend-forwards.mjs";

function setup() {
  const client = Object.assign(new EventEmitter(), {
    forwardOut: vi.fn(),
    forwardIn: vi.fn((_host, port, callback) => callback(null, port || 42000)),
  });
  const forwards = new Map();
  const operations = createForwardOperations({
    sessions: new Map([["test-session", { id: "test-session", client }]]), forwards,
  });
  return { ...operations, client, forwards };
}

const request = {
  sessionId: "test-session", localHost: "127.0.0.1", localPort: 0,
  remoteHost: "127.0.0.1", remotePort: 443,
};

describe("browser forwards", () => {
  it("names a local port that is already in use", async () => {
    // The port is the one thing a user can change, so the failure says so
    // instead of being rebuilt as "Internal server error.".
    const blocker = createNetServer();
    const port = await new Promise<number>((resolve) => {
      blocker.listen(0, "127.0.0.1", () => {
        const address = blocker.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });

    try {
      const ops = setup();
      const failure = await ops
        .createLocalForward({ ...request, localPort: port })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ForwardPortInUseError);
      expect((failure as Error).message).toBe(
        "That local port is already in use, so the forward cannot be started. Pick another one."
      );
      expect((failure as { statusCode?: number }).statusCode).toBe(409);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });

  it.each([false, true])("closes accepted sockets before waiting for close (session=%s)", async (session) => {
    const ops = setup();
    const record = await ops.createLocalForward(request);
    const socket = connect(record.localPort, request.localHost);
    try {
      await once(socket, "connect");
      await vi.waitFor(() => expect(ops.client.forwardOut).toHaveBeenCalled());
      const closed = once(socket, "close");
      const close = session ? ops.closeForwardsForSession("test-session") : ops.closeLocalForward(record.id);
      await close;
      await closed;
      expect(ops.forwards.size).toBe(0);
      // A late SSH channel must not survive the closed accepted socket.
      const upstream = new PassThrough();
      ops.client.forwardOut.mock.calls[0][4](null, upstream);
      expect(upstream.destroyed).toBe(true);
    } finally {
      socket.destroy();
      await ops.closeLocalForward(record.id);
    }
  });

  it("deletes the record even when the server close reports an error", async () => {
    const ops = setup();
    const destroy = vi.fn();
    ops.forwards.set("broken", {
      direction: "local", sockets: new Set([{ destroy }]),
      server: { close: (callback) => {
        expect(destroy).toHaveBeenCalled();
        callback(new Error("close failed"));
      } },
    });
    await expect(ops.closeLocalForward("broken")).rejects.toThrow("close failed");
    expect(ops.forwards.has("broken")).toBe(false);
  });

  it("returns the assigned listener ports in both directions", async () => {
    const ops = setup();
    const local = await ops.createLocalForward(request);
    try {
      expect(local.localPort).toBeGreaterThan(0);
      const remote = await ops.createRemoteForward({ ...request, localPort: 443, remotePort: 0 });
      expect(remote.remotePort).toBe(42000);
    } finally {
      await ops.closeLocalForward(local.id);
    }
  });

  it.each(["local", "remote"])("validates %s listener and destination ranges", (direction) => {
    const bind = direction === "local" ? "localPort" : "remotePort";
    const destination = direction === "local" ? "remotePort" : "localPort";
    const ports = { direction, localPort: 1, remotePort: 65535 };
    expect(() => validateForwardPorts({ ...ports, [bind]: 0 })).not.toThrow();
    expect(() => validateForwardPorts({ ...ports, [destination]: 0 })).toThrow("destination port must be 1-65535");
    for (const field of [bind, destination]) {
      for (const value of [-1, 65536, 1.5, NaN, "22", undefined]) {
        expect(() => validateForwardPorts({ ...ports, [field]: value })).toThrow("port must be");
      }
    }
  });
});
