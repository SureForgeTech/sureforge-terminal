# Follow-up review packet, round 11 — the tenth round of findings

## What you are reviewing

- Repository: `SureForgeTech/sureforge-terminal`
- Read-only checkout: `/workspace/sureforge-terminal` (now at the head below; do not modify it)
- Head you reviewed last: `23e308afa682c4efd02465f1f11e146b31ea9ec3` (your verdict: BLOCK, 2 P0 / 1 P1 / 5 P2-P3)
- Head under review now: `e1e3e32eb27f021b938d032a3fa5933222bc3055`
- Base of the whole feature range (unchanged): `4d24bdb0055cfecb1e8d013a2155663768e25700`

One commit was added on top of the head you reviewed: `e1e3e32 fix(features): the tenth round of review findings, and the leak the typo made`. Nothing below `23e308a` changed.

## How to verify

Work from the checkout at `e1e3e32`. For each finding you raised, decide whether it is actually fixed, by reading the code and running the tests. Re-derive the answer; do not take the description below as evidence that a fix works.

The complete diff of the new commit is at the end of this packet, and is also in `/tmp/opencode/features-fix10-23e308a..e1e3e32.diff`.

## The findings, and where each was addressed

**P0.1 — the flush released the text after an open value with the token shapes alone.** The text after the value is now masked the way the whole-text redaction masks it (`redactSecrets`), so a second credential in it is masked as well.

**P0.2 — the Slack prefixes had underscores instead of hyphens.** That was a typo of mine, introduced when the prefix list was rewritten. The hyphens are back, and a test covers a long Slack token split across many pieces.

**P1 — a dropped quoted value never ended, so the ordinary text after the line was dropped as well.** The dropped value now falls back to the bare value at the newline, the way the quoted lexer does, and the text after the line is ordinary text again.

## New tests

- A second credential waiting in the output when the output is finished.
- A Slack token split across many pieces.
- The ordinary text after a line that ends a dropped value.

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

- Whether each finding is genuinely fixed — reproduce the way you reproduced it.
- Whether the redaction still holds, and whether the preview can leak through some other path.
- Whether the lexer broke anything else, and whether the cost of a piece of output still does not grow with the output seen so far.

The bar is unchanged: zero unresolved P0 or P1 findings.

## Complete diff of the new commit

```diff
diff --git a/apps/desktop/src/lib/redact-secrets.streaming.test.ts b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
index e77af67..e5460fd 100644
--- a/apps/desktop/src/lib/redact-secrets.streaming.test.ts
+++ b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
@@ -271,6 +271,39 @@ describe("redacting a stream of output", () => {
     expect(redactor.append("")).not.toContain("secret words");
   });
 
+  it("masks a second credential that is waiting when the output is finished", () => {
+    // The text after the open value is ordinary text, but it is masked the
+    // same way, so a second credential in it is masked as well.
+    const redactor = new OutputRedactor();
+    redactor.append('password="secret token=second-secret');
+
+    const flushed = redactor.flush();
+    expect(flushed).not.toContain("second-secret");
+    expect(flushed).toBe(wholeTextPreview('password="secret token=second-secret'));
+  });
+
+  it("never shows a Slack token that is split across many pieces", () => {
+    const redactor = new OutputRedactor();
+    const text = `xoxb-${"A".repeat(1_000)}`;
+    for (let index = 0; index < text.length; index += 10) {
+      redactor.append(text.slice(index, index + 10));
+    }
+
+    const preview = redactor.append("");
+    expect(preview).not.toMatch(/A{100}/);
+    expect(preview).toContain("[redacted]");
+  });
+
+  it("keeps the ordinary text after a line that ends a dropped value", () => {
+    const redactor = new OutputRedactor();
+    const text = `password="${"A".repeat(70_000)}\nordinary-after-key`;
+    for (let index = 0; index < text.length; index += 1_000) {
+      redactor.append(text.slice(index, index + 1_000));
+    }
+
+    expect(redactor.append("")).toContain("ordinary-after-key");
+  });
+
   it("keeps masking a value after the output was finished", () => {
     // The output of a command can go quiet and then carry on. Finishing it
     // must not let the words of the secret out.
diff --git a/apps/desktop/src/lib/redact-secrets.ts b/apps/desktop/src/lib/redact-secrets.ts
index 435654c..a7a263c 100644
--- a/apps/desktop/src/lib/redact-secrets.ts
+++ b/apps/desktop/src/lib/redact-secrets.ts
@@ -275,10 +275,10 @@ const TOKEN_PREFIXES: string[] = [
   "github_pat_",
   "glpat-",
   "xoxa-",
-  "xoxb_",
-  "xoxp_",
-  "xoxr_",
-  "xoxs_",
+  "xoxb-",
+  "xoxp-",
+  "xoxr-",
+  "xoxs-",
   "eyJ",
 ];
 
@@ -562,8 +562,10 @@ export class OutputRedactor {
         this.releaseTokens(value);
       }
       // The text after the value is ordinary text, the way the whole-text
-      // redaction reads it.
-      this.releaseTokens(bare ? this.pending.slice(bare.index) : "");
+      // redaction reads it — but it is masked the same way, so that a second
+      // credential in it is masked as well.
+      const rest = bare ? this.pending.slice(bare.index) : "";
+      this.release(this.redactEnabled ? redactSecrets(rest) : rest);
       this.pending = "";
       // The value stays OPEN: output that arrives after this is still part
       // of it, and it is still masked.
@@ -957,6 +959,13 @@ export class OutputRedactor {
       if (this.pending.length === 0) {
         return false;
       }
+      if (this.pending.includes("\n")) {
+        // The quote is never closed before the line ends, so the value falls
+        // back to the bare one — and the text after the line is ordinary
+        // text again.
+        this.mode = "drop-value";
+        return true;
+      }
       this.pending = "";
       return true;
     }
```
