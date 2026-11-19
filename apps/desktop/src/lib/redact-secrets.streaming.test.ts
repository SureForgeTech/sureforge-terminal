import { describe, expect, it } from "vitest";

import {
  OutputRedactor,
  REDACTED_PREVIEW_LIMIT,
  redactSecrets,
  stripTerminalCodes,
} from "./redact-secrets";

// The redaction of a stream of output has to be the same as the redaction
// of the whole output.
//
// The terminal writes a command's output in pieces, and a secret can be
// split across two of them — the name in one, the value in the next, a
// colour code in between, a key block that arrives in fifty. So the
// streaming redaction has to see enough context to recognise the secret
// wherever the pieces fall.
//
// These tests are that property: the same output, split at every possible
// place, has to produce the same preview as the output in one piece.

const FIXTURES: string[] = [
  "password=synthetic-value\n",
  '{"accessToken":"synthetic-value"}\n',
  'password="secret with spaces"\n',
  "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----\n",
  `-----BEGIN RSA PRIVATE KEY-----\n${"A".repeat(5_000)}\n-----END RSA PRIVATE KEY-----\n`,
  "ghp_abcdefghijklmnopqrstuvwxyz012345\n",
  "github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz\n",
  "tokenizer=fast\n",
  "tokenizer=fa\nst\nnext\n",
  "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI\n",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk\n",
  "pass[32mword=synthetic-value\n",
  "password=\n\nsynthetic-value\n",
  `password=${" ".repeat(200)}synthetic-value\n`,
  '{"url": "http://example.com/x"}\n',
  "no secrets here\n",
  "clientSecret=opaque-value\n",
  "-----BEGIN not a key\nordinary output\n",
  "key=release\n",
  'secret=""\n',
  "a=b c=d\n",
  "AKIAIOSFODNN7EXAMPLE\n",
  "xoxb-1234567890-abcdefghij\n",
  // A token inside an assignment that is not a secret.
  "key=ghp_abcdefghijklmnopqrstuvwxyz012345\n",
  "id=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk\n",
  // A key header whose first part is longer than a name.
  `-----BEGIN ${"A".repeat(129)}PRIVATE KEY-----\nsynthetic-value`,
  // A quote that is never closed.
  'password="secret with spaces\n',
  "password='unclosed\n",
];

/** The preview of the whole output, the way the whole-text redaction gives it. */
function wholeTextPreview(text: string): string {
  return redactSecrets(stripTerminalCodes(text)).slice(-REDACTED_PREVIEW_LIMIT).trim();
}

describe("redacting a stream of output", () => {
  it("gives the same preview as the whole output, however it is split", () => {
    for (const text of FIXTURES) {
      const expected = wholeTextPreview(text);

      const whole = new OutputRedactor();
      whole.append(text);
      expect(whole.append(""), text).toBe(expected);

      // The long fixtures are split at a few places only: every split of
      // every fixture is quadratic in the fixture's length.
      const step = text.length > 2_000 ? Math.ceil(text.length / 40) : 1;
      for (let split = 1; split < text.length; split += step) {
        const redactor = new OutputRedactor();
        redactor.append(text.slice(0, split));
        redactor.append(text.slice(split));
        expect(redactor.append(""), `split at ${split} of ${JSON.stringify(text)}`).toBe(
          expected
        );
      }
    }
  });

  it("gives the same preview when the output arrives in three pieces", () => {
    for (const text of FIXTURES.filter((fixture) => fixture.length < 120)) {
      const expected = wholeTextPreview(text);

      for (let first = 1; first < text.length; first += 1) {
        for (let second = first + 1; second < text.length; second += 1) {
          const redactor = new OutputRedactor();
          redactor.append(text.slice(0, first));
          redactor.append(text.slice(first, second));
          redactor.append(text.slice(second));
          expect(
            redactor.append(""),
            `split at ${first},${second} of ${JSON.stringify(text)}`
          ).toBe(expected);
        }
      }
    }
  });

  it("holds back only what could still change", () => {
    // What is held is an assignment waiting for its value, a run of name
    // characters, or the body of a key block — never the output it has
    // already released.
    const redactor = new OutputRedactor();
    for (let index = 0; index < 500; index += 1) {
      redactor.append("some ordinary output line\n");
    }

    expect(redactor.heldLength).toBeLessThanOrEqual(64);
    expect(redactor.append("").length).toBeLessThanOrEqual(REDACTED_PREVIEW_LIMIT);
  });

  it("keeps up with a long stream of small writes", () => {
    // The cost of a piece of output must not grow with the output seen so
    // far: a command that writes a little, very often, must not freeze the
    // app.
    const redactor = new OutputRedactor();
    const started = Date.now();
    for (let index = 0; index < 4_000; index += 1) {
      redactor.append("abcdefghij");
    }

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(redactor.heldLength).toBeLessThanOrEqual(64);
  });

  it("does not hold the whitespace that follows an assignment", () => {
    const redactor = new OutputRedactor();
    redactor.append("password=");
    for (let index = 0; index < 1_000; index += 1) {
      redactor.append("          ");
    }
    redactor.append("synthetic-value\n");

    expect(redactor.heldLength).toBeLessThanOrEqual(64);
    expect(redactor.append("")).toBe("[redacted]");
  });

  it("does not keep the body of an open key block", () => {
    const redactor = new OutputRedactor();
    redactor.append("-----BEGIN RSA PRIVATE KEY-----\n");
    for (let index = 0; index < 1_000; index += 1) {
      redactor.append("A".repeat(70));
    }

    expect(redactor.heldLength).toBeLessThanOrEqual(64);
    expect(redactor.append("")).toBe("[redacted]");
  });

  it("does not grow with a token that never ends", () => {
    // A run that starts with a token prefix is held until it ends. A run
    // that never ends must not grow the process without bound, and the
    // cost of a piece must not grow with the run.
    const redactor = new OutputRedactor();
    const started = Date.now();
    for (let index = 0; index < 2_000; index += 1) {
      redactor.append(`eyJ${"A".repeat(97)}`);
    }

    expect(redactor.heldLength).toBeLessThanOrEqual(64 * 1024);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("never shows the tail of a token that is longer than the preview", () => {
    // The preview is the tail of the output, so masking only the tail of
    // the held text would leave the tail of a long token in it.
    const redactor = new OutputRedactor();
    redactor.append(`ghp_${"A".repeat(1_000)}`);

    const preview = redactor.append("");
    expect(preview).not.toMatch(/A{100}/);
    expect(preview).toContain("[redacted]");
  });

  it("never shows the tail of a token that grows past the limit", () => {
    // A run that grows without an end is given up on: the rest of it is
    // dropped, so that the tail of a token cannot reach the preview.
    const redactor = new OutputRedactor();
    const text = `ghp_${"A".repeat(70_000)}`;
    for (let index = 0; index < text.length; index += 1_000) {
      redactor.append(text.slice(index, index + 1_000));
    }

    const preview = redactor.append("");
    expect(preview).not.toMatch(/A{100}/);
    expect(redactor.heldLength).toBeLessThanOrEqual(64 * 1024);
  });

  it("gives up on an escape sequence that never finishes", () => {
    // An unfinished escape sequence is held, and it cannot be a secret on
    // its own: it is dropped rather than held for ever.
    const redactor = new OutputRedactor();
    redactor.append("\u001b[");
    for (let index = 0; index < 100; index += 1) {
      redactor.append("1".repeat(1_000));
    }

    expect(redactor.heldLength).toBeLessThanOrEqual(64 * 1024);
  });

  it("keeps an ordinary value that is longer than the limit", () => {
    // An ordinary value is not a secret: it is released as it is, so that
    // nothing is lost.
    const redactor = new OutputRedactor();
    const text = `key=${"x".repeat(65_540)}`;
    redactor.append(text);

    expect(redactor.append("")).toBe(wholeTextPreview(text));
  });

  it("never shows a token that is inside an ordinary value", () => {
    // The token needs the text in front of it to be recognised, so the
    // whole of the held text is masked, not only its tail.
    const redactor = new OutputRedactor();
    const text = `key=prefix-${"x".repeat(100)}-ghp_${"A".repeat(1_000)}`;
    redactor.append(text);

    const preview = redactor.append("");
    expect(preview).not.toMatch(/A{100}/);
    expect(preview).toBe(wholeTextPreview(text));
  });

  it("never shows the tail of a token inside an ordinary value that is given up on", () => {
    const redactor = new OutputRedactor();
    const text = `key=ghp_${"A".repeat(70_000)}`;
    for (let index = 0; index < text.length; index += 1_000) {
      redactor.append(text.slice(index, index + 1_000));
    }

    const preview = redactor.append("");
    expect(preview).not.toMatch(/A{100}/);
    expect(preview).toContain("[redacted]");
  });

  it("leaves a token prefix that is too short to be a token alone", () => {
    // "ghp_" is not a token, and hiding it would hide text that is not a
    // secret.
    for (const text of ["ghp_", "ghp_abc"]) {
      const redactor = new OutputRedactor();
      redactor.append(text);

      expect(redactor.append("")).toBe(wholeTextPreview(text));
    }
  });

  it("never shows the rest of a secret value that is given up on", () => {
    // The value is a secret, so the rest of it is dropped: the words of the
    // secret cannot reach the preview.
    for (const text of [`password=${"A".repeat(70_000)}`, `password="${"A".repeat(70_000)}`]) {
      const redactor = new OutputRedactor();
      for (let index = 0; index < text.length; index += 1_000) {
        redactor.append(text.slice(index, index + 1_000));
      }

      expect(redactor.append("")).not.toMatch(/A{100}/);
    }
  });

  it("leaves a run that is too short to be a token alone", () => {
    // The token shapes have their own lengths: "ghp_abcdefghij" is not a
    // GitHub token, and hiding it would hide text that is not a secret.
    for (const text of ["ghp_abcdefghij", "AKIA1234567890", "eyJabcdefghij"]) {
      const redactor = new OutputRedactor();
      redactor.append(text);

      expect(redactor.append("")).toBe(wholeTextPreview(text));
    }
  });

  it("keeps the ordinary text that follows a value that is given up on", () => {
    // An ordinary value is released as it is, so the text after it is not
    // lost.
    const redactor = new OutputRedactor();
    const text = `key=${"x".repeat(65_540)}${"ORDINARYTAIL".repeat(100)}`;
    for (let index = 0; index < text.length; index += 1_000) {
      redactor.append(text.slice(index, index + 1_000));
    }

    expect(redactor.append("")).toContain("ORDINARYTAIL");
  });

  it("finishes a value that was still open when the output ended", () => {
    // A quoted value that was never closed falls back to the bare value,
    // the way the whole-text redaction falls back to it.
    const redactor = new OutputRedactor();
    redactor.append('password="secret with spaces');

    expect(redactor.flush()).toBe(wholeTextPreview('password="secret with spaces'));
  });

  it("starts again when the redaction is turned on or off", () => {
    // A construct that was half-read under one setting must not swallow the
    // output under the other.
    const redactor = new OutputRedactor();
    redactor.append("password=secret");
    redactor.setRedactionEnabled(false);
    redactor.append("\n");
    redactor.setRedactionEnabled(true);
    redactor.append("ordinary output\n");

    expect(redactor.append("")).toContain("ordinary output");
  });
});
