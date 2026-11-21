# Follow-up review packet, round 15 — the fourteenth round's finding

## What you are reviewing

- Repository: `SureForgeTech/sureforge-terminal`
- Read-only checkout: `/workspace/sureforge-terminal` (now at the head below; do not modify it)
- Head you reviewed last: `ace231d4078ddd796f78ff75bc6dd49d54d77a06` (your verdict: BLOCK, 1 P0 / 0 P1 / 3 P2-P3)
- Head under review now: `df5398e09d25b770786221d7f2b94fe20f86c43a`
- Base of the whole feature range (unchanged): `4d24bdb0055cfecb1e8d013a2155663768e25700`

One commit was added on top of the head you reviewed: `df5398e fix(features): the fourteenth round of review finding, and the credential in a quoted value`. Nothing below `ace231d` changed. The commit touches the redaction and its test.

## The finding, and where it was addressed

**P0 — the token-only preview exposed a credential assignment inside a plain quoted value.** A quoted ordinary value is held until its closing quote, so the preview of one now uses the whole redaction (`redactSecrets`), not the token shapes alone. A quoted value ends at the end of its line, so what is held for it is a line and not the whole output.

The reproduction you gave now gives the whole-text result:

```
key="hello token=second-secret
  whole text: key="hello token=[redacted]"
  preview:    key="hello token=[redacted]"
  flushed:    key="hello token=[redacted]"
```

The timing you measured is unchanged — the unquoted value path still uses the token shapes alone:

```
"key=" followed by repeated 10-character writes:
  1,000 pieces: 11 ms
  2,000 pieces: 28 ms
  4,000 pieces: 101 ms
```

## New test

A credential inside a quoted ordinary value: the preview must not contain it, and it must equal the whole-text result.

## Validation on the new head

```
$ npm run validate
  Test Files  206 passed (206)
       Tests  1203 passed | 1 skipped (1204)
  ✓ built in ...
  [validate] Docker is unavailable, so semgrep could not run.
exit status: 1
```

Exit 1 is the Docker-gated Semgrep step alone, exactly as on the base commit. `tsc -b` and ESLint are clean.

## What to check

- Whether the finding is genuinely fixed — reproduce the way you reproduced it.
- Whether the quoted-value path can now be slow: it masks the held text with the whole redaction on every piece. A quoted value that is written a little, very often, is the case to try.
- Whether anything else broke.

The bar is unchanged: zero unresolved P0 or P1 findings.

## Complete diff of the new commit

```diff
diff --git a/apps/desktop/src/lib/redact-secrets.streaming.test.ts b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
index bd8f51e..b9fdb2e 100644
--- a/apps/desktop/src/lib/redact-secrets.streaming.test.ts
+++ b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
@@ -352,6 +352,16 @@ describe("redacting a stream of output", () => {
     expect(redactor.flush()).toBe(wholeTextPreview('key="hello world'));
   });
 
+  it("never shows a credential that is inside a quoted ordinary value", () => {
+    // A quoted value is held until its closing quote, and a credential can
+    // be inside it.
+    const redactor = new OutputRedactor();
+    redactor.append('key="hello token=second-secret');
+
+    expect(redactor.append("")).not.toContain("second-secret");
+    expect(redactor.append("")).toBe(wholeTextPreview('key="hello token=second-secret'));
+  });
+
   it("leaves a run that is too short to be a token alone", () => {
     // The token shapes have their own lengths: "ghp_abcdefghij" is not a
     // GitHub token, and hiding it would hide text that is not a secret.
diff --git a/apps/desktop/src/lib/redact-secrets.ts b/apps/desktop/src/lib/redact-secrets.ts
index e5bf5b1..95b3e31 100644
--- a/apps/desktop/src/lib/redact-secrets.ts
+++ b/apps/desktop/src/lib/redact-secrets.ts
@@ -1095,12 +1095,18 @@ export class OutputRedactor {
             // the preview.
             isWholeTokenRun(this.pending)
             ? REDACTION_PLACEHOLDER
-            : // The held text is masked with the token shapes. A token
-              // inside it needs the text in front of it, so all of the held
-              // text is masked — but with the token shapes alone, because
-              // the whole redaction over the whole of it would cost more
-              // with every piece of output.
-              this.redactEnabled ? maskTokens(this.pending) : this.pending
+            : this.mode === "plain-quoted-value"
+              ? // A quoted value is held until its closing quote, and a
+                // credential can be inside it — so the whole redaction is
+                // used for it. A quoted value ends at the end of its line,
+                // so what is held is a line, not the whole output.
+                this.redactEnabled ? redactSecrets(this.pending) : this.pending
+              : // The held text is masked with the token shapes. A token
+                // inside it needs the text in front of it, so all of the held
+                // text is masked — but with the token shapes alone, because
+                // the whole redaction over the whole of it would cost more
+                // with every piece of output.
+                this.redactEnabled ? maskTokens(this.pending) : this.pending
           : this.pending;
     return `${this.emitted}${held}`.slice(-REDACTED_PREVIEW_LIMIT).trim();
   }
```
