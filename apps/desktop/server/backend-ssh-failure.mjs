// The reason an SSH connection failed, in the shape the renderer can act on.
//
// The native shell answers a failed command with a typed `{ code, message }`
// (src-tauri/src/ipc_error.rs), and the frontend classifier reads that code
// first and falls back to its prose rules
// (apps/desktop/src/lib/ssh-error-classifier.ts). The browser backend answered
// with a bare string, so `respondError` rebuilt every SSH failure as
// "Internal server error." — the one message that names no cause, and that
// the classifier cannot categorise.
//
// The codes are the SAME names the classifier already uses. That matters for
// more than the wording: the renderer's retry policy (#373) must not retry a
// refused sign-in, because repeated failed logins can lock the account. A
// typed code keeps that decision on the same footing as the native shell.
//
// The message is built from fixed text and the host label only. #230 denies
// relaying an arbitrary error message, so the underlying ssh2 error stays on
// the server as the error's `cause` and is never sent to a client over HTTP.
//
// The websocket path is a separate contract: a session frame carries the
// real message, because that is what the terminal has always shown for a
// failure it could not classify (see the source-contract test in
// tests/integration/backend-responses.integration.test.ts). What the code
// adds there is the category, so that a failure the text cannot describe is
// still classified.

import { HostKeyRejectedError, safeHostLabel } from "./backend-host-keys.mjs";
import { InvalidHostError } from "./backend-host-validation.mjs";
import { SshAuthRefusedError } from "./backend-ssh-auth.mjs";
import { OperationTimeoutError } from "./backend-deadline.mjs";
import { SSH_FAILURE_CODES } from "./backend-failure-codes.mjs";

// The codes live in a leaf module of their own, because the host-key and
// sign-in refusals need them too and those modules are imported here.
// Re-exported so callers can keep importing them from one place.
export { SSH_FAILURE_CODES, SSH_FAILURE_CODE_VALUES } from "./backend-failure-codes.mjs";

/**
 * A connection that failed for a reason the user can act on.
 *
 * It carries the code the renderer branches on and a message built from fixed
 * text, so `respondError` can relay both without relaying arbitrary error
 * text.
 */
export class SshConnectError extends Error {
  constructor(message, { code = SSH_FAILURE_CODES.internal, cause, level } = {}) {
    super(message, { cause });
    this.name = "SshConnectError";
    this.code = code;
    // 502: the request was well formed and the SSH server — or the network in
    // front of it — failed to answer. A retry can succeed once the host or
    // the network recovers.
    this.statusCode = 502;
    // ssh2 tags its errors with a level, and the failure-stage mapping keys
    // off it (see sshFailureStage). Keeping the original level means a
    // wrapped error is still classified as the same stage it always was, so
    // the command path keeps reporting the stage it reported before.
    if (level) {
      this.level = level;
    }
  }
}

/**
 * The code for an ssh2 (or socket) failure.
 *
 * The levels are the ones ssh2 assigns in lib/client.js: `client-dns` for a
 * lookup that failed, `client-socket` for a socket error, `client-timeout`
 * for its own connect timeout, and `client-authentication` for a refused
 * sign-in. A socket error keeps the operating system's own code, which is
 * what separates "nothing is listening" from "no route to host".
 */
export function sshConnectFailureCode(error) {
  // A private key that could not be parsed is ssh2's own error, thrown
  // synchronously out of client.connect() before anything is sent. It has no
  // level, and it is nearly always a wrong passphrase or the wrong file —
  // either way, another attempt with the same key fails the same way.
  if (isUnusablePrivateKeyError(error)) {
    return SSH_FAILURE_CODES.authFailed;
  }
  const level = error?.level;
  if (level === "client-dns") {
    return SSH_FAILURE_CODES.dnsFailure;
  }
  if (level === "client-timeout") {
    return SSH_FAILURE_CODES.timeout;
  }
  if (level === "client-authentication" || level === "agent") {
    return SSH_FAILURE_CODES.authFailed;
  }
  if (level === "client-socket") {
    switch (error?.code) {
      case "ECONNREFUSED":
        return SSH_FAILURE_CODES.refused;
      case "ETIMEDOUT":
        return SSH_FAILURE_CODES.timeout;
      default:
        return SSH_FAILURE_CODES.networkUnreachable;
    }
  }
  return SSH_FAILURE_CODES.internal;
}

/**
 * Whether an error is ssh2 refusing to use the private key it was given.
 *
 * ssh2 throws these synchronously out of client.connect(): the key could not
 * be parsed (usually a wrong passphrase), or it is not a key at all. The text
 * is the library's own, and it is only used to RECOGNISE the failure — the
 * message the client sees is built here, from fixed text.
 */
export function isUnusablePrivateKeyError(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  return (
    message.startsWith("Cannot parse privateKey:") ||
    message.startsWith("privateKey value does not contain")
  );
}

/**
 * The message for a failed connection.
 *
 * Every sentence here is fixed text; only the host label is interpolated, and
 * that label is sanitised by `safeHostLabel` — the same helper the host-key
 * messages use, because a hostname carrying a control character would be
 * rendered by the terminal as an escape sequence.
 */
export function sshConnectFailureMessage(code, label) {
  switch (code) {
    case SSH_FAILURE_CODES.dnsFailure:
      return (
        `Could not resolve the host name for ${label}. Check the host's address, ` +
        "and your DNS or VPN if the host is on an internal network."
      );
    case SSH_FAILURE_CODES.refused:
      return (
        `Could not connect to ${label}: nothing is listening on that port. ` +
        "Check the port number and that the SSH server is running."
      );
    case SSH_FAILURE_CODES.networkUnreachable:
      return (
        `Could not reach ${label}. Check your network connection, your VPN and ` +
        "the firewall rules for this host."
      );
    case SSH_FAILURE_CODES.timeout:
      return `The connection to ${label} timed out before the host answered.`;
    case SSH_FAILURE_CODES.authFailed:
      return (
        `${label} refused the sign-in. Check the username, and the password or ` +
        "the key for this host."
      );
    default:
      return `Could not open an SSH session with ${label}.`;
  }
}

/**
 * Turn a failed connection into the error the client is told about.
 *
 * An error that already carries a user-facing reason keeps it: a refused host
 * key, a refused sign-in method and a rejected host request each say
 * something more specific than a connection failure can.
 */
export function sshConnectFailure(error, host) {
  if (
    error instanceof HostKeyRejectedError ||
    error instanceof SshAuthRefusedError ||
    error instanceof InvalidHostError ||
    error instanceof SshConnectError
  ) {
    return error;
  }

  // A deadline is already typed and already carries a status the HTTP layer
  // honours; wrapping it would turn a timeout into a generic failure.
  if (error instanceof OperationTimeoutError) {
    return error;
  }

  const code = sshConnectFailureCode(error);
  const label = safeHostLabel(host?.hostname, host?.port);
  // A private key that could not be read is its own reason: no sign-in was
  // attempted, so "the host refused the sign-in" would be a lie. It is still
  // not worth retrying with the same key.
  if (isUnusablePrivateKeyError(error)) {
    return new SshConnectError(
      "The private key could not be read. Check the key path, and the passphrase if it has one.",
      { code, cause: error, level: error?.level }
    );
  }
  return new SshConnectError(sshConnectFailureMessage(code, label), {
    code,
    cause: error,
    level: error?.level,
  });
}
