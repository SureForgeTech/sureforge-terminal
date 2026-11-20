# Follow-up review packet, round 13 — the twelfth round's finding

## What you are reviewing

- Repository: `SureForgeTech/sureforge-terminal`
- Read-only checkout: `/workspace/sureforge-terminal` (now at the head below; do not modify it)
- Head you reviewed last: `5986bcf712fa6f6fcd27ab043d39b35947aaf71e` (your verdict: BLOCK, 0 P0 / 1 P1 / 3 P2-P3)
- Head under review now: `80624173303c7c69e7a0741aece7234ebd192e6c`
- Base of the whole feature range (unchanged): `4d24bdb0055cfecb1e8d013a2155663768e25700`

One commit was added on top of the head you reviewed: `8062417 fix(features): the twelfth round of review finding, and the order of the text`. Nothing below `5986bcf` changed. The commit is small (two files, 22 insertions, 7 deletions) and touches only the redaction.

## The finding, and where it was addressed

**P1 — flushing an ordinary quoted value reordered its text.** The text after the value is now held with the run of name characters that is held back, so the order of the output does not change, and what arrives after the flush is still part of the value.

The preview also masks an ordinary value with the whole redaction (it can hold a credential) and a run of name characters with the token shapes alone (it cannot), which keeps the cost of a piece of output small.

## New test

`key="hello world` → the output is finished → the preview is the whole-text result.

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
- Whether the split in the preview's masking (the whole redaction for an ordinary value, the token shapes for a run) leaves a way for a credential to reach the preview.
- Whether anything else broke, and whether the cost of a piece of output still does not grow with the output seen so far.

The bar is unchanged: zero unresolved P0 or P1 findings.

## Complete diff of the new commit

```diff
diff --git a/apps/desktop/src/lib/redact-secrets.streaming.test.ts b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
index 1264012..fbd62db 100644
--- a/apps/desktop/src/lib/redact-secrets.streaming.test.ts
+++ b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
@@ -327,6 +327,17 @@ describe("redacting a stream of output", () => {
     expect(redactor.append("")).toBe("key=[redacted]");
   });
 
+  it("keeps the order of the text when the output is finished", () => {
+    // Finishing the output holds back the run of name characters at the end
+    // of a value, so that a token that continues after it is recognised.
+    // The text after the value is held with it, so that the order of the
+    // output does not change.
+    const redactor = new OutputRedactor();
+    redactor.append('key="hello world');
+
+    expect(redactor.flush()).toBe(wholeTextPreview('key="hello world'));
+  });
+
   it("leaves a run that is too short to be a token alone", () => {
     // The token shapes have their own lengths: "ghp_abcdefghij" is not a
     // GitHub token, and hiding it would hide text that is not a secret.
diff --git a/apps/desktop/src/lib/redact-secrets.ts b/apps/desktop/src/lib/redact-secrets.ts
index 210adc5..09a8164 100644
--- a/apps/desktop/src/lib/redact-secrets.ts
+++ b/apps/desktop/src/lib/redact-secrets.ts
@@ -580,11 +580,11 @@ export class OutputRedactor {
         // An ordinary value is released as it is — but the run of name
         // characters at its end is held back: it may be the start of a token
         // whose rest arrives after this, and without the beginning of it the
-        // rest could not be recognised.
+        // rest could not be recognised. The text after the value is held
+        // with it, so that the order of the output is not changed.
         const runStart = trailingRunStart(value);
         this.releaseTokens(value.slice(0, runStart));
-        this.release(this.redactEnabled ? redactSecrets(after) : after);
-        this.pending = value.slice(runStart);
+        this.pending = value.slice(runStart) + after;
       }
       // The value stays OPEN: output that arrives after this is still part
       // of it, and it is still masked.
@@ -1094,10 +1094,14 @@ export class OutputRedactor {
             // the preview.
             isWholeTokenRun(this.pending)
             ? REDACTION_PLACEHOLDER
-            : // The whole of the held text is masked, not only its tail: a
-              // token inside it needs the text in front of it to be
-              // recognised.
-            maskTokens(this.pending)
+            : this.mode === "plain-value" || this.mode === "plain-quoted-value"
+              ? // An ordinary value can hold a credential, so the whole of
+                // it is masked, not only its tail.
+                this.redactEnabled ? redactSecrets(this.pending) : this.pending
+              : // A run of name characters cannot hold a credential, and a
+                // token inside it needs the text in front of it — so the
+                // token shapes are enough, and the cost stays small.
+                this.redactEnabled ? maskTokens(this.pending) : this.pending
           : this.pending;
     return `${this.emitted}${held}`.slice(-REDACTED_PREVIEW_LIMIT).trim();
   }
```
