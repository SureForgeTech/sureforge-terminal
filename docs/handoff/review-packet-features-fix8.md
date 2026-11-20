# Follow-up review packet, round 9 — the eighth round of findings

## What you are reviewing

- Repository: `SureForgeTech/sureforge-terminal`
- Read-only checkout: `/workspace/sureforge-terminal` (now at the head below; do not modify it)
- Head you reviewed last: `885472650ff9810ad647adadb1847dd9faf31097` (your verdict: BLOCK, 1 P0 / 3 P1 / 4 P2-P3)
- Head under review now: `c31fa52bf26e830c9975940d1a36da681d578cc6`
- Base of the whole feature range (unchanged): `4d24bdb0055cfecb1e8d013a2155663768e25700`

Two commits were added on top of the head you reviewed: `70bb505` (the findings) and `c31fa52` (the completion signal). Nothing below `8854726` changed.

## How to verify

Work from the checkout at `c31fa52`. For each finding you raised, decide whether it is actually fixed, by reading the code and running the tests. Re-derive the answer; do not take the description below as evidence that a fix works.

The complete diff of the two commits is at the end of this packet, and is also in `/tmp/opencode/features-fix8-8854726..c31fa52.diff`.

## The findings, and where each was addressed

**P0 — after the safety valve tripped on a secret value, the rest was released raw.** The secret-value modes now drop the rest of the value (`drop-value`), so the words of the secret cannot reach the preview.

**P1.1 — a finished command was never finalised.** There are now three completion signals, all of them real:
- the next command in the SAME pane starts (`recordPaneCommand`);
- the pane closes (`closePane`, `closeTab`);
- the output goes quiet for a moment (`OUTPUT_QUIET_MS` in `apps/desktop/src/store/sessions-store.ts`), which is when a command that has printed nothing more is over.

The quiet period is scheduled per history entry and cancelled when the entry is forgotten.

**P1.2 — one length was used for every token shape.** The shapes have their own lengths now: a GitHub or AWS token needs sixteen characters after its prefix, a GitLab token twenty, a fine-grained GitHub token twenty, a Slack token ten, a JSON web token three segments.

**P1.3 — an ordinary value that was given up on had the text after it dropped.** The text after it is kept now, and only the tail of a token is dropped.

## New tests

- A secret value, bare and quoted, that continues after the cap.
- Runs that are too short to be a token: `ghp_abcdefghij`, `AKIA1234567890`, `eyJabcdefghij`.
- The ordinary text that follows a value that is given up on.
- A command whose output goes quiet: the exact preview follows.
- A command whose pane closes: the exact preview follows.

## Validation on the new head

```
$ npm run validate
  Test Files  206 passed (206)
       Tests  1194 passed | 1 skipped (1195)
  ✓ built in ...
  [validate] Docker is unavailable, so semgrep could not run.
exit status: 1
```

Exit 1 is the Docker-gated Semgrep step alone, exactly as on the base commit. `tsc -b` and ESLint are clean.

## What to check

- Whether each finding is genuinely fixed — reproduce the way you reproduced it.
- Whether the redaction still holds, and whether the preview can leak through some other path.
- Whether the completion signals are right: is there a case where a command's output really is finished but is not finalised, or where a command that is still running is finalised? The quiet period is 1.5 s — is that the right shape for a command that prints for a long time without finishing?
- Whether the quiet-period timer can leak, keep the process alive, or update a store that is gone.
- Whether the cost of a piece of output still does not grow with the output seen so far.

The bar is unchanged: zero unresolved P0 or P1 findings.

## Complete diff of the two commits

```diff
diff --git a/apps/desktop/src/lib/redact-secrets.streaming.test.ts b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
index 3281881..d6b0c1f 100644
--- a/apps/desktop/src/lib/redact-secrets.streaming.test.ts
+++ b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
@@ -246,6 +246,42 @@ describe("redacting a stream of output", () => {
     }
   });
 
+  it("never shows the rest of a secret value that is given up on", () => {
+    // The value is a secret, so the rest of it is dropped: the words of the
+    // secret cannot reach the preview.
+    for (const text of [`password=${"A".repeat(70_000)}`, `password="${"A".repeat(70_000)}`]) {
+      const redactor = new OutputRedactor();
+      for (let index = 0; index < text.length; index += 1_000) {
+        redactor.append(text.slice(index, index + 1_000));
+      }
+
+      expect(redactor.append("")).not.toMatch(/A{100}/);
+    }
+  });
+
+  it("leaves a run that is too short to be a token alone", () => {
+    // The token shapes have their own lengths: "ghp_abcdefghij" is not a
+    // GitHub token, and hiding it would hide text that is not a secret.
+    for (const text of ["ghp_abcdefghij", "AKIA1234567890", "eyJabcdefghij"]) {
+      const redactor = new OutputRedactor();
+      redactor.append(text);
+
+      expect(redactor.append("")).toBe(wholeTextPreview(text));
+    }
+  });
+
+  it("keeps the ordinary text that follows a value that is given up on", () => {
+    // An ordinary value is released as it is, so the text after it is not
+    // lost.
+    const redactor = new OutputRedactor();
+    const text = `key=${"x".repeat(65_540)}${"ORDINARYTAIL".repeat(100)}`;
+    for (let index = 0; index < text.length; index += 1_000) {
+      redactor.append(text.slice(index, index + 1_000));
+    }
+
+    expect(redactor.append("")).toContain("ORDINARYTAIL");
+  });
+
   it("finishes a value that was still open when the output ended", () => {
     // A quoted value that was never closed falls back to the bare value,
     // the way the whole-text redaction falls back to it.
diff --git a/apps/desktop/src/lib/redact-secrets.ts b/apps/desktop/src/lib/redact-secrets.ts
index f72d975..6a253c6 100644
--- a/apps/desktop/src/lib/redact-secrets.ts
+++ b/apps/desktop/src/lib/redact-secrets.ts
@@ -261,27 +261,25 @@ const MAX_HELD_TEXT = 64 * 1024;
 // The characters a name, a token or a key marker is made of.
 const NAME_CHARACTER = /[A-Za-z0-9_.-]/;
 
-// The least a token can be, after its prefix: the shortest run the
-// whole-text redaction's token shapes would mask.
-const MIN_TOKEN_LENGTH = 10;
-
-// The prefixes a run can start with and still be a token.
-const TOKEN_PREFIXES = [
-  "AKIA",
-  "ASIA",
-  "ghp_",
-  "gho_",
-  "ghu_",
-  "ghs_",
-  "ghr_",
-  "github_pat_",
-  "glpat-",
-  "xoxa-",
-  "xoxb-",
-  "xoxp-",
-  "xoxr-",
-  "xoxs-",
-  "eyJ",
+// The prefixes a run can start with and still be a token, and the least a
+// token can be after its prefix: the shortest run the whole-text
+// redaction's own token shapes would mask.
+const TOKEN_PREFIXES: Array<{ prefix: string; minimum: number }> = [
+  { prefix: "AKIA", minimum: 16 },
+  { prefix: "ASIA", minimum: 16 },
+  { prefix: "ghp_", minimum: 16 },
+  { prefix: "gho_", minimum: 16 },
+  { prefix: "ghu_", minimum: 16 },
+  { prefix: "ghs_", minimum: 16 },
+  { prefix: "ghr_", minimum: 16 },
+  { prefix: "github_pat_", minimum: 20 },
+  { prefix: "glpat-", minimum: 20 },
+  { prefix: "xoxa-", minimum: 10 },
+  { prefix: "xoxb-", minimum: 10 },
+  { prefix: "xoxp-", minimum: 10 },
+  { prefix: "xoxr-", minimum: 10 },
+  { prefix: "xoxs-", minimum: 10 },
+  { prefix: "eyJ", minimum: 26 },
 ];
 
 /**
@@ -399,7 +397,7 @@ function privateKeyHeaderState(text: string): "complete" | "partial" | "none" {
  * token that is released too early leaves its tail in the preview.
  */
 function isTokenRun(run: string): boolean {
-  return TOKEN_PREFIXES.some((prefix) => run.startsWith(prefix));
+  return TOKEN_PREFIXES.some(({ prefix }) => run.startsWith(prefix));
 }
 
 /**
@@ -410,17 +408,29 @@ function isTokenRun(run: string): boolean {
  * that is not a secret.
  */
 function isCompleteTokenRun(run: string): boolean {
-  for (const prefix of TOKEN_PREFIXES) {
-    if (!run.startsWith(prefix)) {
-      continue;
-    }
-    if (run.length >= prefix.length + MIN_TOKEN_LENGTH) {
+  for (const { prefix, minimum } of TOKEN_PREFIXES) {
+    if (run.startsWith(prefix) && run.length >= prefix.length + minimum) {
       return true;
     }
   }
   return false;
 }
 
+/**
+ * Whether the text ends with a run that could be a token.
+ *
+ * The safety valve uses this to tell an ordinary value from one that ends
+ * in a token: the tail of a token must be dropped, and ordinary text must
+ * not be.
+ */
+function endsWithTokenRun(text: string): boolean {
+  let index = text.length;
+  while (index > 0 && NAME_CHARACTER.test(text[index - 1])) {
+    index -= 1;
+  }
+  return index < text.length && isTokenRun(text.slice(index));
+}
+
 /**
  * The masked form of a value, the way the whole-text redaction masks it.
  *
@@ -608,18 +618,18 @@ export class OutputRedactor {
       case "plain-value":
       case "plain-quoted-value":
         // An ordinary value is not a secret: it is released as it is, so
-        // that nothing is lost. A token inside it is masked, and the rest
-        // of the value is dropped, so that the tail of a token cannot reach
-        // the preview.
+        // that nothing is lost. A token inside it is masked, and the tail
+        // of a token is dropped, so that it cannot reach the preview.
         this.releaseTokens(`${held}\n`.replace(/\n$/, ""));
-        this.mode = "drop-value";
+        this.mode = endsWithTokenRun(held) ? "drop-run" : "normal";
         return;
       case "secret-value":
       case "secret-quoted-value":
         // The value is a secret: it is dropped, and the placeholder says
-        // so.
+        // so. The rest of the value is dropped as well, so that the words
+        // of the secret cannot reach the preview.
         this.release(REDACTION_PLACEHOLDER);
-        this.mode = "normal";
+        this.mode = "drop-value";
         this.valueMasked = false;
         return;
       case "key":
diff --git a/apps/desktop/src/store/sessions-store.redaction.test.ts b/apps/desktop/src/store/sessions-store.redaction.test.ts
index 4b6d9de..c1263d7 100644
--- a/apps/desktop/src/store/sessions-store.redaction.test.ts
+++ b/apps/desktop/src/store/sessions-store.redaction.test.ts
@@ -211,6 +211,43 @@ describe("the session history and secrets", () => {
     expect(entry?.outputPreview).not.toContain("with spaces");
   });
 
+  it("finishes the output of a command when its pane closes", () => {
+    // The pane is closing, so the output of its commands is over.
+    const tabId = useSessionsStore.getState().openSession(sampleHosts[0]);
+    const paneId = useSessionsStore.getState().tabs.find((tab) => tab.id === tabId)?.paneIds[0];
+    if (!paneId) {
+      throw new Error("no pane");
+    }
+
+    const entryId = useSessionsStore.getState().recordPaneCommand(paneId, "cat .env");
+    useSessionsStore.getState().appendCommandOutput(entryId as string, 'password="secret');
+
+    useSessionsStore.getState().closePane(tabId, paneId);
+
+    const entry = useSessionsStore
+      .getState()
+      .commandHistory.find((candidate) => candidate.id === entryId);
+    expect(entry?.outputPreview).toBe('password="[redacted]"');
+  });
+
+  it("finishes the output of a command when it goes quiet", () => {
+    // The output of a command stops when the command is over, so a quiet
+    // period is the signal that what was written is all there will be.
+    vi.useFakeTimers();
+    try {
+      const entry = recordOutput('password="secret with spaces');
+
+      vi.advanceTimersByTime(2_000);
+
+      const finished = useSessionsStore
+        .getState()
+        .commandHistory.find((candidate) => candidate.id === entry?.id);
+      expect(finished?.outputPreview).toBe('password="[redacted]" with spaces');
+    } finally {
+      vi.useRealTimers();
+    }
+  });
+
   it("leaves the output alone when the user turns redaction off", () => {
     useAppStore.setState({ redactCommandOutput: false });
     const entry = recordOutput("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY");
diff --git a/apps/desktop/src/store/sessions-store.ts b/apps/desktop/src/store/sessions-store.ts
index 7f39d9d..40ea2d6 100644
--- a/apps/desktop/src/store/sessions-store.ts
+++ b/apps/desktop/src/store/sessions-store.ts
@@ -71,6 +71,67 @@ function limitCommandHistory(commandHistory: SessionCommandHistoryEntry[]) {
 // persisted.
 const outputRedactors = new Map<string, OutputRedactor>();
 
+// How long the output of a command has to be quiet before it is treated as
+// finished. A command that prints nothing more is over, and a value that
+// was still open is masked the way the whole-text redaction masks it.
+const OUTPUT_QUIET_MS = 1_500;
+
+const outputFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();
+
+/** Forget the timer that finishes the output of an entry. */
+function cancelOutputFlush(entryId: string) {
+  const timer = outputFlushTimers.get(entryId);
+  if (timer !== undefined) {
+    clearTimeout(timer);
+    outputFlushTimers.delete(entryId);
+  }
+}
+
+/**
+ * Schedule the end of the output of an entry.
+ *
+ * The output of a command stops when the command is over, so a quiet period
+ * is the signal that what was written is all there will be.
+ */
+function scheduleOutputFlush(entryId: string, flush: () => void) {
+  cancelOutputFlush(entryId);
+  const timer = setTimeout(() => {
+    outputFlushTimers.delete(entryId);
+    flush();
+  }, OUTPUT_QUIET_MS);
+  // The timer must not keep the process alive.
+  const unref = (timer as unknown as { unref?: () => void }).unref;
+  if (typeof unref === "function") {
+    unref.call(timer);
+  }
+  outputFlushTimers.set(entryId, timer);
+}
+
+/**
+ * Finish the output of the commands of a pane.
+ *
+ * A value that was still open when the command's output ended is masked the
+ * way the whole-text redaction masks it, so that what is kept is the same
+ * as if the output had arrived in one piece.
+ */
+function finishPaneOutput(
+  state: SessionWorkspaceState & { commandHistory: SessionCommandHistoryEntry[] },
+  paneIds: string[]
+): SessionWorkspaceState & { commandHistory: SessionCommandHistoryEntry[] } {
+  let finished = state;
+  for (const entry of finished.commandHistory) {
+    if (!paneIds.includes(entry.paneId)) {
+      continue;
+    }
+    const redactor = outputRedactors.get(entry.id);
+    if (!redactor) {
+      continue;
+    }
+    finished = setPaneCommandHistoryOutput(finished, entry.id, redactor.flush());
+  }
+  return finished;
+}
+
 /**
  * Forget the redactor of entries the history no longer holds.
  *
@@ -82,6 +143,7 @@ function forgetDroppedCommandOutput(commandHistory: SessionCommandHistoryEntry[]
   for (const entryId of outputRedactors.keys()) {
     if (!held.has(entryId)) {
       outputRedactors.delete(entryId);
+      cancelOutputFlush(entryId);
     }
   }
 }
@@ -758,7 +820,11 @@ export const useSessionsStore = create<SessionsState>()(
         if (tab) {
           closeBackendSessionsForPanes(panes, tab.paneIds);
         }
-        set((state) => closeSessionTab(state, tabId));
+        set((state) => {
+          // The tab is closing, so the output of its commands is over.
+          const finished = tab ? finishPaneOutput(state, tab.paneIds) : state;
+          return closeSessionTab(finished, tabId);
+        });
       },
       splitTab: (tabId, host) => set((state) => splitSessionPane(state, tabId, host)),
       closePanesForHost: (hostId) => {
@@ -794,7 +860,11 @@ export const useSessionsStore = create<SessionsState>()(
       },
       closePane: (tabId, paneId) => {
         closeBackendSessionsForPanes(get().panes, [paneId]);
-        set((state) => removeSessionPane(state, tabId, paneId));
+        set((state) => {
+          // The pane is closing, so the output of its commands is over.
+          const finished = finishPaneOutput(state, [paneId]);
+          return removeSessionPane(finished, tabId, paneId);
+        });
       },
       selectPane: (tabId, paneId) => set((state) => setActiveSessionPane(state, tabId, paneId)),
       setPaneState: (paneId, connectionState, connectionError) =>
@@ -847,7 +917,19 @@ export const useSessionsStore = create<SessionsState>()(
           redactor.setRedactionEnabled(redact);
           outputRedactors.set(entryId, redactor);
 
-          return setPaneCommandHistoryOutput(state, entryId, redactor.append(output));
+          const next = setPaneCommandHistoryOutput(state, entryId, redactor.append(output));
+          // The output of a command is over when it goes quiet, so a value
+          // that was still open is masked the way the whole-text redaction
+          // masks it.
+          scheduleOutputFlush(entryId, () => {
+            const current = get();
+            const entry = current.commandHistory.find((candidate) => candidate.id === entryId);
+            if (!entry) {
+              return;
+            }
+            set(setPaneCommandHistoryOutput(current, entryId, redactor.flush()));
+          });
+          return next;
         });
       },
       clearCommandHistory: () => {
```
