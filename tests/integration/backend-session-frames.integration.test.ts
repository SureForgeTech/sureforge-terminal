// The frame a failed session sends.
//
// The category beside the message is what the renderer's retry policy reads:
// a refused sign-in and a changed host key must never be retried (repeated
// failed logins can lock the account, and a machine-in-the-middle signal is
// not something to keep knocking on the door about). The frame builder lives
// in its own module so it can be tested without importing backend.mjs, which
// binds a port on import.

import { describe, expect, it } from "vitest";

import { sessionFailureFrame } from "../../apps/desktop/server/backend-session-frames.mjs";
import { classifySshError } from "../../apps/desktop/src/lib/ssh-error-classifier";
import { shouldScheduleReconnect } from "../../apps/desktop/src/components/terminal/connect-failure-policy";

describe("the frame a failed session sends", () => {
  it("carries the category beside the message", () => {
    const frame = sessionFailureFrame({
      failureMessage: "gateway.internal:22 refused the sign-in. Check the username.",
      failureCode: "auth_failed",
    });

    expect(frame).toEqual({
      type: "error",
      message: "gateway.internal:22 refused the sign-in. Check the username.",
      code: "auth_failed",
    });
  });

  it("omits the category when there is none", () => {
    const frame = sessionFailureFrame({
      failureMessage: "The host did not open a shell within 30 seconds.",
      failureCode: null,
    });

    expect(frame).toEqual({
      type: "error",
      message: "The host did not open a shell within 30 seconds.",
    });
  });

  it("carries a category the client will not retry", () => {
    for (const code of ["auth_failed", "host_key_mismatch"]) {
      const frame = sessionFailureFrame({
        failureMessage: "Something the user has to act on.",
        failureCode: code,
      });

      const classified = classifySshError(frame);
      expect(classified.category).toBe(code);
      expect(
        shouldScheduleReconnect(classified.category, {
          connectedOnce: true,
          reconnectOnRestore: true,
        }),
        code
      ).toBe(false);
    }
  });
});
