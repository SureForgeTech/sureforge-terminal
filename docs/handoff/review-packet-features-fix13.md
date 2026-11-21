# Follow-up review packet, round 14 — the thirteenth round's finding

## What you are reviewing

- Repository: `SureForgeTech/sureforge-terminal`
- Read-only checkout: `/workspace/sureforge-terminal` (now at the head below; do not modify it)
- Head you reviewed last: `80624173303c7c69e7a0741aece7234ebd192e6c` (your verdict: BLOCK, 0 P0 / 1 P1 / 3 P2-P3)
- Head under review now: `ace231d4078ddd796f78ff75bc6dd49d54d77a06`
- Base of the whole feature range (unchanged): `4d24bdb0055cfecb1e8d013a2155663768e25700`

One commit was added on top of the head you reviewed: `ace231d fix(features): the thirteenth round of review finding, and the cost of every piece`. Nothing below `8062417` changed. The commit touches the redaction and its tests.

## The finding, and where it was addressed

**P1 — the preview ran the whole redaction over the whole held value for every piece.** The held text is now masked with the token shapes alone.

That is what the whole-text redaction applies to a value: a value is the value of an assignment, so the assignment pattern consumes it as one thing and only the token shapes are applied to it afterwards. A token inside it still needs the text in front of it, so all of the held text is masked — but with the token shapes alone.

The cost, measured the way you measured it:

```
"key=" followed by repeated 10-character writes:
  1,000 pieces: 24 ms     (your measurement on the previous head: 1,388 ms)
  2,000 pieces: 37 ms     (5,472 ms)
  4,000 pieces: 135 ms    (21,751 ms)
The same 40,000 characters in one piece: 24 ms
```

This is the same shape as the case you accepted in the earlier rounds — a run of name characters that grows without an end (135–175 ms for the same 40,000 characters).

## New test

Four thousand small writes into a value: the cost must stay small.

## Validation on the new head

```
$ npm run validate
  Test Files  206 passed (206)
       Tests  1202 passed | 1 skipped (1203)
  ✓ built in ...
  [validate] Docker is unavailable, so semgrep could not run.
exit status: 1
```

Exit 1 is the Docker-gated Semgrep step alone, exactly as on the base commit. `tsc -b` and ESLint are clean.

## What to check

- Whether the finding is genuinely fixed — reproduce the way you reproduced it.
- Whether a credential can reach the preview now that the plain-value path uses the token shapes alone. Note that the whole-text redaction reads a value as one thing too, so a credential inside an ordinary value is not masked by it either — but please check what the whole-text redaction does with the same text, and whether the two agree.
- Whether anything else broke, and whether the cost of a piece of output still does not grow with the output seen so far.

The bar is unchanged: zero unresolved P0 or P1 findings.

## Complete diff of the new commit

```diff
diff --git a/apps/desktop/src/lib/redact-secrets.streaming.test.ts b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
index fbd62db..bd8f51e 100644
--- a/apps/desktop/src/lib/redact-secrets.streaming.test.ts
+++ b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
@@ -113,6 +113,20 @@ describe("redacting a stream of output", () => {
     expect(redactor.append("").length).toBeLessThanOrEqual(REDACTED_PREVIEW_LIMIT);
   });
 
+  it("keeps up with a long stream of small writes into a value", () => {
+    // The cost of a piece of output must not grow with the text held back:
+    // a value that is written a little, very often, must not freeze the
+    // app.
+    const redactor = new OutputRedactor();
+    redactor.append("key=");
+    const started = Date.now();
+    for (let index = 0; index < 4_000; index += 1) {
+      redactor.append("abcdefghij");
+    }
+
+    expect(Date.now() - started).toBeLessThan(5_000);
+  });
+
   it("keeps up with a long stream of small writes", () => {
     // The cost of a piece of output must not grow with the output seen so
     // far: a command that writes a little, very often, must not freeze the
diff --git a/apps/desktop/src/lib/redact-secrets.ts b/apps/desktop/src/lib/redact-secrets.ts
index 09a8164..e5bf5b1 100644
--- a/apps/desktop/src/lib/redact-secrets.ts
+++ b/apps/desktop/src/lib/redact-secrets.ts
@@ -244,6 +244,7 @@ const INCOMPLETE_ESCAPE_TAIL_REGEX = new RegExp(
 /** How much of the redacted output the preview keeps. */
 export const REDACTED_PREVIEW_LIMIT = 600;
 
+
 // A private key block, open or closed. The whole markers are used, so that a
 // "-----BEGIN" that is not a key block is not treated as one.
 const PRIVATE_KEY_END = "-----END [A-Z ]*PRIVATE KEY-----";
@@ -1094,14 +1095,12 @@ export class OutputRedactor {
             // the preview.
             isWholeTokenRun(this.pending)
             ? REDACTION_PLACEHOLDER
-            : this.mode === "plain-value" || this.mode === "plain-quoted-value"
-              ? // An ordinary value can hold a credential, so the whole of
-                // it is masked, not only its tail.
-                this.redactEnabled ? redactSecrets(this.pending) : this.pending
-              : // A run of name characters cannot hold a credential, and a
-                // token inside it needs the text in front of it — so the
-                // token shapes are enough, and the cost stays small.
-                this.redactEnabled ? maskTokens(this.pending) : this.pending
+            : // The held text is masked with the token shapes. A token
+              // inside it needs the text in front of it, so all of the held
+              // text is masked — but with the token shapes alone, because
+              // the whole redaction over the whole of it would cost more
+              // with every piece of output.
+              this.redactEnabled ? maskTokens(this.pending) : this.pending
           : this.pending;
     return `${this.emitted}${held}`.slice(-REDACTED_PREVIEW_LIMIT).trim();
   }
```
