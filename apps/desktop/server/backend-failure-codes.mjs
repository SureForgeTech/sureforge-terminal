// The failure categories the client branches on.
//
// They live in their own leaf module because three different modules need
// them — the connection failures, the host-key refusals and the sign-in
// refusals — and those modules already import each other, so a shared set
// placed in any one of them would be a cycle.
//
// The names are the ones `apps/desktop/src/lib/ssh-error-classifier.ts`
// accepts and the ones `src-tauri/src/ipc_error.rs` serialises, so a
// browser-mode failure and a native-mode failure of the same kind are
// categorised the same way.
//
// A category matters for more than the wording: the renderer's retry policy
// (#373) must not retry a refused sign-in or a changed host key, because
// repeated failed logins can lock the account and a machine-in-the-middle
// signal is not something to keep knocking on the door about.

export const SSH_FAILURE_CODES = Object.freeze({
  authFailed: "auth_failed",
  hostKeyMismatch: "host_key_mismatch",
  networkUnreachable: "network_unreachable",
  timeout: "timeout",
  refused: "refused",
  dnsFailure: "dns_failure",
  internal: "internal",
});

/**
 * The codes this backend is willing to put on the wire.
 *
 * An error can carry any `code` property — a Node error code, say — and
 * relaying an arbitrary one would put text on the wire that this backend
 * never chose. Only a category the client knows is relayed.
 */
export const SSH_FAILURE_CODE_VALUES = new Set(Object.values(SSH_FAILURE_CODES));
