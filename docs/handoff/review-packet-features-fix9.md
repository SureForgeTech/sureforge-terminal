# Follow-up review packet, round 10 — the ninth round of findings

## What you are reviewing

- Repository: `SureForgeTech/sureforge-terminal`
- Read-only checkout: `/workspace/sureforge-terminal` (now at the head below; do not modify it)
- Head you reviewed last: `c31fa52bf26e830c9975940d1a36da681d578cc6` (your verdict: BLOCK, 2 P0 / 2 P1 / 4 P2-P3)
- Head under review now: `23e308afa682c4efd02465f1f11e146b31ea9ec3`
- Base of the whole feature range (unchanged): `4d24bdb0055cfecb1e8d013a2155663768e25700`

One commit was added on top of the head you reviewed: `23e308a fix(features): the ninth round of review findings, and the two leaks in it`. Nothing below `c31fa52` changed.

## How to verify

Work from the checkout at `23e308a`. For each finding you raised, decide whether it is actually fixed, by reading the code and running the tests. Re-derive the answer; do not take the description below as evidence that a fix works.

The complete diff of the new commit is at the end of this packet, and is also in `/tmp/opencode/features-fix9-c31fa52..23e308a.diff`.

## The findings, and where each was addressed

**P0.1 — a quoted secret value that was given up on dropped only up to the next space.** A quoted value has its own dropping state now (`drop-quoted-value`), and it goes on until the closing quote, because a space inside the quotes does not end the value.

**P0.2 — finishing the output closed the value, so output that arrived after it was released as ordinary text.** `flush()` no longer closes the value: it masks what is open and releases the text after it, and the value stays OPEN, so output that arrives afterwards is still masked. The preview of a continued value shows a second placeholder rather than the words of the secret.

**P1.1 — the cascade that closes the panes of a host did not finish their output.** `closePanesForHost` now finishes the output of the panes it closes, like `closePane` and `closeTab` do.

**P1.2 — a run that was the right length but the wrong shape was hidden.** The whole-text token shapes are used now (`isWholeTokenRun`), so "eyJ" without the three segments of a JSON web token and an AWS key id in lower case are left alone, and a run that is a token and nothing else is the only one shown as the placeholder.

## New tests

- A quoted secret that is given up on and carries words after the space.
- A value that is still masked after the output was finished.
- The cascade that closes a host's panes.
- Runs that are the right length but the wrong shape: `eyJ` with twenty-six characters, an AWS key id in lower case.

## Validation on the new head

```
$ npm run validate
  Test Files  206 passed (206)
       Tests  1197 passed | 1 skipped (1198)
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
index d6b0c1f..e77af67 100644
--- a/apps/desktop/src/lib/redact-secrets.streaming.test.ts
+++ b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
@@ -259,10 +259,39 @@ describe("redacting a stream of output", () => {
     }
   });
 
+  it("never shows the words of a quoted secret that is given up on", () => {
+    // A space inside the quotes does not end the value, so the dropping goes
+    // on until the closing quote.
+    const redactor = new OutputRedactor();
+    const text = `password="${"A".repeat(70_000)} secret words with spaces"`;
+    for (let index = 0; index < text.length; index += 1_000) {
+      redactor.append(text.slice(index, index + 1_000));
+    }
+
+    expect(redactor.append("")).not.toContain("secret words");
+  });
+
+  it("keeps masking a value after the output was finished", () => {
+    // The output of a command can go quiet and then carry on. Finishing it
+    // must not let the words of the secret out.
+    const redactor = new OutputRedactor();
+    redactor.append('password="secret');
+    redactor.flush();
+    redactor.append(' with spaces"');
+
+    expect(redactor.append("")).not.toContain("with spaces");
+  });
+
   it("leaves a run that is too short to be a token alone", () => {
     // The token shapes have their own lengths: "ghp_abcdefghij" is not a
     // GitHub token, and hiding it would hide text that is not a secret.
-    for (const text of ["ghp_abcdefghij", "AKIA1234567890", "eyJabcdefghij"]) {
+    for (const text of [
+      "ghp_abcdefghij",
+      "AKIA1234567890",
+      "eyJabcdefghij",
+      `eyJ${"A".repeat(26)}`,
+      "AKIAabcdefghijklmnop",
+    ]) {
       const redactor = new OutputRedactor();
       redactor.append(text);
 
diff --git a/apps/desktop/src/lib/redact-secrets.ts b/apps/desktop/src/lib/redact-secrets.ts
index 6a253c6..435654c 100644
--- a/apps/desktop/src/lib/redact-secrets.ts
+++ b/apps/desktop/src/lib/redact-secrets.ts
@@ -264,22 +264,22 @@ const NAME_CHARACTER = /[A-Za-z0-9_.-]/;
 // The prefixes a run can start with and still be a token, and the least a
 // token can be after its prefix: the shortest run the whole-text
 // redaction's own token shapes would mask.
-const TOKEN_PREFIXES: Array<{ prefix: string; minimum: number }> = [
-  { prefix: "AKIA", minimum: 16 },
-  { prefix: "ASIA", minimum: 16 },
-  { prefix: "ghp_", minimum: 16 },
-  { prefix: "gho_", minimum: 16 },
-  { prefix: "ghu_", minimum: 16 },
-  { prefix: "ghs_", minimum: 16 },
-  { prefix: "ghr_", minimum: 16 },
-  { prefix: "github_pat_", minimum: 20 },
-  { prefix: "glpat-", minimum: 20 },
-  { prefix: "xoxa-", minimum: 10 },
-  { prefix: "xoxb-", minimum: 10 },
-  { prefix: "xoxp-", minimum: 10 },
-  { prefix: "xoxr-", minimum: 10 },
-  { prefix: "xoxs-", minimum: 10 },
-  { prefix: "eyJ", minimum: 26 },
+const TOKEN_PREFIXES: string[] = [
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
+  "xoxb_",
+  "xoxp_",
+  "xoxr_",
+  "xoxs_",
+  "eyJ",
 ];
 
 /**
@@ -397,19 +397,29 @@ function privateKeyHeaderState(text: string): "complete" | "partial" | "none" {
  * token that is released too early leaves its tail in the preview.
  */
 function isTokenRun(run: string): boolean {
-  return TOKEN_PREFIXES.some(({ prefix }) => run.startsWith(prefix));
+  return TOKEN_PREFIXES.some((prefix) => run.startsWith(prefix));
 }
 
 /**
- * Whether a run of name characters is long enough to be a token.
+ * Whether a run of name characters is a token and nothing else.
  *
- * The placeholder is only used for a run that the whole-text redaction
- * would mask: a bare "ghp_" is not a token, and hiding it would hide text
- * that is not a secret.
+ * The placeholder is only used for text that IS a token: a bare "ghp_" is
+ * not one, and hiding it would hide text that is not a secret. The
+ * whole-text token shapes are used, so a run that is the right length but
+ * the wrong shape — "eyJ" without the three segments of a JSON web token,
+ * an AWS key id in lower case — is left alone as well.
+ *
+ * The shapes need a boundary after the token, so a delimiter is added to
+ * see whether the run would be masked.
  */
-function isCompleteTokenRun(run: string): boolean {
-  for (const { prefix, minimum } of TOKEN_PREFIXES) {
-    if (run.startsWith(prefix) && run.length >= prefix.length + minimum) {
+function isWholeTokenRun(run: string): boolean {
+  const probe = `${run} `;
+  for (const pattern of TOKEN_PATTERNS) {
+    if (pattern.source.includes("PRIVATE KEY")) {
+      continue;
+    }
+    const shape = new RegExp(`^(?:${pattern.source}) $`, pattern.flags.replace("g", ""));
+    if (shape.test(probe)) {
       return true;
     }
   }
@@ -494,6 +504,7 @@ export class OutputRedactor {
     | "plain-quoted-value"
     | "drop-run"
     | "drop-value"
+    | "drop-quoted-value"
     | "key" = "normal";
   /** The quote that opened the value, when the value is quoted. */
   private valueQuote = "";
@@ -550,9 +561,12 @@ export class OutputRedactor {
       } else {
         this.releaseTokens(value);
       }
-      this.pending = bare ? this.pending.slice(bare.index) : "";
-      this.mode = "normal";
-      this.valueMasked = false;
+      // The text after the value is ordinary text, the way the whole-text
+      // redaction reads it.
+      this.releaseTokens(bare ? this.pending.slice(bare.index) : "");
+      this.pending = "";
+      // The value stays OPEN: output that arrives after this is still part
+      // of it, and it is still masked.
     }
     return this.preview();
   }
@@ -629,7 +643,8 @@ export class OutputRedactor {
         // so. The rest of the value is dropped as well, so that the words
         // of the secret cannot reach the preview.
         this.release(REDACTION_PLACEHOLDER);
-        this.mode = "drop-value";
+        this.mode =
+          this.mode === "secret-quoted-value" ? "drop-quoted-value" : "drop-value";
         this.valueMasked = false;
         return;
       case "key":
@@ -675,6 +690,9 @@ export class OutputRedactor {
         case "drop-value":
           progressed = this.lexDropValue();
           break;
+        case "drop-quoted-value":
+          progressed = this.lexDropQuotedValue();
+          break;
         case "key":
           progressed = this.lexKey();
           break;
@@ -926,6 +944,27 @@ export class OutputRedactor {
     return true;
   }
 
+  /**
+   * The rest of a quoted value that was given up on is arriving: it is
+   * dropped.
+   *
+   * A space inside the quotes does not end the value, so the dropping goes
+   * on until the closing quote.
+   */
+  private lexDropQuotedValue(): boolean {
+    const end = this.closingQuote(this.pending);
+    if (end < 0) {
+      if (this.pending.length === 0) {
+        return false;
+      }
+      this.pending = "";
+      return true;
+    }
+    this.pending = this.pending.slice(end + 1);
+    this.mode = "normal";
+    return true;
+  }
+
   /** The body of a private key block is arriving: it is dropped. */
   private lexKey(): boolean {
     const text = this.pending;
@@ -1025,7 +1064,7 @@ export class OutputRedactor {
           ? // A run that is a token is shown as the placeholder: masking
             // only the tail of it would leave the tail of a long token in
             // the preview.
-            isCompleteTokenRun(this.pending)
+            isWholeTokenRun(this.pending)
             ? REDACTION_PLACEHOLDER
             : // The whole of the held text is masked, not only its tail: a
               // token inside it needs the text in front of it to be
diff --git a/apps/desktop/src/store/sessions-store.redaction.test.ts b/apps/desktop/src/store/sessions-store.redaction.test.ts
index c1263d7..f8112f2 100644
--- a/apps/desktop/src/store/sessions-store.redaction.test.ts
+++ b/apps/desktop/src/store/sessions-store.redaction.test.ts
@@ -248,6 +248,26 @@ describe("the session history and secrets", () => {
     }
   });
 
+  it("finishes the output of a command when its host's panes close", () => {
+    // The cascade path closes the panes of a host; the output of their
+    // commands is over too.
+    const tabId = useSessionsStore.getState().openSession(sampleHosts[0]);
+    const paneId = useSessionsStore.getState().tabs.find((tab) => tab.id === tabId)?.paneIds[0];
+    if (!paneId) {
+      throw new Error("no pane");
+    }
+
+    const entryId = useSessionsStore.getState().recordPaneCommand(paneId, "cat .env");
+    useSessionsStore.getState().appendCommandOutput(entryId as string, 'password="secret');
+
+    useSessionsStore.getState().closePanesForHost(sampleHosts[0].id);
+
+    const entry = useSessionsStore
+      .getState()
+      .commandHistory.find((candidate) => candidate.id === entryId);
+    expect(entry?.outputPreview).toBe('password="[redacted]"');
+  });
+
   it("leaves the output alone when the user turns redaction off", () => {
     useAppStore.setState({ redactCommandOutput: false });
     const entry = recordOutput("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY");
diff --git a/apps/desktop/src/store/sessions-store.ts b/apps/desktop/src/store/sessions-store.ts
index 40ea2d6..96d86dc 100644
--- a/apps/desktop/src/store/sessions-store.ts
+++ b/apps/desktop/src/store/sessions-store.ts
@@ -835,7 +835,8 @@ export const useSessionsStore = create<SessionsState>()(
         closeBackendSessionsForPanes(get().panes, paneIds);
         
         set((state) => {
-          let nextState = { ...state };
+          // The panes are closing, so the output of their commands is over.
+          let nextState = finishPaneOutput(state, paneIds);
           // Find tabs that contain these panes and remove the panes
           for (const tab of nextState.tabs) {
             const overlap = tab.paneIds.filter(id => paneIds.includes(id));
```
