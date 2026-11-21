// The frame a failed session sends to the client.
//
// It lives in its own module so it can be tested without importing
// backend.mjs, which binds a port on import. The frame carries the CATEGORY
// beside the message, and the category is what the renderer's retry policy
// reads: a refused sign-in and a changed host key must never be retried
// (repeated failed logins can lock the account, and a machine-in-the-middle
// signal is not something to keep knocking on the door about).

/**
 * The frame for a session failure.
 *
 * The message is the session's remembered reason; the category is only
 * included when there is one, and it is only ever one this backend chose —
 * `failSession` checks it against the fixed set before storing it.
 */
export function sessionFailureFrame(session) {
  return {
    type: "error",
    message: session.failureMessage,
    ...(session.failureCode ? { code: session.failureCode } : {}),
  };
}
