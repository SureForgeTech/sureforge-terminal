// The reason a file operation on the remote host failed.
//
// The SFTP protocol reports a failure with a status code, and ssh2 turns it
// into an Error whose `code` is that number. The server may also put its own
// text in the message — which is text from the far end, and #230 does not let
// that reach a client.
//
// So the status code is turned into fixed text here, and the code itself
// decides what the client is told and with which HTTP status. A file browser
// that says "Permission denied" and says what to do about it is a file
// browser; one that says "Internal server error." is a file browser that
// cannot be used.

/**
 * The SFTP status codes (RFC draft-ietf-secsh-filexfer-02, as ssh2 numbers
 * them). ssh2's own table is the reference: lib/protocol/SFTP.js.
 */
export const SFTP_STATUS = Object.freeze({
  ok: 0,
  eof: 1,
  noSuchFile: 2,
  permissionDenied: 3,
  failure: 4,
  badMessage: 5,
  noConnection: 6,
  connectionLost: 7,
  operationUnsupported: 8,
});

/**
 * A file operation that failed for a reason the user can act on.
 *
 * Its message is fixed text; the server's own wording stays on the server as
 * the error's `cause`.
 */
export class SftpOperationError extends Error {
  constructor(message, { statusCode = 502, cause } = {}) {
    super(message, { cause });
    this.name = "SftpOperationError";
    this.statusCode = statusCode;
  }
}

/**
 * The fixed text and HTTP status for an SFTP status code.
 *
 * The status is the one the client should act on: a missing path is a 404, a
 * refused path is a 403, and an operation the server does not implement is a
 * 501. The rest are the server failing to do something it accepted, which is
 * a 502 — the request was fine, the upstream was not.
 */
export function sftpOperationFailureMessage(code) {
  switch (code) {
    case SFTP_STATUS.noSuchFile:
      return {
        message: "That path does not exist on the server.",
        statusCode: 404,
      };
    case SFTP_STATUS.permissionDenied:
      return {
        message:
          "The server refused access to that path. Check the account's permissions for it.",
        statusCode: 403,
      };
    case SFTP_STATUS.operationUnsupported:
      return {
        message: "The server does not support that operation over SFTP.",
        statusCode: 501,
      };
    case SFTP_STATUS.failure:
      return {
        message: "The server could not complete that operation.",
        statusCode: 502,
      };
    case SFTP_STATUS.badMessage:
      return {
        message: "The server sent a reply the browser could not read.",
        statusCode: 502,
      };
    case SFTP_STATUS.noConnection:
    case SFTP_STATUS.connectionLost:
      return {
        message: "The connection to the server was lost during the file operation.",
        statusCode: 502,
      };
    default:
      return {
        message: "The file operation failed on the server.",
        statusCode: 502,
      };
  }
}

/**
 * Turn an SFTP failure into the error the client is told about.
 *
 * An error that is not an SFTP status failure (a timeout, a transport
 * failure) keeps its own type: the deadline error already carries a status
 * the HTTP layer honours, and a transport failure is reported as such.
 */
export function sftpOperationFailure(error) {
  if (error instanceof SftpOperationError) {
    return error;
  }
  if (typeof error?.code !== "number") {
    return error;
  }
  const { message, statusCode } = sftpOperationFailureMessage(error.code);
  return new SftpOperationError(message, { statusCode, cause: error });
}
