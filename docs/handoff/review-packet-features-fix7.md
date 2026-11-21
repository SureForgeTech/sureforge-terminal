# Follow-up review packet, round 8 — the seventh round of findings

## What you are reviewing

- Repository: `SureForgeTech/sureforge-terminal`
- Read-only checkout: `/workspace/sureforge-terminal` (now at the head below; do not modify it)
- Head you reviewed last: `39a92e9903d2ffb33a7c517e92e28151e133d593` (your verdict: BLOCK, 3 P0 / 1 P1 / 4 P2-P3)
- Head under review now: `885472650ff9810ad647adadb1847dd9faf31097`
- Base of the whole feature range (unchanged): `4d24bdb0055cfecb1e8d013a2155663768e25700`

One commit was added on top of the head you reviewed: `8854726 fix(features): the seventh round of review findings, and the three leaks in it`. Nothing below it changed.

## How to verify

Work from the checkout at `8854726`. For each finding you raised, decide whether it is actually fixed, by reading the code and running the tests. Re-derive the answer; do not take the description below as evidence that a fix works.

The complete diff of the new commit is at the end of this packet, and is also in `/tmp/opencode/features-fix7-39a92e9..8854726.diff`.

## The findings, and where each was addressed

**P0.1 — a token inside an ordinary value leaked through the preview tail.** The preview now masks the WHOLE of the held text, not only its tail: a token inside it needs the text in front of it to be recognised.

**P0.2 — the safety valve released the suffix of a token in a plain value.** The valve now releases the held text masked and enters a state that drops the rest of the value (`drop-value`), so the tail of a token cannot reach the preview.

**P0.3 — starting a command in any pane flushed every open value.** The store now finishes the output of a command when the next command in the SAME pane starts (`recordPaneCommand` in `apps/desktop/src/store/sessions-store.ts`); the commands in the other panes are untouched.

**P1.1 — a lone token prefix was hidden.** The placeholder is only used for a run that is long enough for the whole-text token shape to mask it (`isCompleteTokenRun`), so "ghp_" and "ghp_abc" are left alone, as the whole-text redaction leaves them.

## Your judgement on the unterminated quote

You accepted the security-first transient behaviour, and asked that the finalisation happen on a real per-command completion signal. It does now: the output of a command is finished when the next command in the same pane starts, and `flush()` masks an open value the way the whole-text redaction masks it. A test in `apps/desktop/src/store/sessions-store.redaction.test.ts` drives two panes: a command in one pane starts while the other pane's value is open, and the other pane's output goes on afterwards — its words must not appear.

## New tests

- A token inside an ordinary value, and the same token in a value that is given up on.
- A token prefix that is too short to be a token.
- Two panes, with the output of one continuing after a command starts in the other.

## Validation on the new head

```
$ npm run validate
  Test Files  206 passed (206)
       Tests  1189 passed | 1 skipped (1190)
  ✓ built in ...
  [validate] Docker is unavailable, so semgrep could not run.
exit status: 1
```

Exit 1 is the Docker-gated Semgrep step alone, exactly as on the base commit. `tsc -b` and ESLint are clean.

## What to check

- Whether each finding is genuinely fixed — reproduce the way you reproduced it.
- Whether the redaction still holds, and whether the preview can now leak through some other path: a token that is not at the start of the held text, a token that spans the held text and the released text, a value that is given up on in one mode and continues in another.
- Whether the per-pane finalisation is right: is there a case where a command's output really is finished but is not finalised, or vice versa?
- Whether the masking of the whole held text costs too much: the cost of a piece of output must not grow with the output seen so far.

The bar is unchanged: zero unresolved P0 or P1 findings.

## Complete diff of the new commit

```diff
diff --git a/apps/desktop/src/lib/redact-secrets.streaming.test.ts b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
index 545d577..3281881 100644
--- a/apps/desktop/src/lib/redact-secrets.streaming.test.ts
+++ b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
@@ -211,6 +211,41 @@ describe("redacting a stream of output", () => {
     expect(redactor.append("")).toBe(wholeTextPreview(text));
   });
 
+  it("never shows a token that is inside an ordinary value", () => {
+    // The token needs the text in front of it to be recognised, so the
+    // whole of the held text is masked, not only its tail.
+    const redactor = new OutputRedactor();
+    const text = `key=prefix-${"x".repeat(100)}-ghp_${"A".repeat(1_000)}`;
+    redactor.append(text);
+
+    const preview = redactor.append("");
+    expect(preview).not.toMatch(/A{100}/);
+    expect(preview).toBe(wholeTextPreview(text));
+  });
+
+  it("never shows the tail of a token inside an ordinary value that is given up on", () => {
+    const redactor = new OutputRedactor();
+    const text = `key=ghp_${"A".repeat(70_000)}`;
+    for (let index = 0; index < text.length; index += 1_000) {
+      redactor.append(text.slice(index, index + 1_000));
+    }
+
+    const preview = redactor.append("");
+    expect(preview).not.toMatch(/A{100}/);
+    expect(preview).toContain("[redacted]");
+  });
+
+  it("leaves a token prefix that is too short to be a token alone", () => {
+    // "ghp_" is not a token, and hiding it would hide text that is not a
+    // secret.
+    for (const text of ["ghp_", "ghp_abc"]) {
+      const redactor = new OutputRedactor();
+      redactor.append(text);
+
+      expect(redactor.append("")).toBe(wholeTextPreview(text));
+    }
+  });
+
   it("finishes a value that was still open when the output ended", () => {
     // A quoted value that was never closed falls back to the bare value,
     // the way the whole-text redaction falls back to it.
diff --git a/apps/desktop/src/lib/redact-secrets.ts b/apps/desktop/src/lib/redact-secrets.ts
index 958e5df..f72d975 100644
--- a/apps/desktop/src/lib/redact-secrets.ts
+++ b/apps/desktop/src/lib/redact-secrets.ts
@@ -261,6 +261,10 @@ const MAX_HELD_TEXT = 64 * 1024;
 // The characters a name, a token or a key marker is made of.
 const NAME_CHARACTER = /[A-Za-z0-9_.-]/;
 
+// The least a token can be, after its prefix: the shortest run the
+// whole-text redaction's token shapes would mask.
+const MIN_TOKEN_LENGTH = 10;
+
 // The prefixes a run can start with and still be a token.
 const TOKEN_PREFIXES = [
   "AKIA",
@@ -398,6 +402,25 @@ function isTokenRun(run: string): boolean {
   return TOKEN_PREFIXES.some((prefix) => run.startsWith(prefix));
 }
 
+/**
+ * Whether a run of name characters is long enough to be a token.
+ *
+ * The placeholder is only used for a run that the whole-text redaction
+ * would mask: a bare "ghp_" is not a token, and hiding it would hide text
+ * that is not a secret.
+ */
+function isCompleteTokenRun(run: string): boolean {
+  for (const prefix of TOKEN_PREFIXES) {
+    if (!run.startsWith(prefix)) {
+      continue;
+    }
+    if (run.length >= prefix.length + MIN_TOKEN_LENGTH) {
+      return true;
+    }
+  }
+  return false;
+}
+
 /**
  * The masked form of a value, the way the whole-text redaction masks it.
  *
@@ -460,6 +483,7 @@ export class OutputRedactor {
     | "plain-value"
     | "plain-quoted-value"
     | "drop-run"
+    | "drop-value"
     | "key" = "normal";
   /** The quote that opened the value, when the value is quoted. */
   private valueQuote = "";
@@ -584,9 +608,11 @@ export class OutputRedactor {
       case "plain-value":
       case "plain-quoted-value":
         // An ordinary value is not a secret: it is released as it is, so
-        // that nothing is lost.
-        this.releaseTokens(held);
-        this.mode = "normal";
+        // that nothing is lost. A token inside it is masked, and the rest
+        // of the value is dropped, so that the tail of a token cannot reach
+        // the preview.
+        this.releaseTokens(`${held}\n`.replace(/\n$/, ""));
+        this.mode = "drop-value";
         return;
       case "secret-value":
       case "secret-quoted-value":
@@ -636,6 +662,9 @@ export class OutputRedactor {
         case "drop-run":
           progressed = this.lexDropRun();
           break;
+        case "drop-value":
+          progressed = this.lexDropValue();
+          break;
         case "key":
           progressed = this.lexKey();
           break;
@@ -866,6 +895,27 @@ export class OutputRedactor {
     return true;
   }
 
+  /**
+   * The rest of an ordinary value that was given up on is arriving: it is
+   * dropped.
+   *
+   * The value was too long to hold, and it may hold a token, so the rest of
+   * it cannot be released.
+   */
+  private lexDropValue(): boolean {
+    const end = /[\s,;}]/.exec(this.pending);
+    if (!end) {
+      if (this.pending.length === 0) {
+        return false;
+      }
+      this.pending = "";
+      return true;
+    }
+    this.pending = this.pending.slice(end.index);
+    this.mode = "normal";
+    return true;
+  }
+
   /** The body of a private key block is arriving: it is dropped. */
   private lexKey(): boolean {
     const text = this.pending;
@@ -965,16 +1015,12 @@ export class OutputRedactor {
           ? // A run that is a token is shown as the placeholder: masking
             // only the tail of it would leave the tail of a long token in
             // the preview.
-            isTokenRun(this.pending)
+            isCompleteTokenRun(this.pending)
             ? REDACTION_PLACEHOLDER
-            : // Only the tail of the held text is shown, so only the tail
-              // is masked: the cost of a piece of output must not grow with
-              // the text held back.
-              maskTokens(
-                this.pending.length > REDACTED_PREVIEW_LIMIT
-                  ? this.pending.slice(-REDACTED_PREVIEW_LIMIT)
-                  : this.pending
-              )
+            : // The whole of the held text is masked, not only its tail: a
+              // token inside it needs the text in front of it to be
+              // recognised.
+            maskTokens(this.pending)
           : this.pending;
     return `${this.emitted}${held}`.slice(-REDACTED_PREVIEW_LIMIT).trim();
   }
diff --git a/apps/desktop/src/store/sessions-store.redaction.test.ts b/apps/desktop/src/store/sessions-store.redaction.test.ts
index a125793..4b6d9de 100644
--- a/apps/desktop/src/store/sessions-store.redaction.test.ts
+++ b/apps/desktop/src/store/sessions-store.redaction.test.ts
@@ -184,6 +184,33 @@ describe("the session history and secrets", () => {
     expect(finished?.outputPreview).toBe('password="[redacted]" with spaces');
   });
 
+  it("does not finish the output of a command in another pane", () => {
+    // A command in one pane must not finish the open value of a command in
+    // another pane: that pane's output is still arriving.
+    const first = useSessionsStore.getState().openSession(sampleHosts[0]);
+    const second = useSessionsStore.getState().openSession(sampleHosts[1]);
+    const state = useSessionsStore.getState();
+    const firstPaneId = state.tabs.find((tab) => tab.id === first)?.paneIds[0];
+    const secondPaneId = state.tabs.find((tab) => tab.id === second)?.paneIds[0];
+    if (!firstPaneId || !secondPaneId) {
+      throw new Error("no panes");
+    }
+
+    const entryId = useSessionsStore.getState().recordPaneCommand(firstPaneId, "cat .env");
+    useSessionsStore.getState().appendCommandOutput(entryId as string, 'password="secret');
+
+    // A command in the other pane starts.
+    useSessionsStore.getState().recordPaneCommand(secondPaneId, "uptime");
+
+    // The first pane's output goes on.
+    useSessionsStore.getState().appendCommandOutput(entryId as string, ' with spaces"');
+
+    const entry = useSessionsStore
+      .getState()
+      .commandHistory.find((candidate) => candidate.id === entryId);
+    expect(entry?.outputPreview).not.toContain("with spaces");
+  });
+
   it("leaves the output alone when the user turns redaction off", () => {
     useAppStore.setState({ redactCommandOutput: false });
     const entry = recordOutput("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY");
diff --git a/apps/desktop/src/store/sessions-store.ts b/apps/desktop/src/store/sessions-store.ts
index f87de9c..7f39d9d 100644
--- a/apps/desktop/src/store/sessions-store.ts
+++ b/apps/desktop/src/store/sessions-store.ts
@@ -814,12 +814,20 @@ export const useSessionsStore = create<SessionsState>()(
       recordPaneCommand: (paneId, command, source = "queued") => {
         const nextState = recordPaneCommandHistory(get(), paneId, command, source);
         forgetDroppedCommandOutput(nextState.commandHistory);
-        // The output of the commands before this one is finished, so a value
-        // that was still open is masked the way the whole-text redaction
-        // masks it.
+        // The output of the previous command in THIS pane is finished, so a
+        // value that was still open is masked the way the whole-text
+        // redaction masks it. The commands in the other panes are still
+        // running, and their output must not be finished by this one.
         let finished = nextState;
-        for (const [entryId, redactor] of outputRedactors) {
-          finished = setPaneCommandHistoryOutput(finished, entryId, redactor.flush());
+        for (const entry of finished.commandHistory) {
+          if (entry.paneId !== paneId || entry.id === nextState.commandHistory[0]?.id) {
+            continue;
+          }
+          const redactor = outputRedactors.get(entry.id);
+          if (!redactor) {
+            continue;
+          }
+          finished = setPaneCommandHistoryOutput(finished, entry.id, redactor.flush());
         }
         set(finished);
         return finished.commandHistory[0]?.id;
```
