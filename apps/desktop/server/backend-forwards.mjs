import { randomUUID } from "node:crypto";
import { connect as connectNet, createServer as createNetServer } from "node:net";

/**
 * A forward request the backend refused.
 *
 * Its message is fixed text about the request — which port is wrong — so the
 * user can see what to change. It is a typed error because `respondError`
 * rebuilds every other message as "Internal server error.", which is no help
 * to someone who mistyped a port number.
 */
export class InvalidForwardRequestError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "InvalidForwardRequestError";
    // 400 by default: the request itself was wrong, and a retry of the same
    // request would be refused the same way. A caller that has a different
    // reason passes its own status.
    this.statusCode = statusCode;
  }
}

/**
 * A forward that could not start because the local port is taken.
 *
 * Its message is fixed text: the user asked for a forward on a port that
 * something else is already listening on, and "Internal server error." does
 * not say that. The port itself is in the request the user made, so the
 * client can name it.
 */
export class ForwardPortInUseError extends Error {
  constructor(message, statusCode = 409) {
    super(message);
    this.name = "ForwardPortInUseError";
    // 409: the request is fine and the world is not — the port is in use —
    // and a retry of the same request would be refused the same way.
    this.statusCode = statusCode;
  }
}

/**
 * Whether a failure is a local port that is already in use.
 *
 * The code is Node's own, so the wording never has to be read.
 */
export function isAddressInUseError(error) {
  return error?.code === "EADDRINUSE";
}

export function validateForwardPorts({ direction, localPort, remotePort }) {
  for (const [label, port, bind] of [
    ["Local", localPort, direction === "local"],
    ["Remote", remotePort, direction === "remote"],
  ]) {
    if (!Number.isInteger(port) || port < (bind ? 0 : 1) || port > 65535) {
      throw new InvalidForwardRequestError(
        `${label} ${bind ? "bind" : "destination"} port must be ${bind ? "0 (automatic) or " : ""}1-65535`
      );
    }
  }
}

export function createForwardOperations({ sessions, forwards }) {
  function serializeForward(forward) {
    return {
      id: forward.id,
      direction: forward.direction,
      sessionId: forward.sessionId,
      localHost: forward.localHost,
      localPort: forward.localPort,
      remoteHost: forward.remoteHost,
      remotePort: forward.remotePort,
      createdAt: forward.createdAt,
    };
  }

  async function closeLocalForward(forwardId) {
    const forward = forwards.get(forwardId);
    if (!forward) {
      return false;
    }

    try {
      if (forward.direction === "local") {
        for (const socket of forward.sockets) {
          socket.destroy();
        }
        await new Promise((resolve, reject) => {
          forward.server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        });
      } else {
        const session = sessions.get(forward.sessionId);
        if (session) {
          await new Promise((resolve, reject) => {
            session.client.unforwardIn(forward.remoteHost, forward.remotePort, (error) => {
              if (error) {
                reject(error);
                return;
              }

              resolve();
            });
          });
        }
      }
    } finally {
      forwards.delete(forwardId);
    }
    return true;
  }

  async function closeForwardsForSession(sessionId) {
    const forwardIds = Array.from(forwards.values())
      .filter((forward) => forward.sessionId === sessionId)
      .map((forward) => forward.id);

    await Promise.all(
      forwardIds.map((forwardId) => closeLocalForward(forwardId).catch(() => false))
    );
  }

  async function createLocalForward({ localHost, localPort, remoteHost, remotePort, sessionId }) {
    validateForwardPorts({ direction: "local", localPort, remotePort });
    const session = sessions.get(sessionId);
    if (!session) {
      throw new InvalidForwardRequestError(
        "That session is no longer open, so the forward cannot be created.",
        404
      );
    }

    const sockets = new Set();
    const server = createNetServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      session.client.forwardOut(
        socket.remoteAddress ?? "127.0.0.1",
        socket.remotePort ?? 0,
        remoteHost,
        remotePort,
        (error, upstream) => {
          if (error) {
            socket.destroy(error);
            return;
          }

          if (socket.destroyed) {
            upstream.destroy();
            return;
          }
          socket.once("close", () => upstream.destroy());
          socket.pipe(upstream);
          upstream.pipe(socket);
          upstream.on("error", () => socket.destroy());
          socket.on("error", () => upstream.end());
        }
      );
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        // A port that is already in use is the one failure a user can act
        // on: they chose another port. It is named, not rebuilt as
        // "Internal server error.".
        reject(
          isAddressInUseError(error)
            ? new ForwardPortInUseError(
                "That local port is already in use, so the forward cannot be started. Pick another one."
              )
            : error
        );
      };
      server.once("error", onError);
      server.listen(localPort, localHost, () => {
        server.off("error", onError);
        resolve();
      });
    });

    const address = server.address();
    const boundPort = typeof address === "object" && address ? address.port : localPort;
    const forward = {
      id: randomUUID(),
      direction: "local",
      sessionId,
      localHost,
      localPort: boundPort,
      remoteHost,
      remotePort,
      createdAt: new Date().toISOString(),
      server,
      sockets,
    };

    forwards.set(forward.id, forward);
    return serializeForward(forward);
  }

  async function createRemoteForward({ localHost, localPort, remoteHost, remotePort, sessionId }) {
    validateForwardPorts({ direction: "remote", localPort, remotePort });
    const session = sessions.get(sessionId);
    if (!session) {
      throw new InvalidForwardRequestError(
        "That session is no longer open, so the forward cannot be created.",
        404
      );
    }

    const forward = {
      id: randomUUID(),
      direction: "remote",
      sessionId,
      localHost,
      localPort,
      remoteHost,
      remotePort,
      createdAt: new Date().toISOString(),
      onConnection: null,
    };

    forward.onConnection = (accept) => {
      const upstream = accept();
      const localSocket = connectNet(forward.localPort, forward.localHost);

      upstream.pipe(localSocket);
      localSocket.pipe(upstream);
      upstream.on("error", () => localSocket.destroy());
      localSocket.on("error", () => upstream.destroy());
    };

    ensureRemoteForwardDispatcher(session);

    await new Promise((resolve, reject) => {
      session.client.forwardIn(remoteHost, remotePort, (error, boundPort) => {
        if (error) {
          reject(error);
          return;
        }

        // Registered here, not after the await: a connection the server sends
        // right behind its bind reply must already find this forward.
        forward.remotePort = boundPort ?? remotePort;
        forwards.set(forward.id, forward);
        resolve();
      });
    });

    return serializeForward(forward);
  }

  /**
   * One "tcp connection" listener per session, which hands each incoming
   * connection to the remote forward it belongs to. Each forward used to add
   * its own listener that rejected connections for any other port; ssh2 tears
   * a channel down on reject() even after another listener accepted it, so
   * with two remote forwards on one session neither carried traffic.
   */
  function ensureRemoteForwardDispatcher(session) {
    if (session.remoteForwardDispatcher) {
      return;
    }
    session.remoteForwardDispatcher = (details, accept, reject) => {
      const forward = Array.from(forwards.values()).find(
        (candidate) =>
          candidate.direction === "remote" &&
          candidate.sessionId === session.id &&
          candidate.remoteHost === details.destIP &&
          candidate.remotePort === details.destPort
      );
      if (!forward) {
        reject();
        return;
      }
      forward.onConnection(accept);
    };
    session.client.on("tcp connection", session.remoteForwardDispatcher);
  }

  return { serializeForward, closeLocalForward, closeForwardsForSession, createLocalForward, createRemoteForward };
}
