import { describe, expect, it } from "vitest";

import {
  backendErrorMessageFromBody,
  errorMessageFromUnknown,
  UNKNOWN_ERROR_MESSAGE,
} from "./error-message";

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

  it("never returns blank text or [object Object]", () => {
    for (const value of [undefined, null, "", "   ", { message: null }, { message: "" }, { reason: "x" }, new Error("")]) {
      expect(errorMessageFromUnknown(value)).toBe(UNKNOWN_ERROR_MESSAGE);
    }
    expect(errorMessageFromUnknown({ reason: "x" }, "Custom fallback.")).toBe("Custom fallback.");
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

  it("falls back to the status for an empty body or an empty message", () => {
    expect(backendErrorMessageFromBody("", 503)).toBe("Backend request failed: 503");
    expect(backendErrorMessageFromBody('{"error":""}', 500)).toBe("Backend request failed: 500");
  });
});
