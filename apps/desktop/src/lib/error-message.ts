/**
 * One way to turn a caught value into text a person can read.
 *
 * Commands migrated to the typed `IpcError` (#203, #485) reject with a plain
 * `{ code, message }` object, which is neither an `Error` nor a string. The
 * old pattern (an `instanceof Error` check falling back to `String(error)`) turns
 * that into "[object Object]". Every caller that shows or logs an error goes
 * through this instead.
 */
import { isSshErrorCategory, type SshErrorCategory } from "./ssh-error-classifier";

/** Shown when a failure carries no usable text, so an error is never blank. */
export const UNKNOWN_ERROR_MESSAGE = "The action failed, and no reason was given.";

export function errorMessageFromUnknown(
  error: unknown,
  fallback: string = UNKNOWN_ERROR_MESSAGE
): string {
  let message = "";
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else if (typeof error === "object" && error !== null && "message" in error) {
    const value = (error as { message: unknown }).message;
    message = typeof value === "string" ? value : "";
  } else if (typeof error === "number" || typeof error === "boolean") {
    message = String(error);
  }
  // A blank message would hide an error banner that renders only when its
  // text is non-empty, and "[object Object]" tells nobody anything.
  return message.trim() ? message : fallback;
}

/**
 * The Node backend answers a failed request with `{"error": "..."}`. Show the
 * message, not the JSON. A body that is not that shape is shown as it is, and
 * an empty body or empty message falls back to the status code.
 */
export function backendErrorMessageFromBody(body: string, status: number): string {
  if (body) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof (parsed as { error?: unknown }).error === "string"
      ) {
        const message = (parsed as { error: string }).error;
        return message.trim() ? message : `Backend request failed: ${status}`;
      }
    } catch {
      // Not JSON: keep the raw text.
    }
    return body;
  }
  return `Backend request failed: ${status}`;
}

/**
 * The failure code a backend body carries, when it carries one.
 *
 * A failed connection answers with the category beside the message — the same
 * typed `{ code, message }` shape the native shell sends (see
 * src-tauri/src/ipc_error.rs). The classifier reads the code first, so a
 * refused sign-in stays a refused sign-in and is not retried; reading the
 * message alone would classify it as unknown, and an unknown failure is
 * retried.
 *
 * Only a category this app knows is returned: anything else is ignored, so a
 * body cannot steer the retry policy with a code of its own.
 */
export function backendErrorCodeFromBody(body: string): SshErrorCategory | undefined {
  if (!body) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "code" in parsed) {
      const code = (parsed as { code: unknown }).code;
      if (isSshErrorCategory(code)) {
        return code;
      }
    }
  } catch {
    // Not JSON: there is no code.
  }
  return undefined;
}
