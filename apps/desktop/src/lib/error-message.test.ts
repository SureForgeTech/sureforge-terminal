import { describe, expect, it } from "vitest";

import { backendErrorMessageFromBody, errorMessageFromUnknown } from "./error-message";

describe("errorMessageFromUnknown", () => {
  it("reads an Error, a string, and a typed { code, message } IPC rejection", () => {
    expect(errorMessageFromUnknown(new Error("boom"))).toBe("boom");
    expect(errorMessageFromUnknown("plain text")).toBe("plain text");
    expect(
      errorMessageFromUnknown({ code: "timeout", message: "Connection timed out" })
    ).toBe("Connection timed out");
  });

  it("never returns [object Object] for an object that carries a message", () => {
    expect(errorMessageFromUnknown({ code: "internal", message: "disk full" })).not.toContain(
      "[object Object]"
    );
  });

  it("handles empty values without throwing", () => {
    expect(errorMessageFromUnknown(undefined)).toBe("");
    expect(errorMessageFromUnknown(null)).toBe("");
    expect(errorMessageFromUnknown({ message: null })).toBe("");
  });
});

describe("backendErrorMessageFromBody", () => {
  it("unwraps the Node backend's { error } body", () => {
    expect(backendErrorMessageFromBody('{"error":"Internal server error."}', 500)).toBe(
      "Internal server error."
    );
  });

  it("keeps a body that is not that shape as it is", () => {
    expect(backendErrorMessageFromBody("upstream timed out", 502)).toBe("upstream timed out");
    expect(backendErrorMessageFromBody('{"detail":"x"}', 400)).toBe('{"detail":"x"}');
  });

  it("falls back to the status for an empty body", () => {
    expect(backendErrorMessageFromBody("", 503)).toBe("Backend request failed: 503");
  });
});
