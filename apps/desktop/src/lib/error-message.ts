/**
 * One way to turn a caught value into text a person can read.
 *
 * Commands migrated to the typed `IpcError` (#203, #485) reject with a plain
 * `{ code, message }` object, which is neither an `Error` nor a string. The
 * old pattern (an `instanceof Error` check falling back to `String(error)`) turns
 * that into "[object Object]". Every caller that shows or logs an error goes
 * through this instead.
 */
export function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error as { message: unknown };
    return typeof message === "string" ? message : String(message ?? "");
  }
  return String(error ?? "");
}

/**
 * The Node backend answers a failed request with `{"error": "..."}`. Show the
 * message, not the JSON. A body that is not that shape is shown as it is, and
 * an empty body falls back to the status code.
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
        return (parsed as { error: string }).error;
      }
    } catch {
      // Not JSON: keep the raw text.
    }
    return body;
  }
  return `Backend request failed: ${status}`;
}
