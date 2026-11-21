// The failure categories this backend puts on the wire.
//
// The category is what the renderer's retry policy reads: a refused sign-in
// and a changed host key must never be retried (repeated failed logins can
// lock the account, and a machine-in-the-middle signal is not something to
// keep knocking on the door about). So the decision of WHICH code may go on
// the wire is a security-relevant one, and it lives in a function that can be
// tested rather than in a line that can only be matched by its text.

import { describe, expect, it } from "vitest";

import {
  SSH_FAILURE_CODES,
  SSH_FAILURE_CODE_VALUES,
  relayableFailureCode,
} from "../../apps/desktop/server/backend-failure-codes.mjs";
import { classifySshError } from "../../apps/desktop/src/lib/ssh-error-classifier";
import { shouldScheduleReconnect } from "../../apps/desktop/src/components/terminal/connect-failure-policy";

describe("the failure code that goes on the wire", () => {
  it("relays a category the backend chose", () => {
    expect(relayableFailureCode({ code: SSH_FAILURE_CODES.authFailed })).toBe("auth_failed");
    expect(relayableFailureCode({ code: SSH_FAILURE_CODES.hostKeyMismatch })).toBe(
      "host_key_mismatch"
    );
  });

  it("drops a code the backend did not choose", () => {
    // An error can carry any `code` property — a Node error code, say — and
    // an arbitrary one must not go on the wire.
    expect(relayableFailureCode({ code: "ERR_STREAM_DESTROYED" })).toBeUndefined();
    expect(relayableFailureCode({ code: "ENOENT" })).toBeUndefined();
    expect(relayableFailureCode({ code: 42 })).toBeUndefined();
    expect(relayableFailureCode(new Error("no code here"))).toBeUndefined();
    expect(relayableFailureCode(undefined)).toBeUndefined();
  });

  it("covers exactly the categories the client knows", () => {
    for (const code of SSH_FAILURE_CODE_VALUES) {
      expect(relayableFailureCode({ code })).toBe(code);
    }
  });

  it("is a category the client will not retry", () => {
    for (const code of ["auth_failed", "host_key_mismatch"]) {
      const classified = classifySshError({ code, message: "Something to act on." });
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
