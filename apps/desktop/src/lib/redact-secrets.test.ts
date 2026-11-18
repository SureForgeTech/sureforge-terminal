import { describe, expect, it } from "vitest";

import { REDACTION_PLACEHOLDER, containsSecret, redactSecrets } from "./redact-secrets";

// The session history keeps a preview of what a command printed, and that
// preview is persisted across relaunches. A command that prints a secret
// leaves it in the history unless it is redacted — these tests pin the
// redaction that keeps the history without keeping the secret.

describe("redacting secrets", () => {
  it("masks a secret in an assignment", () => {
    expect(redactSecrets("password=hunter2")).toBe(`password=${REDACTION_PLACEHOLDER}`);
    expect(redactSecrets("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI")).toBe(
      `AWS_SECRET_ACCESS_KEY=${REDACTION_PLACEHOLDER}`
    );
    expect(redactSecrets('{"api_key": "abc123"}')).toBe(
      `{"api_key": "${REDACTION_PLACEHOLDER}"}`
    );
    expect(redactSecrets("token: s3cr3t")).toBe(`token: ${REDACTION_PLACEHOLDER}`);
  });

  it("masks the token shapes that are secrets by construction", () => {
    expect(redactSecrets("AKIAIOSFODNN7EXAMPLE")).toBe(REDACTION_PLACEHOLDER);
    expect(redactSecrets("ghp_abcdefghijklmnopqrstuvwxyz012345")).toBe(REDACTION_PLACEHOLDER);
    expect(redactSecrets("glpat-abcdefghijklmnopqrst")).toBe(REDACTION_PLACEHOLDER);
    expect(redactSecrets("xoxb-1234567890-abcdefghij")).toBe(REDACTION_PLACEHOLDER);
    expect(
      redactSecrets("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk")
    ).toBe(REDACTION_PLACEHOLDER);
    expect(
      redactSecrets(
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----"
      )
    ).toBe(REDACTION_PLACEHOLDER);
  });

  it("leaves ordinary output alone", () => {
    // A history that hides everything is a history nobody can search.
    const output = [
      "total 24",
      "drwxr-xr-x  4 ops  staff   128 Nov 17 09:12 .",
      "-rw-r--r--  1 ops  staff  1024 Nov 17 09:12 release.tar.gz",
      "Connection to gateway.internal closed.",
    ].join("\n");

    expect(redactSecrets(output)).toBe(output);
    expect(containsSecret(output)).toBe(false);
  });

  it("does not mask a name that only looks secret-like", () => {
    // The word alone is not a secret, and masking every line that mentions a
    // token would make the history useless.
    expect(redactSecrets("authorisation: granted")).toBe("authorisation: granted");
    expect(redactSecrets("tokenizer=fast")).toBe("tokenizer=fast");
    expect(redactSecrets("secretary=alice")).toBe("secretary=alice");
  });

  it("leaves an empty or already-redacted value alone", () => {
    expect(redactSecrets("password=")).toBe("password=");
    expect(redactSecrets(`password=${REDACTION_PLACEHOLDER}`)).toBe(
      `password=${REDACTION_PLACEHOLDER}`
    );
  });

  it("says whether there was anything to redact", () => {
    expect(containsSecret("password=hunter2")).toBe(true);
    expect(containsSecret("nothing here")).toBe(false);
    expect(containsSecret("")).toBe(false);
  });
});
