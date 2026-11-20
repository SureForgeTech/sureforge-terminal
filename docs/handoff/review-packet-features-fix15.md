# Follow-up review packet, round 16 — the fifteenth round's finding

## What you are reviewing

- Repository: `SureForgeTech/sureforge-terminal`
- Read-only checkout: `/workspace/sureforge-terminal` (now at the head below; do not modify it)
- Head you reviewed last: `df5398e09d25b770786221d7f2b94fe20f86c43a` (your verdict: BLOCK, 0 P0 / 1 P1 / 3 P2-P3)
- Head under review now: `1d9a61cf5955e5b428eb0029db7dbd024d0b3301`
- Base of the whole feature range (unchanged): `4d24bdb0055cfecb1e8d013a2155663768e25700`

One commit was added on top of the head you reviewed: `1d9a61c fix(features): the fifteenth round of review finding, and the plain value that grew`. Nothing below `df5398e` changed.

## The finding, and where it was addressed

**P1 — the quoted-value fix reintroduced quadratic processing.** The states that held an ordinary value are gone. An ordinary value is ordinary text now: it is read the way the whole-text redaction reads the text after an assignment, so a credential inside it is masked as well, and the cost of a piece of output does not grow with it.

The timings you measured:

```
"key=" followed by repeated 10-character writes:
  1,000 pieces:  6 ms   (your measurement on the previous head: 1,670 ms)
  2,000 pieces:  7 ms   (5,487 ms)
  4,000 pieces: 10 ms   (23,166 ms)

key=" followed by repeated 10-character writes:
  1,000 pieces:  6 ms
  2,000 pieces:  7 ms
  4,000 pieces: 10 ms
```

And the credential inside a quoted ordinary value is still masked:

```
key="hello token=second-secret
  whole text: key="hello token=[redacted]"
  preview:    key="hello token=[redacted]"
  flushed:    key="hello token=[redacted]"
```

## New test

Four thousand small writes into a quoted value.

## Validation on the new head

```
$ npm run validate
  Test Files  206 passed (206)
       Tests  1204 passed | 1 skipped (1205)
  ✓ built in ...
  [validate] Docker is unavailable, so semgrep could not run.
exit status: 1
```

Exit 1 is the Docker-gated Semgrep step alone, exactly as on the base commit. `tsc -b` and ESLint are clean.

## What to check

- Whether the finding is genuinely fixed — reproduce the way you reproduced it.
- Whether removing the states that held an ordinary value brought back any of the earlier findings (the token that continues across a flush, the order of the text after a flush, the ordinary text after a value that was given up on, the credential in a quoted value, the token inside an ordinary value).
- Whether anything else broke, and whether the cost of a piece of output still does not grow with the output seen so far.

The bar is unchanged: zero unresolved P0 or P1 findings.

## Complete diff of the new commit

```diff
diff --git a/apps/desktop/src/lib/redact-secrets.streaming.test.ts b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
index b9fdb2e..8b95a03 100644
--- a/apps/desktop/src/lib/redact-secrets.streaming.test.ts
+++ b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
@@ -127,6 +127,19 @@ describe("redacting a stream of output", () => {
     expect(Date.now() - started).toBeLessThan(5_000);
   });
 
+  it("keeps up with a long stream of small writes into a quoted value", () => {
+    // A quoted value is held until its closing quote, so the same shape of
+    // output must not cost more with every piece.
+    const redactor = new OutputRedactor();
+    redactor.append('key="');
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
index 95b3e31..844d866 100644
--- a/apps/desktop/src/lib/redact-secrets.ts
+++ b/apps/desktop/src/lib/redact-secrets.ts
@@ -283,17 +283,6 @@ const TOKEN_PREFIXES: string[] = [
   "eyJ",
 ];
 
-/**
- * The start of the run of name characters at the end of the text.
- */
-function trailingRunStart(text: string): number {
-  let index = text.length;
-  while (index > 0 && NAME_CHARACTER.test(text[index - 1])) {
-    index -= 1;
-  }
-  return index;
-}
-
 /**
  * The tail of the text that is an escape sequence that has not finished.
  */
@@ -438,21 +427,6 @@ function isWholeTokenRun(run: string): boolean {
   return false;
 }
 
-/**
- * Whether the text ends with a run that could be a token.
- *
- * The safety valve uses this to tell an ordinary value from one that ends
- * in a token: the tail of a token must be dropped, and ordinary text must
- * not be.
- */
-function endsWithTokenRun(text: string): boolean {
-  let index = text.length;
-  while (index > 0 && NAME_CHARACTER.test(text[index - 1])) {
-    index -= 1;
-  }
-  return index < text.length && isTokenRun(text.slice(index));
-}
-
 /**
  * The masked form of a value, the way the whole-text redaction masks it.
  *
@@ -512,8 +486,6 @@ export class OutputRedactor {
     | "awaiting-value"
     | "secret-value"
     | "secret-quoted-value"
-    | "plain-value"
-    | "plain-quoted-value"
     | "drop-run"
     | "drop-value"
     | "drop-quoted-value"
@@ -557,36 +529,17 @@ export class OutputRedactor {
    * the output had arrived in one piece.
    */
   flush(): string {
-    if (
-      this.mode === "secret-value" ||
-      this.mode === "secret-quoted-value" ||
-      this.mode === "plain-value" ||
-      this.mode === "plain-quoted-value"
-    ) {
-      const secret =
-        this.redactEnabled &&
-        (this.mode === "secret-value" || this.mode === "secret-quoted-value");
+    if (this.mode === "secret-value" || this.mode === "secret-quoted-value") {
       const bare = /[\s,;}]/.exec(this.pending);
       const value = bare ? this.pending.slice(0, bare.index) : this.pending;
       // The text after the value is ordinary text, the way the whole-text
       // redaction reads it — but it is masked the same way, so that a second
       // credential in it is masked as well.
       const after = bare ? this.pending.slice(bare.index) : "";
-      if (secret) {
-        // A secret value is masked as one thing.
-        this.release(maskedValue(value));
-        this.release(this.redactEnabled ? redactSecrets(after) : after);
-        this.pending = "";
-      } else {
-        // An ordinary value is released as it is — but the run of name
-        // characters at its end is held back: it may be the start of a token
-        // whose rest arrives after this, and without the beginning of it the
-        // rest could not be recognised. The text after the value is held
-        // with it, so that the order of the output is not changed.
-        const runStart = trailingRunStart(value);
-        this.releaseTokens(value.slice(0, runStart));
-        this.pending = value.slice(runStart) + after;
-      }
+      // A secret value is masked as one thing.
+      this.release(maskedValue(value));
+      this.release(this.redactEnabled ? redactSecrets(after) : after);
+      this.pending = "";
       // The value stays OPEN: output that arrives after this is still part
       // of it, and it is still masked.
     }
@@ -651,14 +604,6 @@ export class OutputRedactor {
     this.escapeCarry = "";
 
     switch (this.mode) {
-      case "plain-value":
-      case "plain-quoted-value":
-        // An ordinary value is not a secret: it is released as it is, so
-        // that nothing is lost. A token inside it is masked, and the tail
-        // of a token is dropped, so that it cannot reach the preview.
-        this.releaseTokens(`${held}\n`.replace(/\n$/, ""));
-        this.mode = endsWithTokenRun(held) ? "drop-run" : "normal";
-        return;
       case "secret-value":
       case "secret-quoted-value":
         // The value is a secret: it is dropped, and the placeholder says
@@ -702,8 +647,6 @@ export class OutputRedactor {
           break;
         case "secret-value":
         case "secret-quoted-value":
-        case "plain-value":
-        case "plain-quoted-value":
           progressed = this.lexValue();
           break;
         case "drop-run":
@@ -763,9 +706,13 @@ export class OutputRedactor {
       this.releaseTokens(this.pending.slice(0, start));
       this.releaseTokens(this.pending.slice(start, assignment.separator + 1));
       this.pending = this.pending.slice(assignment.separator + 1);
-      // A secret assignment's value is masked; an ordinary one is held
-      // until it ends, so that a token inside it is masked as a whole.
-      this.mode = secret ? "awaiting-value" : "plain-value";
+      // A secret assignment's value is masked and dropped. An ordinary
+      // value is ordinary text: it is read the way the whole-text redaction
+      // reads the text after an assignment, so a credential inside it is
+      // masked too — and the cost of a piece of output stays the same.
+      if (secret) {
+        this.mode = "awaiting-value";
+      }
       return true;
     }
 
@@ -834,22 +781,8 @@ export class OutputRedactor {
       return false;
     }
 
-    // An ordinary assignment's value may be quoted: the whole-text
-    // redaction reads it as one thing, so it is read as one here too.
-    if (this.mode === "plain-value" && !this.valueQuote) {
-      const first = text[0];
-      if (first === '"' || first === "'") {
-        this.valueQuote = first;
-        this.mode = "plain-quoted-value";
-        return true;
-      }
-    }
-
-    const quoted =
-      this.mode === "secret-quoted-value" || this.mode === "plain-quoted-value";
-    const secret =
-      this.redactEnabled &&
-      (this.mode === "secret-value" || this.mode === "secret-quoted-value");
+    const quoted = this.mode === "secret-quoted-value";
+    const secret = this.redactEnabled && (this.mode === "secret-value" || quoted);
 
     // The value's extent: a quoted value ends at its closing quote, and a
     // bare value at the first whitespace or delimiter. A quote that is
@@ -1095,13 +1028,7 @@ export class OutputRedactor {
             // the preview.
             isWholeTokenRun(this.pending)
             ? REDACTION_PLACEHOLDER
-            : this.mode === "plain-quoted-value"
-              ? // A quoted value is held until its closing quote, and a
-                // credential can be inside it — so the whole redaction is
-                // used for it. A quoted value ends at the end of its line,
-                // so what is held is a line, not the whole output.
-                this.redactEnabled ? redactSecrets(this.pending) : this.pending
-              : // The held text is masked with the token shapes. A token
+            : // The held text is masked with the token shapes. A token
                 // inside it needs the text in front of it, so all of the held
                 // text is masked — but with the token shapes alone, because
                 // the whole redaction over the whole of it would cost more
```
