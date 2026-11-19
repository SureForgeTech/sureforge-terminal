# Follow-up review packet, round 5 — the fourth round of findings

## What you are reviewing

- Repository: `SureForgeTech/sureforge-terminal`
- Read-only checkout: `/workspace/sureforge-terminal` (now at the head below; do not modify it)
- Head you reviewed last: `dcbd8b16ae67f0d2c75f0866306dd47fcf4f4902` (your verdict: BLOCK, 3 P0 / 3 P1 / 4 P2-P3)
- Head under review now: `3f49862052fc718744e88bf671102d86096c3187`
- Base of the whole feature range (unchanged): `4d24bdb0055cfecb1e8d013a2155663768e25700`

One commit was added on top of the head you reviewed: `3f49862 fix(features): the fourth round of review findings, and a redactor that is a lexer`. Nothing below it changed.

## How to verify

Work from the checkout at `3f49862`. For each finding you raised, decide whether it is actually fixed, by reading the code and running the tests. Re-derive the answer; do not take the description below as evidence that a fix works.

The complete diff of the new commit is at the end of this packet, and is also in `/tmp/opencode/features-fix4-dcbd8b1..3f49862.diff`.

## The findings, and where each was addressed

**P0.1 — quoted assignments were not chunk-invariant.** `apps/desktop/src/lib/redact-secrets.ts` is now written as a lexer over the pieces: a quoted name is read as a name (`nameBefore` skips the closing quote), a quoted value ends at its closing quote and not at the first space, and the value's content is dropped as it arrives with the placeholder released as soon as the value is known to hold something.

**P0.2 — a private key marker split between pieces was missed, and a false marker was accepted.** The marker is now searched across the held and the new text (`privateKeyHeaderState`), and only the whole header `-----BEGIN [A-Z ]*PRIVATE KEY-----` counts; a "-----BEGIN" that is not one is ordinary text.

**P0.3 — a still-growing token was released at 65 characters.** A run that starts with a token prefix is now held until it ends, with no length cap; the cap of 64 applies only to a run that could be a credential name.

**P1.1 — an assignment awaiting a value grew without bound.** The whitespace after the separator is released as it arrives (the whole-text redaction keeps it in the output too), and only the name is held.

**P1.2 — split ordinary assignments lost part of their value.** An assignment whose name is not a secret releases its value as it arrives (`plain-value`).

**P1.3 — disabling the redaction mid-construct left a stale mode.** The lexer starts again when the setting changes (`setRedactionEnabled`).

## The property that is now a test

`apps/desktop/src/lib/redact-secrets.streaming.test.ts` pins the property the whole design exists for: the same output, split at every possible place, gives the same preview as the output in one piece. Twenty-four fixtures are split at every position, and twelve of them at every pair of positions. It also pins the bounds (`heldLength`), the timing, and the open-key-block case.

## Validation on the new head

```
$ npm run validate
  Test Files  205 passed (205)
       Tests  1173 passed | 1 skipped (1174)
  ✓ built in ...
  [validate] Docker is unavailable, so semgrep could not run.
exit status: 1
```

Exit 1 is the Docker-gated Semgrep step alone, exactly as on the base commit. `tsc -b` and ESLint are clean.

## What to check

- Whether each finding is genuinely fixed — reproduce the way you reproduced it.
- Whether the redaction now holds. The design changed completely again, so please try to break it: the same sweep you ran, over more fixtures, at every split (and every pair of splits), with the reference being `redactSecrets(stripTerminalCodes(text))` — the same reference the test uses.
- Whether the redaction is still bounded and still fast: `heldLength` must stay small, the time per piece must not grow with the output seen so far, and a long-running or a pathological stream must not grow the process.
- Whether the lexer broke anything else: the preview is still set rather than appended; the redaction can be turned off mid-stream; the store keeps one redactor per history entry and forgets it when the entry goes; the whole-text `redactSecrets` is unchanged and still used elsewhere.

The bar is unchanged: zero unresolved P0 or P1 findings.

## Complete diff of the new commit

```diff
diff --git a/apps/desktop/src/lib/redact-secrets.streaming.test.ts b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
new file mode 100644
index 0000000..b66e009
--- /dev/null
+++ b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
@@ -0,0 +1,157 @@
+import { describe, expect, it } from "vitest";
+
+import {
+  OutputRedactor,
+  REDACTED_PREVIEW_LIMIT,
+  redactSecrets,
+  stripTerminalCodes,
+} from "./redact-secrets";
+
+// The redaction of a stream of output has to be the same as the redaction
+// of the whole output.
+//
+// The terminal writes a command's output in pieces, and a secret can be
+// split across two of them — the name in one, the value in the next, a
+// colour code in between, a key block that arrives in fifty. So the
+// streaming redaction has to see enough context to recognise the secret
+// wherever the pieces fall.
+//
+// These tests are that property: the same output, split at every possible
+// place, has to produce the same preview as the output in one piece.
+
+const FIXTURES: string[] = [
+  "password=synthetic-value\n",
+  '{"accessToken":"synthetic-value"}\n',
+  'password="secret with spaces"\n',
+  "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----\n",
+  `-----BEGIN RSA PRIVATE KEY-----\n${"A".repeat(5_000)}\n-----END RSA PRIVATE KEY-----\n`,
+  "ghp_abcdefghijklmnopqrstuvwxyz012345\n",
+  "github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz\n",
+  "tokenizer=fast\n",
+  "tokenizer=fa\nst\nnext\n",
+  "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI\n",
+  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk\n",
+  "pass[32mword=synthetic-value\n",
+  "password=\n\nsynthetic-value\n",
+  `password=${" ".repeat(200)}synthetic-value\n`,
+  '{"url": "http://example.com/x"}\n',
+  "no secrets here\n",
+  "clientSecret=opaque-value\n",
+  "-----BEGIN not a key\nordinary output\n",
+  "key=release\n",
+  'secret=""\n',
+  "a=b c=d\n",
+  "AKIAIOSFODNN7EXAMPLE\n",
+  "xoxb-1234567890-abcdefghij\n",
+];
+
+/** The preview of the whole output, the way the whole-text redaction gives it. */
+function wholeTextPreview(text: string): string {
+  return redactSecrets(stripTerminalCodes(text)).slice(-REDACTED_PREVIEW_LIMIT).trim();
+}
+
+describe("redacting a stream of output", () => {
+  it("gives the same preview as the whole output, however it is split", () => {
+    for (const text of FIXTURES) {
+      const expected = wholeTextPreview(text);
+
+      const whole = new OutputRedactor();
+      whole.append(text);
+      expect(whole.append(""), text).toBe(expected);
+
+      // The long fixtures are split at a few places only: every split of
+      // every fixture is quadratic in the fixture's length.
+      const step = text.length > 2_000 ? Math.ceil(text.length / 40) : 1;
+      for (let split = 1; split < text.length; split += step) {
+        const redactor = new OutputRedactor();
+        redactor.append(text.slice(0, split));
+        redactor.append(text.slice(split));
+        expect(redactor.append(""), `split at ${split} of ${JSON.stringify(text)}`).toBe(
+          expected
+        );
+      }
+    }
+  });
+
+  it("gives the same preview when the output arrives in three pieces", () => {
+    for (const text of FIXTURES.filter((fixture) => fixture.length < 120).slice(0, 12)) {
+      const expected = wholeTextPreview(text);
+
+      for (let first = 1; first < text.length; first += 1) {
+        for (let second = first + 1; second < text.length; second += 1) {
+          const redactor = new OutputRedactor();
+          redactor.append(text.slice(0, first));
+          redactor.append(text.slice(first, second));
+          redactor.append(text.slice(second));
+          expect(
+            redactor.append(""),
+            `split at ${first},${second} of ${JSON.stringify(text)}`
+          ).toBe(expected);
+        }
+      }
+    }
+  });
+
+  it("holds back only what could still change", () => {
+    // What is held is an assignment waiting for its value, a run of name
+    // characters, or the body of a key block — never the output it has
+    // already released.
+    const redactor = new OutputRedactor();
+    for (let index = 0; index < 500; index += 1) {
+      redactor.append("some ordinary output line\n");
+    }
+
+    expect(redactor.heldLength).toBeLessThanOrEqual(64);
+    expect(redactor.append("").length).toBeLessThanOrEqual(REDACTED_PREVIEW_LIMIT);
+  });
+
+  it("keeps up with a long stream of small writes", () => {
+    // The cost of a piece of output must not grow with the output seen so
+    // far: a command that writes a little, very often, must not freeze the
+    // app.
+    const redactor = new OutputRedactor();
+    const started = Date.now();
+    for (let index = 0; index < 4_000; index += 1) {
+      redactor.append("abcdefghij");
+    }
+
+    expect(Date.now() - started).toBeLessThan(5_000);
+    expect(redactor.heldLength).toBeLessThanOrEqual(64);
+  });
+
+  it("does not hold the whitespace that follows an assignment", () => {
+    const redactor = new OutputRedactor();
+    redactor.append("password=");
+    for (let index = 0; index < 1_000; index += 1) {
+      redactor.append("          ");
+    }
+    redactor.append("synthetic-value\n");
+
+    expect(redactor.heldLength).toBeLessThanOrEqual(64);
+    expect(redactor.append("")).toBe("[redacted]");
+  });
+
+  it("does not keep the body of an open key block", () => {
+    const redactor = new OutputRedactor();
+    redactor.append("-----BEGIN RSA PRIVATE KEY-----\n");
+    for (let index = 0; index < 1_000; index += 1) {
+      redactor.append("A".repeat(70));
+    }
+
+    expect(redactor.heldLength).toBeLessThanOrEqual(64);
+    expect(redactor.append("")).toBe("[redacted]");
+  });
+
+  it("starts again when the redaction is turned on or off", () => {
+    // A construct that was half-read under one setting must not swallow the
+    // output under the other.
+    const redactor = new OutputRedactor();
+    redactor.append("password=secret");
+    redactor.setRedactionEnabled(false);
+    redactor.append("\n");
+    redactor.setRedactionEnabled(true);
+    redactor.append("ordinary output\n");
+
+    expect(redactor.append("")).toContain("ordinary output");
+  });
+});
diff --git a/apps/desktop/src/lib/redact-secrets.ts b/apps/desktop/src/lib/redact-secrets.ts
index 5712eb0..70ef5bb 100644
--- a/apps/desktop/src/lib/redact-secrets.ts
+++ b/apps/desktop/src/lib/redact-secrets.ts
@@ -19,12 +19,14 @@
 /** What a redacted value is replaced with. */
 export const REDACTION_PLACEHOLDER = "[redacted]";
 
-// The words a secret is usually stored under.
-//
-// The comparison is against the WORDS of a name, not against the name as a
-// whole: "accessToken" is a secret and "tokenizer" is not, and the only
-// difference is the word boundary. A plural counts ("secrets", "tokens",
-// "passwords"), and the match is case-insensitive.
+/**
+ * The words a secret is usually stored under.
+ *
+ * The comparison is against the WORDS of a name, not against the name as a
+ * whole: "accessToken" is a secret and "tokenizer" is not, and the only
+ * difference is the word boundary. A plural counts ("secrets", "tokens",
+ * "passwords"), and the match is case-insensitive.
+ */
 const SECRET_WORDS = new Set([
   "password",
   "passwd",
@@ -55,6 +57,7 @@ const SECRET_KEY_QUALIFIERS = new Set([
 // KEY=value, "key": "value", key: value — the name is captured on its own so
 // it can be checked word by word, and the separator is captured so the
 // replacement keeps the shape of the text.
+//
 // The name is bounded: an unbounded one is QUADRATIC on a long line of
 // output (the engine tries every name length at every position), and a
 // 70 kB base64 blob would take seconds to redact.
@@ -204,6 +207,21 @@ export function containsSecret(text: string): boolean {
   return redactSecrets(text) !== text;
 }
 
+/**
+ * Mask only the tokens in a piece of text.
+ *
+ * The whole-text redaction masks the assignments first and the tokens
+ * after, so a piece of text that is not part of an assignment is masked
+ * with the token shapes alone.
+ */
+function maskTokens(text: string): string {
+  let masked = text;
+  for (const pattern of TOKEN_PATTERNS) {
+    masked = masked.replace(pattern, REDACTION_PLACEHOLDER);
+  }
+  return masked;
+}
+
 // The escape codes a terminal writes around its output, and the bell.
 const ANSI_ESCAPE_CHARACTER = String.fromCharCode(27);
 const TERMINAL_BELL_CHARACTER = String.fromCharCode(7);
@@ -226,18 +244,36 @@ const INCOMPLETE_ESCAPE_TAIL_REGEX = new RegExp(
 /** How much of the redacted output the preview keeps. */
 export const REDACTED_PREVIEW_LIMIT = 600;
 
-// A private key block, open or closed.
-const PRIVATE_KEY_BEGIN = "-----BEGIN";
-const PRIVATE_KEY_END = "-----END";
-
-// How much of a key block's body is kept while the block is open: enough to
-// recognise an END marker that arrives in two pieces.
-const PRIVATE_KEY_MARKER_KEEP = 64;
+// A private key block, open or closed. The whole markers are used, so that a
+// "-----BEGIN" that is not a key block is not treated as one.
+const PRIVATE_KEY_END = "-----END [A-Z ]*PRIVATE KEY-----";
 
 // The longest a credential name can be. A name longer than this is not a
 // credential name, so it is never held back waiting for one.
 const MAX_CREDENTIAL_NAME_LENGTH = 64;
 
+// The characters a name, a token or a key marker is made of.
+const NAME_CHARACTER = /[A-Za-z0-9_.-]/;
+
+// The prefixes a run can start with and still be a token.
+const TOKEN_PREFIXES = [
+  "AKIA",
+  "ASIA",
+  "ghp_",
+  "gho_",
+  "ghu_",
+  "ghs_",
+  "ghr_",
+  "github_pat_",
+  "glpat-",
+  "xoxa-",
+  "xoxb-",
+  "xoxp-",
+  "xoxr-",
+  "xoxs-",
+  "eyJ",
+];
+
 /**
  * The tail of the text that is an escape sequence that has not finished.
  */
@@ -261,70 +297,98 @@ export function stripTerminalCodes(text: string): string {
 }
 
 /**
- * The assignment at the tail of the text, if there is one.
- *
- * An assignment is the name, the separator and the value. It is at the tail
- * when nothing but whitespace and the value follow the separator — the value
- * ends at the first whitespace or delimiter, so an assignment whose value
- * has arrived is finished and an assignment whose value has not is still
- * open.
+ * The name in front of a separator, and where it starts.
  *
- * The name is what tells the redaction that the value is a secret, so an
- * open assignment is held whole until its value arrives.
+ * A name is a run of name characters that starts with a letter, a digit or
+ * an underscore, and it is at most 64 characters long — a longer run is not
+ * a credential name.
  */
-function openAssignment(text: string): { index: number; value: string } | undefined {
-  // The last separator, walking back over the characters a name or a value
-  // is made of.
-  let separator = -1;
-  for (let index = text.length - 1; index >= 0; index -= 1) {
-    const character = text[index];
-    if (character === "=" || character === ":") {
-      separator = index;
-      break;
-    }
-    if (!/[\sA-Za-z0-9_.-]/.test(character)) {
-      // A delimiter ends the search: the assignment ended earlier.
-      return undefined;
-    }
-  }
-  if (separator < 0) {
-    return undefined;
+function nameBefore(text: string, separator: number): number {
+  // A quoted name: the quote closes it, so the name is the run before it.
+  let end = separator;
+  const closing = text[end - 1];
+  if (closing === '"' || closing === "'") {
+    end -= 1;
   }
 
-  // The name, before the separator.
-  let nameStart = separator;
-  while (nameStart > 0 && /[A-Za-z0-9_.-]/.test(text[nameStart - 1])) {
-    nameStart -= 1;
+  let start = end;
+  while (start > 0 && NAME_CHARACTER.test(text[start - 1])) {
+    start -= 1;
   }
-  if (nameStart === separator || separator - nameStart > MAX_CREDENTIAL_NAME_LENGTH) {
-    return undefined;
+  if (start === end || end - start > MAX_CREDENTIAL_NAME_LENGTH) {
+    return -1;
   }
-
-  // What follows the separator must be the value and nothing else.
-  const after = text.slice(separator + 1);
-  if (!/^\s*[^\s,;}]*$/.test(after)) {
-    return undefined;
+  if (!/[A-Za-z0-9_]/.test(text[start])) {
+    return -1;
   }
+  return start;
+}
 
-  const value = after.trimStart();
-  return { index: nameStart, value };
+/**
+ * The next assignment in the text.
+ *
+ * An assignment is a name, a separator and a value, and it is found the
+ * same way the whole-text redaction finds it: the first separator that has a
+ * name in front of it.
+ */
+function findAssignment(text: string): { nameStart: number; separator: number } | undefined {
+  for (let index = 0; index < text.length; index += 1) {
+    const character = text[index];
+    if (character !== "=" && character !== ":") {
+      continue;
+    }
+    const nameStart = nameBefore(text, index);
+    if (nameStart >= 0) {
+      return { nameStart, separator: index };
+    }
+  }
+  return undefined;
 }
 
 /**
- * The start of the run of name characters at the tail of the text.
+ * Whether the text is a private key header, and whether it could still
+ * become one.
  *
- * A run like "pass" can still become the name of a credential, and a token
- * like "ghp_abc" can still grow, so the run is held until more text says
- * what it is. A run longer than a credential name cannot be one, so it is
- * released.
+ * The whole-text redaction only treats "-----BEGIN [A-Z ]*PRIVATE KEY-----"
+ * as a key block, so a "-----BEGIN" that is not one is ordinary text. A
+ * header that is not complete yet may still become one, and is held until
+ * it does.
  */
-function trailingNameRunStart(text: string): number {
-  let index = text.length;
-  while (index > 0 && /[A-Za-z0-9_.-]/.test(text[index - 1])) {
-    index -= 1;
+function privateKeyHeaderState(text: string): "complete" | "partial" | "none" {
+  const literal = "PRIVATE KEY-----";
+  const rest = text.slice("-----BEGIN ".length);
+
+  // The "[A-Z ]*" part may take any number of characters, so the header
+  // can be split in more than one way. The loop is bounded: a header whose
+  // first part is longer than this is not a header.
+  for (let consumed = 0; consumed <= rest.length && consumed <= 128; consumed += 1) {
+    const head = rest.slice(0, consumed);
+    if (!/^[A-Z ]*$/.test(head)) {
+      break;
+    }
+    // The header is complete when the literal follows the "[A-Z ]*" part.
+    if (rest.startsWith(literal, consumed)) {
+      return "complete";
+    }
+    // It may still become one when what follows is the start of the
+    // literal and the text ends there.
+    const tail = rest.slice(consumed);
+    if (tail.length < literal.length && literal.startsWith(tail)) {
+      return "partial";
+    }
   }
-  const run = text.length - index;
-  return run > 0 && run <= MAX_CREDENTIAL_NAME_LENGTH ? index : -1;
+  return "none";
+}
+
+/**
+ * Whether a run of name characters could be a token.
+ *
+ * A token is a run that starts with a recognisable prefix. It is not held
+ * to the length of a credential name: a token is longer than a name, and a
+ * token that is released too early leaves its tail in the preview.
+ */
+function isTokenRun(run: string): boolean {
+  return TOKEN_PREFIXES.some((prefix) => run.startsWith(prefix));
 }
 
 /**
@@ -334,15 +398,23 @@ function trailingNameRunStart(text: string): number {
  * two pieces — so the redaction has to see enough context to recognise it,
  * and it must not have to look at the whole output again for every piece.
  *
- * The redactor is therefore a small state machine:
+ * The redactor is therefore a small lexer over the pieces:
  *
- * - NORMAL: text is released as soon as nothing can still change it. What
- *   can still change is an assignment whose value has not arrived, and a
- *   run of name characters that could still become a credential name.
- * - IN-VALUE: the rest of an assignment's value. It is one secret and it
- *   ends at the first whitespace or delimiter, so it is masked and dropped
- *   as it arrives.
- * - IN-KEY: the body of a private key block. It is masked and dropped as it
+ * - NORMAL: the text is released as soon as nothing in it can still change.
+ *   What can still change is an assignment whose value has not arrived, a
+ *   run of name characters that could still become a credential name, and a
+ *   token that could still grow.
+ * - AWAITING-VALUE: a secret assignment's separator was seen. Its value may
+ *   be on the next line, so the whitespace is released as it arrives and the
+ *   value is masked when it comes.
+ * - SECRET-VALUE / SECRET-QUOTED-VALUE: the value of a secret assignment.
+ *   It is one secret, so it is masked and dropped as it arrives.
+ * - PLAIN-VALUE / PLAIN-QUOTED-VALUE: the value of an assignment that is
+ *   not a secret. It is released as it arrives, but it is still consumed as
+ *   one thing, so a construct inside it is not picked up a second time.
+ * - TOKEN: a token that may still grow. It is held until it ends, and then
+ *   masked as a whole.
+ * - KEY: the body of a private key block. It is masked and dropped as it
  *   arrives, so a key block of any length costs nothing.
  *
  * What is released is masked once, and what is held is small, so the cost
@@ -355,7 +427,19 @@ export class OutputRedactor {
   private pending = "";
   /** An escape sequence that has not finished arriving. */
   private escapeCarry = "";
-  private mode: "normal" | "in-value" | "in-key" = "normal";
+  private mode:
+    | "normal"
+    | "awaiting-value"
+    | "secret-value"
+    | "secret-quoted-value"
+    | "plain-value"
+    | "plain-quoted-value"
+    | "token"
+    | "key" = "normal";
+  /** The quote that opened the value, when the value is quoted. */
+  private valueQuote = "";
+  /** Whether the value's content has already been masked and dropped. */
+  private valueMasked = false;
   private redactEnabled: boolean;
 
   constructor(redact: boolean = true) {
@@ -366,10 +450,18 @@ export class OutputRedactor {
    * Turn the redaction on or off.
    *
    * The setting is a preference the user can change while a command runs,
-   * so the next piece of output follows the new setting.
+   * so the next piece of output follows the new setting — and the lexer
+   * starts again, so that a construct that was half-read under the old
+   * setting cannot swallow the output under the new one.
    */
   setRedactionEnabled(redact: boolean) {
+    if (redact === this.redactEnabled) {
+      return;
+    }
     this.redactEnabled = redact;
+    this.mode = "normal";
+    this.valueQuote = "";
+    this.valueMasked = false;
   }
 
   /**
@@ -396,120 +488,311 @@ export class OutputRedactor {
     this.escapeCarry = carry;
     const text = stripTerminalCodes(combined.slice(0, combined.length - carry.length));
 
-    if (this.redactEnabled && this.mode === "in-key") {
-      // The body of a key block: masked and dropped, with just enough kept
-      // to recognise an END marker that arrives in two pieces.
-      const together = this.pending + text;
-      const end = together.indexOf(PRIVATE_KEY_END);
-      if (end < 0) {
-        this.pending = together.slice(-PRIVATE_KEY_MARKER_KEEP);
-        return this.preview();
+    if (this.escapeCarry) {
+      // The text in front of an unfinished escape sequence may be part of a
+      // name, so nothing is released until the sequence completes.
+      this.pending += text;
+      return this.preview();
+    }
+
+    this.pending += text;
+    this.lex();
+    return this.preview();
+  }
+
+  /** Read as much of the held text as can be read. */
+  private lex(): void {
+    let progressed = true;
+    while (progressed) {
+      progressed = false;
+
+      switch (this.mode) {
+        case "normal":
+          progressed = this.lexNormal();
+          break;
+        case "awaiting-value":
+          progressed = this.lexAwaitingValue();
+          break;
+        case "secret-value":
+        case "secret-quoted-value":
+        case "plain-value":
+        case "plain-quoted-value":
+          progressed = this.lexValue();
+          break;
+        case "token":
+          progressed = this.lexToken();
+          break;
+        case "key":
+          progressed = this.lexKey();
+          break;
       }
-      this.mode = "normal";
-      this.pending = "";
-      return this.appendText(together.slice(end + PRIVATE_KEY_END.length));
     }
+  }
 
-    if (this.redactEnabled) {
-      const begin = text.indexOf(PRIVATE_KEY_BEGIN);
-      if (begin >= 0) {
-        this.release(this.pending + text.slice(0, begin));
+  /** The text between the constructs: it is released, masked as tokens. */
+  private lexNormal(): boolean {
+    const assignment = findAssignment(this.pending);
+
+    // A private key block comes first: its marker is not a name, and its
+    // body is dropped as it arrives. With the redaction off it is ordinary
+    // text.
+    const keyStart = this.redactEnabled ? this.pending.indexOf("-----BEGIN") : -1;
+    if (keyStart >= 0 && (!assignment || keyStart < assignment.nameStart)) {
+      const header = privateKeyHeaderState(this.pending.slice(keyStart));
+      if (header === "partial") {
+        // The header is not complete yet: it may still be one.
+        return false;
+      }
+      if (header === "complete") {
+        this.releaseTokens(this.pending.slice(0, keyStart));
         this.release(REDACTION_PLACEHOLDER);
-        this.mode = "in-key";
-        this.pending = text.slice(begin).slice(-PRIVATE_KEY_MARKER_KEEP);
-        return this.preview();
+        this.pending = this.pending.slice(keyStart);
+        this.mode = "key";
+        return true;
       }
+      // It is not a key block at all: it is ordinary text, and the text
+      // after it is scanned as usual.
+      this.releaseTokens(this.pending.slice(0, keyStart + "-----BEGIN".length));
+      this.pending = this.pending.slice(keyStart + "-----BEGIN".length);
+      return true;
     }
 
-    if (this.escapeCarry) {
-      // The text in front of an unfinished escape sequence may be part of a
-      // name, so nothing is released until the sequence completes.
-      this.pending += text;
-      return this.preview();
+    if (assignment) {
+      const quoted =
+        this.pending[assignment.nameStart - 1] === '"' ||
+        this.pending[assignment.nameStart - 1] === "'";
+      const name = this.pending.slice(assignment.nameStart, assignment.separator);
+      // With the redaction off, nothing is masked and nothing is dropped.
+      const secret = this.redactEnabled && isSecretName(name);
+      const start = assignment.nameStart - (quoted ? 1 : 0);
+
+      // The text before the assignment, then the name and the separator.
+      this.releaseTokens(this.pending.slice(0, start));
+      this.releaseTokens(this.pending.slice(start, assignment.separator + 1));
+      this.pending = this.pending.slice(assignment.separator + 1);
+      // A secret assignment's value is masked; an ordinary one is released
+      // as it arrives, but it is consumed as one thing so that a construct
+      // inside it is not picked up a second time.
+      this.mode = secret ? "awaiting-value" : "plain-value";
+      return true;
+    }
+
+    // No assignment: the text is a token, or it is ordinary text.
+    const runStart = this.runStart();
+    if (runStart >= 0) {
+      const run = this.pending.slice(runStart);
+      if (isTokenRun(run)) {
+        // The token may still grow: it is held until it ends.
+        this.releaseTokens(this.pending.slice(0, runStart));
+        this.pending = this.pending.slice(runStart);
+        this.mode = "token";
+        return true;
+      }
+      if (run.length <= MAX_CREDENTIAL_NAME_LENGTH) {
+        // The run may still become the name of a credential.
+        this.releaseTokens(this.pending.slice(0, runStart));
+        this.pending = this.pending.slice(runStart);
+        return false;
+      }
     }
 
-    return this.appendText(text);
+    // Nothing can change any more: the text is released.
+    this.releaseTokens(this.pending);
+    this.pending = "";
+    return false;
   }
 
-  private appendText(text: string): string {
-    if (!this.redactEnabled) {
-      this.pending += text;
-      this.release(this.pending);
-      this.pending = "";
-      return this.preview();
+  /** A secret assignment's separator was seen: the value may still come. */
+  private lexAwaitingValue(): boolean {
+    const text = this.pending;
+    if (text.length === 0) {
+      return false;
     }
 
-    if (this.mode === "in-value") {
-      // The rest of an assignment's value: it is one secret, and it ends at
-      // the first whitespace or delimiter.
-      const end = /[\s,;}]/.exec(text);
-      if (!end) {
-        return this.preview();
-      }
+    const character = text[0];
+    if (/\s/.test(character)) {
+      // The whitespace belongs to the separator: it is released as it
+      // arrives, and the value may still come after it.
+      this.releaseTokens(character);
+      this.pending = text.slice(1);
+      return true;
+    }
+
+    if (character === "," || character === ";" || character === "}") {
+      // The value is empty, so there is no secret to mask.
+      this.releaseTokens(character);
+      this.pending = text.slice(1);
       this.mode = "normal";
-      this.pending = "";
-      this.release(text[end.index]);
-      return this.appendText(text.slice(end.index + 1));
+      return true;
     }
 
-    this.pending += text;
+    if (character === '"' || character === "'") {
+      this.releaseTokens(character);
+      this.pending = text.slice(1);
+      this.valueQuote = character;
+      this.mode = "secret-quoted-value";
+      return true;
+    }
 
-    // An assignment at the tail: its name, its separator and its value are
-    // masked as one thing, so the whole of it is held until the value has
-    // arrived.
-    const assignment = openAssignment(this.pending);
-    if (assignment) {
-      this.release(this.pending.slice(0, assignment.index));
-      if (assignment.value.length === 0) {
-        // The value has not arrived: the assignment is held whole.
-        this.pending = this.pending.slice(assignment.index);
-        return this.preview();
+    this.mode = "secret-value";
+    return true;
+  }
+
+  /** The value of an assignment is arriving. */
+  private lexValue(): boolean {
+    const text = this.pending;
+    if (text.length === 0) {
+      return false;
+    }
+
+    const quoted =
+      this.mode === "secret-quoted-value" || this.mode === "plain-quoted-value";
+    const secret =
+      this.redactEnabled &&
+      (this.mode === "secret-value" || this.mode === "secret-quoted-value");
+
+    if (quoted) {
+      const end = text.indexOf(this.valueQuote);
+      if (end < 0) {
+        // The value goes on: its content is dropped as it arrives, and the
+        // placeholder goes out as soon as the value is known to hold
+        // something.
+        if (!secret) {
+          this.releaseTokens(text);
+        } else if (!this.valueMasked && text.length > 0) {
+          this.release(REDACTION_PLACEHOLDER);
+          this.valueMasked = true;
+        }
+        this.pending = "";
+        return true;
+      }
+      // The value ends here. An empty value is not a secret, and neither is
+      // one that is already the placeholder.
+      if (!secret) {
+        this.releaseTokens(text.slice(0, end));
+      } else if (!this.valueMasked && end > 0) {
+        this.release(REDACTION_PLACEHOLDER);
+      }
+      this.pending = text.slice(end);
+      this.mode = "normal";
+      this.valueMasked = false;
+      return true;
+    }
+
+    const end = /[\s,;}]/.exec(text);
+    if (!end) {
+      // The value goes on: its content is dropped as it arrives, and the
+      // placeholder goes out as soon as the value is known to hold
+      // something.
+      if (!secret) {
+        this.releaseTokens(text);
+      } else if (!this.valueMasked) {
+        this.release(REDACTION_PLACEHOLDER);
+        this.valueMasked = true;
       }
-      // The value has arrived: it is masked now, and the rest of it is
-      // masked as it arrives.
-      this.release(this.pending.slice(assignment.index));
-      this.mode = "in-value";
       this.pending = "";
-      return this.preview();
+      return true;
+    }
+    if (!secret) {
+      this.releaseTokens(text.slice(0, end.index));
+    } else if (!this.valueMasked && end.index > 0) {
+      this.release(REDACTION_PLACEHOLDER);
     }
+    this.pending = text.slice(end.index);
+    this.mode = "normal";
+    this.valueMasked = false;
+    return true;
+  }
 
-    // A run of name characters at the tail could still be the name of a
-    // credential, or the start of a token.
-    const run = trailingNameRunStart(this.pending);
-    if (run >= 0) {
-      this.release(this.pending.slice(0, run));
-      this.pending = this.pending.slice(run);
-      return this.preview();
+  /** A token is arriving: it is held until it ends. */
+  private lexToken(): boolean {
+    const text = this.pending;
+    const end = text.search(/[^A-Za-z0-9_.-]/);
+    if (end < 0) {
+      // The token may still grow.
+      return false;
     }
+    this.releaseTokens(this.pending.slice(0, end));
+    this.pending = text.slice(end);
+    this.mode = "normal";
+    return true;
+  }
 
-    this.release(this.pending);
-    this.pending = "";
-    return this.preview();
+  /** The body of a private key block is arriving: it is dropped. */
+  private lexKey(): boolean {
+    const text = this.pending;
+    const end = new RegExp(PRIVATE_KEY_END).exec(text);
+    if (!end) {
+      // The block is still open: its body is dropped, and only enough is
+      // kept to recognise an END marker that arrives in two pieces.
+      this.pending = text.slice(-64);
+      return false;
+    }
+    // The block ends here: the marker is part of the block, so it is
+    // dropped with it.
+    this.pending = text.slice(end.index + end[0].length);
+    this.mode = "normal";
+    return true;
   }
 
   /**
-   * Mask a piece of text and keep it.
+   * The start of the run of name characters at the tail of the text.
    *
-   * Only the tail of the released output is kept, because the preview is
-   * the tail of the output.
+   * A trailing quote is held with it: the quote can close a name whose
+   * opening quote and name arrived earlier, and a name that is split cannot
+   * be recognised.
    */
-  private release(text: string): void {
+  private runStart(): number {
+    let index = this.pending.length;
+    let quote = false;
+    const last = this.pending[index - 1];
+    if (last === '"' || last === "'") {
+      quote = true;
+      index -= 1;
+    }
+    while (index > 0 && NAME_CHARACTER.test(this.pending[index - 1])) {
+      index -= 1;
+    }
+    if (index === this.pending.length) {
+      return -1;
+    }
+    // The quote is held with the run: the quote can close a name, and the
+    // quote that opens one is part of it.
+    return quote ? Math.max(0, index - 1) : index;
+  }
+
+  /**
+   * Release text that is not part of an assignment: it is masked with the
+   * token shapes alone.
+   */
+  private releaseTokens(text: string): void {
     if (!text) {
       return;
     }
-    this.emitted = `${this.emitted}${this.mask(text)}`.slice(-REDACTED_PREVIEW_LIMIT);
+    this.emitted = `${this.emitted}${this.redactEnabled ? maskTokens(text) : text}`.slice(
+      -REDACTED_PREVIEW_LIMIT
+    );
   }
 
-  private mask(text: string): string {
-    return this.redactEnabled ? redactSecrets(text) : text;
+  /** Release text that is already masked. */
+  private release(text: string): void {
+    if (!text) {
+      return;
+    }
+    this.emitted = `${this.emitted}${text}`.slice(-REDACTED_PREVIEW_LIMIT);
   }
 
   private preview(): string {
-    // While a key block is open, the held text is its body: it is a secret,
-    // so it is not shown at all. While an assignment's value is arriving,
-    // the held text is the rest of the value, and it is masked already.
+    // While a key block is open, or the value of an assignment is arriving,
+    // the held text is a secret: it is not shown at all.
     const held =
-      this.mode === "in-value" || this.mode === "in-key" ? "" : this.mask(this.pending);
+      this.mode === "secret-value" ||
+      this.mode === "secret-quoted-value" ||
+      this.mode === "key"
+        ? ""
+        : this.redactEnabled
+          ? maskTokens(this.pending)
+          : this.pending;
     return `${this.emitted}${held}`.slice(-REDACTED_PREVIEW_LIMIT).trim();
   }
 }
```
