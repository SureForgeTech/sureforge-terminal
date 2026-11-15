import type { SshErrorCategory } from "../../lib/ssh-error-classifier";

/**
 * #373: decide whether a failed connect should be retried automatically.
 *
 * A host-key mismatch is never retryable: the server presented a key that
 * does not match the pinned one, which is exactly the machine-in-the-middle
 * signal the check exists for. Retrying would re-send the connect against the
 * same untrusted key in a loop (and, before #203 typed the category, did so
 * silently once the pane had connected once). The user must re-scan and
 * explicitly trust the replacement key first.
 *
 * A refused login is not retried either: the same credentials will be refused
 * again, and repeated failed logins can lock the account or get this machine
 * banned by the server (fail2ban and similar). The user fixes the credentials
 * and reconnects.
 */
export function shouldScheduleReconnect(
  category: SshErrorCategory,
  state: { connectedOnce: boolean; reconnectOnRestore: boolean }
): boolean {
  if (category === "host_key_mismatch" || category === "auth_failed") {
    return false;
  }
  return state.connectedOnce || state.reconnectOnRestore;
}
