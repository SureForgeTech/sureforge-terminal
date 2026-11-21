// JSON response helpers for the Node backend, factored out of backend.mjs so
// they can be unit-tested without the module binding a port on import — the
// same reason backend-buffers.mjs and backend-lifecycle.mjs live outside it.
import { channel } from "node:diagnostics_channel";

import { PayloadTooLargeError } from "./backend-buffers.mjs";
import { HostKeyRejectedError } from "./backend-host-keys.mjs";
import { InvalidHostError } from "./backend-host-validation.mjs";
import { SshAuthRefusedError } from "./backend-ssh-auth.mjs";
import { SshConnectError } from "./backend-ssh-failure.mjs";
import { relayableFailureCode } from "./backend-failure-codes.mjs";
import { SftpOperationError } from "./backend-sftp-failure.mjs";
import {
  ForwardPortInUseError,
  InvalidForwardRequestError,
} from "./backend-forwards.mjs";

/**
 * #230: raw errors are published here instead of logged. A subscriber attached
 * in-process sees the original error object; nothing is printed or persisted by
 * default, so this adds no clear-text-logging sink — a plain
 * `console.error(error)` would have opened a fifth js/clear-text-logging alert
 * while closing the stack-trace-exposure one.
 *
 * Nothing subscribes yet. This is the seam #145 (no logging, diagnostics, or
 * crash reporting in the app) is meant to attach to, not a working diagnostic
 * on its own.
 */
export const HTTP_ERROR_DIAGNOSTIC_CHANNEL = "termsnip.backend.http-error";
const httpErrorDiagnostics = channel(HTTP_ERROR_DIAGNOSTIC_CHANNEL);

export function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

/**
 * Single response shape for every catch-block in the HTTP handlers. Audit
 * pickup: the pattern
 *   sendJson(response, 500, { error: getErrorMessage(error) })
 * was duplicated 16 times in backend.mjs, which made the contract implicit and
 * brittle (e.g. one site forgot the `error` key, would be hard to notice). Use
 * this helper instead.
 *
 * #230: the status still comes from the error where it carries one, but the
 * MESSAGE is never taken from the error. Client text is rebuilt from trusted
 * data only.
 *
 * Deny-by-default rather than "relay app-thrown messages, scrub library-thrown
 * ones", because that split does not survive this codebase: globSshConfigFiles
 * throws `glob directory ${parentReal} is not under ${sshRoot}` from
 * application code and interpolates two absolute paths. Where an error came
 * from is not a safety signal — and this function receives only an error and a
 * default status, so it could not decide provenance even if it were.
 */
export function respondError(response, error, status = 500) {
  // Honor a status the error carries (e.g. PayloadTooLargeError => 413) so
  // readJson's body-cap rejection surfaces as the right HTTP status.
  const statusCode = error?.statusCode ?? status;

  if (httpErrorDiagnostics.hasSubscribers) {
    httpErrorDiagnostics.publish({ error, statusCode });
  }

  let message =
    Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500
      ? "Invalid request."
      : "Internal server error.";

  // The types whose own text may be relayed. Each one is built by this
  // codebase from fixed text and a trusted label — never from the rejected
  // value, never from anything the caller supplied, never from a library's
  // own wording — so relaying it does not reopen the hole the deny-by-default
  // rule above closes.
  //
  // They are the failures whose reason the user has to act on:
  //
  // - a refused host key: the difference between "the host is unreachable"
  //   and "the key changed" (and, pre-authentication, no credentials were
  //   sent);
  // - a refused sign-in method or agent forwarding, which tells the user
  //   which host setting to change (#473);
  // - a rejected host request, which says what was wrong with the request;
  // - a failed connection, which is what the native shell already sends as a
  //   typed { code, message } (see src-tauri/src/ipc_error.rs);
  // - a refused file operation, where "permission denied" and "no such file"
  //   are the two a user meets most;
  // - a refused forward request, which names the port that is wrong.
  const RELAYED_TYPES = [
    HostKeyRejectedError,
    SshAuthRefusedError,
    InvalidHostError,
    SshConnectError,
    SftpOperationError,
    InvalidForwardRequestError,
    ForwardPortInUseError,
  ];
  const isRelayedType = RELAYED_TYPES.some((type) => error instanceof type);
  if (isRelayedType) {
    message = error.message;
  }

  // The other exception: a size limit is a number this process chose, not
  // anything the error text carried, and a user hitting an upload cap needs it.
  if (
    statusCode === 413 &&
    error instanceof PayloadTooLargeError &&
    Number.isSafeInteger(error.limit) &&
    error.limit > 0
  ) {
    message = `Request body exceeds the ${error.limit}-byte limit.`;
  }

  // A typed failure carries its category alongside the message, so the client
  // can classify it (and must not retry a refused sign-in or a changed host
  // key) without reading the text. The category travels only with a relayed
  // message, and only when it is one of a fixed set the backend chose — never
  // text from the error. The same check the websocket path makes.
  const code = isRelayedType ? relayableFailureCode(error) : undefined;

  sendJson(response, statusCode, code ? { error: message, code } : { error: message });
}
