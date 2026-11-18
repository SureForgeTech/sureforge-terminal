// The browser backend's file operations and forward requests.
//
// A file operation that the server refused used to reach the client as
// "Internal server error.": "Permission denied" and "No such file" are the
// two failures a user meets most, and neither names a cause. The server may
// also put its own wording in the error message, which #230 does not let
// reach a client — so the SFTP status code is what the message is built
// from, and the server's text stays on the server.

import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import {
  SFTP_STATUS,
  SftpOperationError,
  sftpOperationFailure,
  sftpOperationFailureMessage,
} from "../../apps/desktop/server/backend-sftp-failure.mjs";
import {
  InvalidForwardRequestError,
  validateForwardPorts,
} from "../../apps/desktop/server/backend-forwards.mjs";

/**
 * A response the download can write into: a real Writable, so the pipeline
 * behaves as it does in production, with the HTTP bits the backend calls.
 */
function downloadResponse() {
  const response = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  return Object.assign(response, { writeHead: () => {} });
}

function denied() {
  return Object.assign(new Error("Permission denied"), {
    code: SFTP_STATUS.permissionDenied,
  });
}

describe("a refused file operation", () => {
  it("says what the server refused and why it matters", () => {
    const denied = sftpOperationFailure(
      Object.assign(new Error("Permission denied"), { code: SFTP_STATUS.permissionDenied })
    );
    expect(denied).toBeInstanceOf(SftpOperationError);
    expect(denied.message).toContain("refused access");
    expect(denied.message).toContain("permissions");
    expect(denied.statusCode).toBe(403);

    const missing = sftpOperationFailure(
      Object.assign(new Error("No such file or directory"), { code: SFTP_STATUS.noSuchFile })
    );
    expect(missing.message).toContain("does not exist");
    expect(missing.statusCode).toBe(404);
  });

  it("never relays the server's own wording", () => {
    // The message may carry text from the far end. It must not reach a
    // client: the fixed text is built from the status code alone.
    const sentinel = "TS_SFTP_SERVER_TEXT_PROBE_4c81a2";
    const failure = sftpOperationFailure(
      Object.assign(new Error(`Permission denied: ${sentinel}`), {
        code: SFTP_STATUS.permissionDenied,
      })
    );

    expect(failure.message).not.toContain(sentinel);
    expect(failure.message).toContain("refused access");
    // The server's wording stays on the server, as the cause.
    expect(String(failure.cause?.message)).toContain(sentinel);
  });

  it("maps every status ssh2 can report", () => {
    for (const code of Object.values(SFTP_STATUS)) {
      if (code === SFTP_STATUS.ok || code === SFTP_STATUS.eof) {
        continue;
      }
      const { message, statusCode } = sftpOperationFailureMessage(code);
      expect(message).not.toBe("");
      expect(statusCode).toBeGreaterThanOrEqual(400);
    }
  });

  it("leaves an error that is not an SFTP status alone", () => {
    // A deadline error already carries a status the HTTP layer honours, and
    // a transport failure is reported as such — wrapping it would replace a
    // specific reason with a vague one.
    const timeout = Object.assign(new Error("operation did not finish within 30000ms"), {
      statusCode: 504,
    });
    expect(sftpOperationFailure(timeout)).toBe(timeout);

    const plain = new Error("something else");
    expect(sftpOperationFailure(plain)).toBe(plain);
  });
});

describe("a refused forward request", () => {
  it("wraps the failure the server reports on every operation", async () => {
    // The helper is not enough on its own: the operations have to use it, or
    // the raw server error still reaches the HTTP layer and is rebuilt as
    // "Internal server error.". Every operation that can fail is driven
    // here, because one covered path proves nothing about the other five.
    const { createSftpOperations } = await import(
      "../../apps/desktop/server/backend-sftp-ops.mjs"
    );

    const failing = (error: Error) => error;
    const operations = [
      {
        name: "listing a directory",
        run: (ops: ReturnType<typeof createSftpOperations>) =>
          ops.listRemoteDirectory({ hostname: "gateway.internal", port: 22 }, "/etc"),
        sftp: { readdir: (_path: string, cb: (error: Error) => void) => cb(failing(denied())) },
      },
      {
        name: "making a directory",
        run: (ops: ReturnType<typeof createSftpOperations>) =>
          ops.createRemoteDirectory({ hostname: "gateway.internal", port: 22 }, "/etc/new"),
        sftp: { mkdir: (_path: string, cb: (error: Error) => void) => cb(failing(denied())) },
      },
      {
        name: "renaming an entry",
        run: (ops: ReturnType<typeof createSftpOperations>) =>
          ops.renameRemoteEntry(
            { hostname: "gateway.internal", port: 22 },
            "/etc/a",
            "/etc/b"
          ),
        sftp: {
          rename: (_from: string, _to: string, cb: (error: Error) => void) =>
            cb(failing(denied())),
        },
      },
      {
        name: "deleting an entry",
        run: (ops: ReturnType<typeof createSftpOperations>) =>
          ops.deleteRemoteEntry({ hostname: "gateway.internal", port: 22 }, "/etc/a", false),
        sftp: { unlink: (_path: string, cb: (error: Error) => void) => cb(failing(denied())) },
      },
      {
        name: "uploading a file",
        run: (ops: ReturnType<typeof createSftpOperations>) =>
          ops.uploadRemoteFile({ hostname: "gateway.internal", port: 22 }, "/etc/a", "aGk="),
        sftp: {
          // The write is what fails, not the open: the open has to succeed for
          // the upload to reach the write, and the write's reason is the one
          // that has to survive the close that follows it.
          open: (_path: string, _mode: string, cb: (error: Error, handle?: unknown) => void) =>
            cb(undefined, Buffer.from("handle")),
          write: (
            _handle: unknown,
            _buffer: unknown,
            _offset: number,
            _length: number,
            _position: number,
            cb: (error: Error) => void
          ) => cb(failing(denied())),
          close: (_handle: unknown, cb: (error?: Error) => void) => cb(undefined),
        },
      },
      {
        name: "uploading a file whose close fails",
        run: (ops: ReturnType<typeof createSftpOperations>) =>
          ops.uploadRemoteFile({ hostname: "gateway.internal", port: 22 }, "/etc/a", "aGk="),
        sftp: {
          // The write succeeds and the close fails: the close is reported on
          // its own, since there is no earlier reason to report.
          open: (_path: string, _mode: string, cb: (error: Error, handle?: unknown) => void) =>
            cb(undefined, Buffer.from("handle")),
          write: (
            _handle: unknown,
            _buffer: unknown,
            _offset: number,
            _length: number,
            _position: number,
            cb: (error: Error) => void
          ) => cb(undefined),
          close: (_handle: unknown, cb: (error?: Error) => void) => cb(denied()),
        },
      },
      {
        name: "downloading a file",
        run: (ops: ReturnType<typeof createSftpOperations>) =>
          ops.sendRemoteFile(
            downloadResponse(),
            { hostname: "gateway.internal", port: 22 },
            "/etc/a"
          ),
        sftp: {
          // The stat succeeds and the read fails: the file can vanish between
          // the two, and that failure is an SFTP status failure too.
          stat: (_path: string, cb: (error: Error, stats?: unknown) => void) =>
            cb(undefined, { size: 1 }),
          createReadStream: () => {
            const stream = new PassThrough();
            process.nextTick(() => stream.emit("error", denied()));
            return stream;
          },
        },
      },
    ];

    for (const operation of operations) {
      const built = createSftpOperations({
        withSftp: async (
          _host: unknown,
          optionsOrRun: unknown,
          maybeRun?: unknown
        ): Promise<unknown> => {
          // withSftp takes (host, callback) for a control operation and
          // (host, options, callback) when it carries a deadline.
          const run =
            typeof optionsOrRun === "function" ? optionsOrRun : maybeRun;
          return (run as (handle: unknown) => Promise<unknown>)({
            sftp: operation.sftp,
            onTimeout: () => {},
            resetDeadline: () => {},
          });
        },
      });

      const failure = await operation
        .run(built)
        .catch((error: unknown) => error);

      expect(failure, operation.name).toBeInstanceOf(SftpOperationError);
      expect((failure as Error).message, operation.name).toContain("refused access");
      expect((failure as { statusCode?: number }).statusCode, operation.name).toBe(403);
    }
  });

  it("names the port that is wrong", () => {
    // A local forward binds the local port (0 asks for an automatic one) and
    // reaches the remote port; a remote forward is the other way round.
    expect(() => validateForwardPorts({ direction: "local", localPort: 99999, remotePort: 22 })).toThrow(
      /Local bind port must be 0 \(automatic\) or 1-65535/
    );
    expect(() => validateForwardPorts({ direction: "local", localPort: 8080, remotePort: 0 })).toThrow(
      /Remote destination port must be 1-65535/
    );
    expect(() => validateForwardPorts({ direction: "remote", localPort: 0, remotePort: 22 })).toThrow(
      /Local destination port must be 1-65535/
    );
  });

  it("is a typed error, so the message reaches the client", () => {
    // A plain Error would be rebuilt as "Internal server error." — no help to
    // someone who mistyped a port number.
    try {
      validateForwardPorts({ direction: "local", localPort: NaN, remotePort: 22 });
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidForwardRequestError);
      expect((error as Error).message).toContain("Local bind port");
      expect((error as { statusCode?: number }).statusCode).toBe(400);
    }
  });

  it("accepts the ports it should", () => {
    expect(() => validateForwardPorts({ direction: "local", localPort: 0, remotePort: 22 })).not.toThrow();
    expect(() => validateForwardPorts({ direction: "local", localPort: 8080, remotePort: 443 })).not.toThrow();
    expect(() => validateForwardPorts({ direction: "remote", localPort: 8080, remotePort: 22 })).not.toThrow();
  });
});
