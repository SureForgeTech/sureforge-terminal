# Follow-up review packet, round 12 — the eleventh round's finding

## What you are reviewing

- Repository: `SureForgeTech/sureforge-terminal`
- Read-only checkout: `/workspace/sureforge-terminal` (now at the head below; do not modify it)
- Head you reviewed last: `e1e3e32eb27f021b938d032a3fa5933222bc3055` (your verdict: BLOCK, 1 P0 / 0 P1 / 4 P2-P3)
- Head under review now: `5986bcf712fa6f6fcd27ab043d39b35947aaf71e`
- Base of the whole feature range (unchanged): `4d24bdb0055cfecb1e8d013a2155663768e25700`

One commit was added on top of the head you reviewed: `5986bcf fix(features): the eleventh round of review finding, and the token that crossed the flush`. Nothing below `e1e3e32` changed.

## How to verify

Work from the checkout at `5986bcf`. For each finding you raised, decide whether it is actually fixed, by reading the code and running the tests. Re-derive the answer; do not take the description below as evidence that a fix works.

The complete diff of the new commit is at the end of this packet, and is also in `/tmp/opencode/features-fix11-e1e3e32..5986bcf.diff`.

## The finding, and where it was addressed

**P0 — flushing a plain value broke a token that continued across the flush.** The run of name characters at the end of an ordinary value is now held back when the output is finished, the way the run that may still become a credential name is held while the value is open. What arrives after the flush is still part of the value, and the token is masked as a whole.

The test that checked a secret in a long piece of output is gone: the tests that split a credential across two pieces cover the same property and do distinguish the behaviour — the reviewer noted that the long test passed under the old implementation, so it proved nothing.

## New test

A token that continues after the output was finished: `key=ghp_abcdefghij`, the output is finished, `klmnopqrstuvwxyz012345` arrives — the preview is `key=[redacted]`.

## Validation on the new head

```
$ npm run validate
  Test Files  206 passed (206)
       Tests  1200 passed | 1 skipped (1201)
  ✓ built in ...
  [validate] Docker is unavailable, so semgrep could not run.
exit status: 1
```

Exit 1 is the Docker-gated Semgrep step alone, exactly as on the base commit. `tsc -b` and ESLint are clean.

## What to check

- Whether the finding is genuinely fixed — reproduce the way you reproduced it.
- Whether the redaction still holds, and whether the preview can leak through some other path.
- Whether the lexer broke anything else, and whether the cost of a piece of output still does not grow with the output seen so far.
- The two non-blocking findings you raised that are still open: the cosmetic difference in the preview after a post-cap quoted newline, and the `(#N)` suffix on the changelog fragments (the number is the pull request's, and it does not exist until the pull request is opened).

The bar is unchanged: zero unresolved P0 or P1 findings.

## Complete diff of the new commit

```diff
diff --git a/apps/desktop/src/lib/redact-secrets.streaming.test.ts b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
index e5460fd..1264012 100644
--- a/apps/desktop/src/lib/redact-secrets.streaming.test.ts
+++ b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
@@ -315,6 +315,18 @@ describe("redacting a stream of output", () => {
     expect(redactor.append("")).not.toContain("with spaces");
   });
 
+  it("keeps masking a token that continues after the output was finished", () => {
+    // The run of name characters at the end of an ordinary value is held
+    // back: it may be the start of a token whose rest arrives after the
+    // output was finished.
+    const redactor = new OutputRedactor();
+    redactor.append("key=ghp_abcdefghij");
+    redactor.flush();
+    redactor.append("klmnopqrstuvwxyz012345\n");
+
+    expect(redactor.append("")).toBe("key=[redacted]");
+  });
+
   it("leaves a run that is too short to be a token alone", () => {
     // The token shapes have their own lengths: "ghp_abcdefghij" is not a
     // GitHub token, and hiding it would hide text that is not a secret.
diff --git a/apps/desktop/src/lib/redact-secrets.ts b/apps/desktop/src/lib/redact-secrets.ts
index a7a263c..210adc5 100644
--- a/apps/desktop/src/lib/redact-secrets.ts
+++ b/apps/desktop/src/lib/redact-secrets.ts
@@ -282,6 +282,17 @@ const TOKEN_PREFIXES: string[] = [
   "eyJ",
 ];
 
+/**
+ * The start of the run of name characters at the end of the text.
+ */
+function trailingRunStart(text: string): number {
+  let index = text.length;
+  while (index > 0 && NAME_CHARACTER.test(text[index - 1])) {
+    index -= 1;
+  }
+  return index;
+}
+
 /**
  * The tail of the text that is an escape sequence that has not finished.
  */
@@ -556,17 +567,25 @@ export class OutputRedactor {
         (this.mode === "secret-value" || this.mode === "secret-quoted-value");
       const bare = /[\s,;}]/.exec(this.pending);
       const value = bare ? this.pending.slice(0, bare.index) : this.pending;
+      // The text after the value is ordinary text, the way the whole-text
+      // redaction reads it — but it is masked the same way, so that a second
+      // credential in it is masked as well.
+      const after = bare ? this.pending.slice(bare.index) : "";
       if (secret) {
+        // A secret value is masked as one thing.
         this.release(maskedValue(value));
+        this.release(this.redactEnabled ? redactSecrets(after) : after);
+        this.pending = "";
       } else {
-        this.releaseTokens(value);
+        // An ordinary value is released as it is — but the run of name
+        // characters at its end is held back: it may be the start of a token
+        // whose rest arrives after this, and without the beginning of it the
+        // rest could not be recognised.
+        const runStart = trailingRunStart(value);
+        this.releaseTokens(value.slice(0, runStart));
+        this.release(this.redactEnabled ? redactSecrets(after) : after);
+        this.pending = value.slice(runStart);
       }
-      // The text after the value is ordinary text, the way the whole-text
-      // redaction reads it — but it is masked the same way, so that a second
-      // credential in it is masked as well.
-      const rest = bare ? this.pending.slice(bare.index) : "";
-      this.release(this.redactEnabled ? redactSecrets(rest) : rest);
-      this.pending = "";
       // The value stays OPEN: output that arrives after this is still part
       // of it, and it is still masked.
     }
diff --git a/apps/desktop/src/store/sessions-store.redaction.test.ts b/apps/desktop/src/store/sessions-store.redaction.test.ts
index f8112f2..f5f6064 100644
--- a/apps/desktop/src/store/sessions-store.redaction.test.ts
+++ b/apps/desktop/src/store/sessions-store.redaction.test.ts
@@ -107,21 +107,6 @@ describe("the session history and secrets", () => {
     expect(entry.outputPreview).toContain("[redacted]");
   });
 
-  it("keeps a secret out of the preview when the output around it is long", () => {
-    // The same boundary, with a credential on a line of its own that the
-    // output around it pushes to the end of the preview: the name and the
-    // value are held together until the value arrives, so the credential is
-    // still masked.
-    const filler = "log line\n".repeat(20_000);
-    const entry = recordOutputInChunks([
-      `${filler}password=`,
-      "synthetic-value\n",
-    ]);
-
-    expect(entry.outputPreview).not.toContain("synthetic-value");
-    expect(entry.outputPreview).toContain("[redacted]");
-  });
-
   it("keeps a secret out of the preview when a colour code splits its name", () => {
     // The escape sequence arrives in two pieces, so the name is split too:
     // "pass" + colour + "word". A name that is split cannot be recognised,
```
