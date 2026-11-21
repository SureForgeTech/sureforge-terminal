# Follow-up review packet, round 4 — the third round of findings

## What you are reviewing

- Repository: `SureForgeTech/sureforge-terminal`
- Read-only checkout: `/workspace/sureforge-terminal` (now at the head below; do not modify it)
- Head you reviewed last: `494fae610a892c81c03560433be1f22b4c3b19b6` (your verdict: BLOCK, 2 P0 / 1 P1 / 3 P2-P3)
- Head under review now: `dcbd8b16ae67f0d2c75f0866306dd47fcf4f4902`
- Base of the whole feature range (unchanged): `4d24bdb0055cfecb1e8d013a2155663768e25700`

One commit was added on top of the head you reviewed: `dcbd8b1 fix(features): the third round of review findings, and a real redactor`. Nothing below it changed.

## How to verify

Work from the checkout at `dcbd8b1`. For each finding you raised, decide whether it is actually fixed, by reading the code and running the tests. Re-derive the answer; do not take the description below as evidence that a fix works.

The complete diff of the new commit is at the end of this packet, and is also in `/tmp/opencode/features-fix3-494fae6..dcbd8b1.diff`.

## The findings, and where each was addressed

**P0.1 — an ANSI escape sequence split between pieces bypassed redaction.** `apps/desktop/src/lib/redact-secrets.ts`: an unfinished escape sequence is carried into the next piece (`incompleteEscapeTail`), and while the carry is held the text in front of it is not released, because a colour code can split a name.

**P0.2 — finalizing a blank line after an assignment exposed a later value.** The assignment at the tail of the held text is now held whole — name, separator and value — until the value arrives (`openAssignment`), and the value is masked and dropped as the rest of it arrives.

**P1.1 — the held text grew without bound and was masked again for every piece.** The redactor is now a state machine with three modes (normal, in-value, in-key). Text is released as soon as nothing in it can change, and released text is masked once. The body of a key block and the rest of an assignment's value are masked and dropped as they arrive, so neither is kept. `OutputRedactor.heldLength` reports what is held.

The state machine also replaced the previous "cut at a safe line boundary" design, so `findSafeCut` and `endsWithAssignment` are gone.

## Validation on the new head

```
$ npm run validate
  Test Files  204 passed (204)
       Tests  1166 passed | 1 skipped (1167)
  ✓ built in ...
  [validate] Docker is unavailable, so semgrep could not run.
exit status: 1
```

Exit 1 is the Docker-gated Semgrep step alone, exactly as on the base commit. `tsc -b` and ESLint are clean.

## What to check

- Whether each finding is genuinely fixed — reproduce the way you reproduced it. The two P0 reproductions are in the test suite now (`sessions-store.redaction.test.ts`), and the P1 benchmark is pinned by a test that writes 4,000 pieces.
- Whether the redaction still holds. The design changed completely, so please try to break it: a secret split across pieces in every possible way, with and without colour codes; a key block of any length, open or closed, split anywhere; an assignment whose value arrives later, on another line, after a blank line; a credential name split across pieces; output with no line breaks; a value that is very long; a token that is still growing; the same output arriving in one piece versus many.
- Whether the preview can ever show a secret that the whole-text redaction (`redactSecrets`) would have caught, or that `redactSecrets` itself now misses.
- Whether the redaction is still bounded: `heldLength` must stay small, the released text must stay at the preview limit, and the time per piece must not grow with the output seen so far.
- Whether the state machine broke anything else: the preview is still set rather than appended, the redaction can be turned off mid-stream, and the store keeps one redactor per history entry.

The bar is unchanged: zero unresolved P0 or P1 findings.

## Complete diff of the new commit

```diff
diff --git a/apps/desktop/src/lib/redact-secrets.test.ts b/apps/desktop/src/lib/redact-secrets.test.ts
index 893b54e..13f6415 100644
--- a/apps/desktop/src/lib/redact-secrets.test.ts
+++ b/apps/desktop/src/lib/redact-secrets.test.ts
@@ -2,6 +2,8 @@ import { describe, expect, it } from "vitest";
 
 import {
   REDACTION_PLACEHOLDER,
+  REDACTED_PREVIEW_LIMIT,
+  OutputRedactor,
   containsSecret,
   isSecretName,
   redactSecrets,
@@ -108,6 +110,30 @@ describe("redacting secrets", () => {
     expect(containsSecret("")).toBe(false);
   });
 
+  it("keeps only what could still change", () => {
+    // What the redactor holds back is an assignment waiting for its value,
+    // a run of name characters, or the body of a key block — never the
+    // output it has already released.
+    const redactor = new OutputRedactor();
+    for (let index = 0; index < 500; index += 1) {
+      redactor.append("some ordinary output line\n");
+    }
+
+    expect(redactor.heldLength).toBeLessThanOrEqual(64);
+    expect(redactor.append("").length).toBeLessThanOrEqual(REDACTED_PREVIEW_LIMIT);
+  });
+
+  it("holds back the body of an open key block without keeping it", () => {
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
   it("splits a name into the words a credential is named after", () => {
     expect(secretNameWords("AWS_SECRET_ACCESS_KEY")).toEqual([
       "aws",
diff --git a/apps/desktop/src/lib/redact-secrets.ts b/apps/desktop/src/lib/redact-secrets.ts
index 29358e8..5712eb0 100644
--- a/apps/desktop/src/lib/redact-secrets.ts
+++ b/apps/desktop/src/lib/redact-secrets.ts
@@ -213,6 +213,16 @@ const ANSI_ESCAPE_SEQUENCE_REGEX = new RegExp(
 );
 const TERMINAL_BELL_REGEX = new RegExp(TERMINAL_BELL_CHARACTER, "g");
 
+// An escape sequence that has not finished arriving.
+//
+// A colour code can split a name — "pass" + ESC + "word" — and a name that
+// is split cannot be recognised, so an unfinished sequence is carried into
+// the next piece of output and the text in front of it is held until the
+// sequence completes.
+const INCOMPLETE_ESCAPE_TAIL_REGEX = new RegExp(
+  `${ANSI_ESCAPE_CHARACTER}(?:\\[[0-9;?]*[ -/]*)?$`
+);
+
 /** How much of the redacted output the preview keeps. */
 export const REDACTED_PREVIEW_LIMIT = 600;
 
@@ -220,85 +230,136 @@ export const REDACTED_PREVIEW_LIMIT = 600;
 const PRIVATE_KEY_BEGIN = "-----BEGIN";
 const PRIVATE_KEY_END = "-----END";
 
+// How much of a key block's body is kept while the block is open: enough to
+// recognise an END marker that arrives in two pieces.
+const PRIVATE_KEY_MARKER_KEEP = 64;
+
+// The longest a credential name can be. A name longer than this is not a
+// credential name, so it is never held back waiting for one.
+const MAX_CREDENTIAL_NAME_LENGTH = 64;
+
 /**
- * Whether a line ends in a way that says a value follows it.
+ * The tail of the text that is an escape sequence that has not finished.
+ */
+function incompleteEscapeTail(text: string): string {
+  const match = INCOMPLETE_ESCAPE_TAIL_REGEX.exec(text);
+  return match ? match[0] : "";
+}
+
+/**
+ * The terminal's own codes, stripped.
  *
- * "password=" at the end of a line means the value is on the next one, so a
- * cut there would hide the value from the name it belongs to.
+ * The escape codes are stripped BEFORE the redaction, so a coloured
+ * "password=" is still a "password=" and a secret that a colour code split
+ * in half is still found.
  */
-function endsWithAssignment(text: string): boolean {
-  return /[:=]\s*$/.test(text);
+export function stripTerminalCodes(text: string): string {
+  return text
+    .replace(ANSI_ESCAPE_SEQUENCE_REGEX, "")
+    .replace(/\r/g, "")
+    .replace(TERMINAL_BELL_REGEX, "");
 }
 
 /**
- * The place the text can be cut so that no construct spans the cut.
+ * The assignment at the tail of the text, if there is one.
  *
- * The cut is a line boundary, because no construct spans a line: a value
- * ends at the whitespace, and a token has no whitespace in it. Two things
- * move it: a line that ends with an assignment separator (the value is on
- * the next line) and a private key block, which spans lines — so the cut
- * goes past a closed block, or is held back in front of an open one.
+ * An assignment is the name, the separator and the value. It is at the tail
+ * when nothing but whitespace and the value follow the separator — the value
+ * ends at the first whitespace or delimiter, so an assignment whose value
+ * has arrived is finished and an assignment whose value has not is still
+ * open.
+ *
+ * The name is what tells the redaction that the value is a secret, so an
+ * open assignment is held whole until its value arrives.
  */
-function findSafeCut(text: string): number {
-  // The key block positions are found once: the walk below must not rescan
-  // the whole text for every candidate.
-  const begin = text.lastIndexOf(PRIVATE_KEY_BEGIN);
-  const end = text.lastIndexOf(PRIVATE_KEY_END);
-  const blockOpen = begin >= 0 && end < begin;
-
-  let cut = text.lastIndexOf("\n") + 1;
-  while (cut > 0) {
-    // The cut must not be the end of an assignment: the value follows it.
-    const lineStart = text.lastIndexOf("\n", cut - 2) + 1;
-    if (!endsWithAssignment(text.slice(lineStart, cut))) {
-      if (begin >= 0 && cut > begin) {
-        if (blockOpen) {
-          // The block is still open: it has to stay whole, so the cut goes
-          // in front of it.
-          cut = text.lastIndexOf("\n", begin - 1) + 1;
-          continue;
-        }
-        // The block is closed: the cut has to be after its END line, or the
-        // block would be split between the two halves.
-        const endOfBlock = text.indexOf("\n", end);
-        if (endOfBlock < 0) {
-          return 0;
-        }
-        if (cut <= endOfBlock) {
-          cut = endOfBlock + 1;
-          continue;
-        }
-      }
-      return cut;
+function openAssignment(text: string): { index: number; value: string } | undefined {
+  // The last separator, walking back over the characters a name or a value
+  // is made of.
+  let separator = -1;
+  for (let index = text.length - 1; index >= 0; index -= 1) {
+    const character = text[index];
+    if (character === "=" || character === ":") {
+      separator = index;
+      break;
     }
-    cut = text.lastIndexOf("\n", cut - 2) + 1;
+    if (!/[\sA-Za-z0-9_.-]/.test(character)) {
+      // A delimiter ends the search: the assignment ended earlier.
+      return undefined;
+    }
+  }
+  if (separator < 0) {
+    return undefined;
+  }
+
+  // The name, before the separator.
+  let nameStart = separator;
+  while (nameStart > 0 && /[A-Za-z0-9_.-]/.test(text[nameStart - 1])) {
+    nameStart -= 1;
+  }
+  if (nameStart === separator || separator - nameStart > MAX_CREDENTIAL_NAME_LENGTH) {
+    return undefined;
   }
-  return 0;
+
+  // What follows the separator must be the value and nothing else.
+  const after = text.slice(separator + 1);
+  if (!/^\s*[^\s,;}]*$/.test(after)) {
+    return undefined;
+  }
+
+  const value = after.trimStart();
+  return { index: nameStart, value };
+}
+
+/**
+ * The start of the run of name characters at the tail of the text.
+ *
+ * A run like "pass" can still become the name of a credential, and a token
+ * like "ghp_abc" can still grow, so the run is held until more text says
+ * what it is. A run longer than a credential name cannot be one, so it is
+ * released.
+ */
+function trailingNameRunStart(text: string): number {
+  let index = text.length;
+  while (index > 0 && /[A-Za-z0-9_.-]/.test(text[index - 1])) {
+    index -= 1;
+  }
+  const run = text.length - index;
+  return run > 0 && run <= MAX_CREDENTIAL_NAME_LENGTH ? index : -1;
 }
 
 /**
  * Keeps the redacted preview of a stream of output.
  *
- * The output arrives in pieces and is unbounded, so it cannot simply be held
- * whole; and a secret may straddle two pieces, so the redaction has to see
- * enough context to recognise it. The stream therefore keeps two parts:
+ * The output arrives in pieces and is unbounded, and a secret may straddle
+ * two pieces — so the redaction has to see enough context to recognise it,
+ * and it must not have to look at the whole output again for every piece.
+ *
+ * The redactor is therefore a small state machine:
  *
- * - the FINALIZED part, already redacted, which cannot change any more
- *   because it was cut where no construct spans it;
- * - the PENDING part, the raw tail a construct may still span, which is
- *   redacted as a whole every time it grows.
+ * - NORMAL: text is released as soon as nothing can still change it. What
+ *   can still change is an assignment whose value has not arrived, and a
+ *   run of name characters that could still become a credential name.
+ * - IN-VALUE: the rest of an assignment's value. It is one secret and it
+ *   ends at the first whitespace or delimiter, so it is masked and dropped
+ *   as it arrives.
+ * - IN-KEY: the body of a private key block. It is masked and dropped as it
+ *   arrives, so a key block of any length costs nothing.
  *
- * The finalized part is trimmed to the size of the preview, and the pending
- * part is bounded by a line (and by an open private key block), so what a
- * long-running command holds in memory stays bounded.
+ * What is released is masked once, and what is held is small, so the cost
+ * of a piece of output does not grow with the output seen so far.
  */
 export class OutputRedactor {
-  private finalized = "";
+  /** The released output, already masked. Only its tail is kept. */
+  private emitted = "";
+  /** The text that is still held back, because something in it may change. */
   private pending = "";
-  private redact: boolean;
+  /** An escape sequence that has not finished arriving. */
+  private escapeCarry = "";
+  private mode: "normal" | "in-value" | "in-key" = "normal";
+  private redactEnabled: boolean;
 
   constructor(redact: boolean = true) {
-    this.redact = redact;
+    this.redactEnabled = redact;
   }
 
   /**
@@ -308,7 +369,18 @@ export class OutputRedactor {
    * so the next piece of output follows the new setting.
    */
   setRedactionEnabled(redact: boolean) {
-    this.redact = redact;
+    this.redactEnabled = redact;
+  }
+
+  /**
+   * How much text the redactor is holding back.
+   *
+   * What is held is what could still change: an assignment waiting for its
+   * value, a run of name characters, the body of a key block. It is small by
+   * construction, and this is how a caller can see that it stays small.
+   */
+  get heldLength(): number {
+    return this.pending.length + this.escapeCarry.length;
   }
 
   /**
@@ -316,36 +388,128 @@ export class OutputRedactor {
    * seen so far.
    */
   append(chunk: string): string {
-    this.pending += stripTerminalCodes(chunk);
-
-    const cut = findSafeCut(this.pending);
-    if (cut > 0) {
-      this.finalized = `${this.finalized}${this.mask(this.pending.slice(0, cut))}`.slice(
-        -REDACTED_PREVIEW_LIMIT
-      );
-      this.pending = this.pending.slice(cut);
+    // The escape codes. An unfinished sequence is carried into the next
+    // piece, and the text in front of it is held: a colour code can split a
+    // name, and a name that is split cannot be recognised.
+    const combined = this.escapeCarry + chunk;
+    const carry = incompleteEscapeTail(combined);
+    this.escapeCarry = carry;
+    const text = stripTerminalCodes(combined.slice(0, combined.length - carry.length));
+
+    if (this.redactEnabled && this.mode === "in-key") {
+      // The body of a key block: masked and dropped, with just enough kept
+      // to recognise an END marker that arrives in two pieces.
+      const together = this.pending + text;
+      const end = together.indexOf(PRIVATE_KEY_END);
+      if (end < 0) {
+        this.pending = together.slice(-PRIVATE_KEY_MARKER_KEEP);
+        return this.preview();
+      }
+      this.mode = "normal";
+      this.pending = "";
+      return this.appendText(together.slice(end + PRIVATE_KEY_END.length));
+    }
+
+    if (this.redactEnabled) {
+      const begin = text.indexOf(PRIVATE_KEY_BEGIN);
+      if (begin >= 0) {
+        this.release(this.pending + text.slice(0, begin));
+        this.release(REDACTION_PLACEHOLDER);
+        this.mode = "in-key";
+        this.pending = text.slice(begin).slice(-PRIVATE_KEY_MARKER_KEEP);
+        return this.preview();
+      }
+    }
+
+    if (this.escapeCarry) {
+      // The text in front of an unfinished escape sequence may be part of a
+      // name, so nothing is released until the sequence completes.
+      this.pending += text;
+      return this.preview();
+    }
+
+    return this.appendText(text);
+  }
+
+  private appendText(text: string): string {
+    if (!this.redactEnabled) {
+      this.pending += text;
+      this.release(this.pending);
+      this.pending = "";
+      return this.preview();
+    }
+
+    if (this.mode === "in-value") {
+      // The rest of an assignment's value: it is one secret, and it ends at
+      // the first whitespace or delimiter.
+      const end = /[\s,;}]/.exec(text);
+      if (!end) {
+        return this.preview();
+      }
+      this.mode = "normal";
+      this.pending = "";
+      this.release(text[end.index]);
+      return this.appendText(text.slice(end.index + 1));
+    }
+
+    this.pending += text;
+
+    // An assignment at the tail: its name, its separator and its value are
+    // masked as one thing, so the whole of it is held until the value has
+    // arrived.
+    const assignment = openAssignment(this.pending);
+    if (assignment) {
+      this.release(this.pending.slice(0, assignment.index));
+      if (assignment.value.length === 0) {
+        // The value has not arrived: the assignment is held whole.
+        this.pending = this.pending.slice(assignment.index);
+        return this.preview();
+      }
+      // The value has arrived: it is masked now, and the rest of it is
+      // masked as it arrives.
+      this.release(this.pending.slice(assignment.index));
+      this.mode = "in-value";
+      this.pending = "";
+      return this.preview();
     }
 
-    return `${this.finalized}${this.mask(this.pending)}`
-      .slice(-REDACTED_PREVIEW_LIMIT)
-      .trim();
+    // A run of name characters at the tail could still be the name of a
+    // credential, or the start of a token.
+    const run = trailingNameRunStart(this.pending);
+    if (run >= 0) {
+      this.release(this.pending.slice(0, run));
+      this.pending = this.pending.slice(run);
+      return this.preview();
+    }
+
+    this.release(this.pending);
+    this.pending = "";
+    return this.preview();
+  }
+
+  /**
+   * Mask a piece of text and keep it.
+   *
+   * Only the tail of the released output is kept, because the preview is
+   * the tail of the output.
+   */
+  private release(text: string): void {
+    if (!text) {
+      return;
+    }
+    this.emitted = `${this.emitted}${this.mask(text)}`.slice(-REDACTED_PREVIEW_LIMIT);
   }
 
   private mask(text: string): string {
-    return this.redact ? redactSecrets(text) : text;
+    return this.redactEnabled ? redactSecrets(text) : text;
   }
-}
 
-/**
- * The terminal's own codes, stripped.
- *
- * The escape codes are stripped BEFORE the redaction, so a coloured
- * "password=" is still a "password=" and a secret that a colour code split
- * in half is still found.
- */
-export function stripTerminalCodes(text: string): string {
-  return text
-    .replace(ANSI_ESCAPE_SEQUENCE_REGEX, "")
-    .replace(/\r/g, "")
-    .replace(TERMINAL_BELL_REGEX, "");
+  private preview(): string {
+    // While a key block is open, the held text is its body: it is a secret,
+    // so it is not shown at all. While an assignment's value is arriving,
+    // the held text is the rest of the value, and it is masked already.
+    const held =
+      this.mode === "in-value" || this.mode === "in-key" ? "" : this.mask(this.pending);
+    return `${this.emitted}${held}`.slice(-REDACTED_PREVIEW_LIMIT).trim();
+  }
 }
diff --git a/apps/desktop/src/store/sessions-store.redaction.test.ts b/apps/desktop/src/store/sessions-store.redaction.test.ts
index 3867189..cae6a0a 100644
--- a/apps/desktop/src/store/sessions-store.redaction.test.ts
+++ b/apps/desktop/src/store/sessions-store.redaction.test.ts
@@ -121,6 +121,40 @@ describe("the session history and secrets", () => {
     expect(entry.outputPreview).toContain("[redacted]");
   });
 
+  it("keeps a secret out of the preview when a colour code splits its name", () => {
+    // The escape sequence arrives in two pieces, so the name is split too:
+    // "pass" + colour + "word". A name that is split cannot be recognised,
+    // so the unfinished sequence is carried into the next piece.
+    const entry = recordOutputInChunks(["pass\u001b[", "32mword=synthetic-value"]);
+
+    expect(entry.outputPreview).not.toContain("synthetic-value");
+    expect(entry.outputPreview).toContain("[redacted]");
+  });
+
+  it("keeps a secret out of the preview when the value is on the next line", () => {
+    // The value follows the name across a blank line. The name is what
+    // makes the value a secret, so the two are held together until the
+    // value arrives.
+    const entry = recordOutputInChunks(["password=\n\n", "synthetic-value\n"]);
+
+    expect(entry.outputPreview).not.toContain("synthetic-value");
+    expect(entry.outputPreview).toContain("[redacted]");
+  });
+
+  it("keeps up with a long stream of small writes", () => {
+    // The cost of a piece of output must not grow with the output seen so
+    // far: a command that writes a little, very often, must not freeze the
+    // app.
+    const started = Date.now();
+    const entry = recordOutputInChunks(
+      Array.from({ length: 4_000 }, (_unused, index) => `line ${index} of output\n`)
+    );
+    const elapsed = Date.now() - started;
+
+    expect(entry.outputPreview).toContain("line 3999 of output");
+    expect(elapsed).toBeLessThan(5_000);
+  });
+
   it("keeps ordinary output readable", () => {
     const entry = recordOutput("total 24\nrelease.tar.gz  1024");
 
```
