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
 * Whether the server refused to open the SFTP subsystem.
 *
 * ssh2 answers a refused subsystem with its own wording — "Unable to start
 * subsystem: sftp" — and that wording is text from the far end, which #230
 * does not let reach a client. The refusal is recognised here and replaced
 * with fixed text that names the cause, the way every other SFTP failure is.
 *
 * The wording is matched exactly, not loosely. A transport failure whose text
 * mentions a subsystem — "Connection reset while negotiating subsystem", or a
 * channel-open description from the far end — is a temporary failure, not
 * proof that the server has no SFTP, and calling it one would tell the user
 * their server cannot do file transfers when it only needed to try again.
 */
export function isSftpSubsystemUnavailable(error) {
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  return message === "Unable to start subsystem: sftp";
}

/**
 * The failure the client is told about when the server has no SFTP
 * subsystem.
 *
 * 501, the same status as an operation the server does not implement: the
 * request was fine and the server cannot do it.
 */
export function sftpSubsystemUnavailableFailure(error) {
  return new SftpOperationError(
    "That server does not offer the SFTP subsystem, so its files cannot be browsed.",
    { statusCode: 501, cause: error }
  );
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
  // Only a status code this table knows is an SFTP failure. A number is not
  // proof of that: an SSH disconnect reason is numeric too, and some of its
  // values collide with the status numbers. An unrecognised code is left
  // alone rather than turned into a file-operation message that may be wrong.
  if (!Object.values(SFTP_STATUS).includes(error?.code)) {
    return error;
  }
  const { message, statusCode } = sftpOperationFailureMessage(error.code);
  return new SftpOperationError(message, { statusCode, cause: error });
}
