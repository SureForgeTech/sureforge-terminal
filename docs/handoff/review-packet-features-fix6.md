# Follow-up review packet, round 7 — the sixth round of findings

## What you are reviewing

- Repository: `SureForgeTech/sureforge-terminal`
- Read-only checkout: `/workspace/sureforge-terminal` (now at the head below; do not modify it)
- Head you reviewed last: `d94e2559ace0e8d2ee95ad0035e5188566b07f3d` (your verdict: BLOCK, 2 P0 / 3 P1 / 4 P2-P3)
- Head under review now: `39a92e9903d2ffb33a7c517e92e28151e133d593`
- Base of the whole feature range (unchanged): `4d24bdb0055cfecb1e8d013a2155663768e25700`

One commit was added on top of the head you reviewed: `39a92e9 fix(features): the sixth round of review findings, and the leaks they found`. Nothing below it changed.

## How to verify

Work from the checkout at `39a92e9`. For each finding you raised, decide whether it is actually fixed, by reading the code and running the tests. Re-derive the answer; do not take the description below as evidence that a fix works.

The complete diff of the new commit is at the end of this packet, and is also in `/tmp/opencode/features-fix6-d94e255..39a92e9.diff`.

## The findings, and where each was addressed

**P0.1 — the preview showed the tail of a token longer than the preview.** The preview now shows a run that is a token as the placeholder, instead of masking only the tail of the held text.

**P0.2 — after the safety valve tripped, the rest of the token was released raw.** The valve now ends in a state that drops the rest of the run (`drop-run`), so the tail of a token cannot reach the preview.

**P1.2 — the safety valve replaced an ordinary value with a placeholder.** An ordinary value is now released as it is, so nothing is lost.

**P1.3 — an unfinished escape sequence bypassed the bound.** The valve now counts the unfinished escape sequence, and drops it.

**P1.1 — an unterminated quoted value.** This one is a trade-off, and I would like you to judge it explicitly:

- The whole-text redaction reads a quoted value as one thing when a closing quote follows, and falls back to the bare value when the quote is never closed. A streaming redaction cannot tell the two apart at the moment the value starts: the closing quote may still arrive. So the streaming redaction holds the value until the closing quote or the end of the line.
- The consequence is that the *transient* preview of an unterminated quoted value is `password=[redacted]` rather than `password="[redacted]" with spaces`: the value is masked, and the text after it is not shown yet, because it may still turn out to be inside the quotes.
- Falling back to the bare value at the first space instead would show `secret password` in the preview for `password="secret password"` — the words of the secret would leak, which the whole-text redaction does not do. That is why the streaming redaction waits.
- What is *kept* is exact: `OutputRedactor.flush()` masks an open value the way the whole-text redaction masks it, and the store calls it when the next command starts (`recordPaneCommand` in `apps/desktop/src/store/sessions-store.ts`), so the persisted preview of a finished command is `password="[redacted]" with spaces` — the same as the whole-text redaction gives.

So the question for you: is the transient preview of an unterminated quoted value acceptable, given that the persisted value is exact and that the alternative leaks? If you would rather have it the other way, say which trade-off you would take and why.

## The two non-blocking findings you asked for

- The pair-split sweep now covers every fixture short enough for it, not only the first twelve.
- New tests: a token longer than the preview, a token that grows past the limit, an escape sequence that never finishes, an ordinary value longer than the limit, and a value that was still open when the output ended.

The changelog `(#N)` suffix is unchanged: the number is the pull request's, and it does not exist until the pull request is opened. The release script accepts the fragments as they are.

## Validation on the new head

```
$ npm run validate
  Test Files  206 passed (206)
       Tests  1185 passed | 1 skipped (1186)
  ✓ built in ...
  [validate] Docker is unavailable, so semgrep could not run.
exit status: 1
```

Exit 1 is the Docker-gated Semgrep step alone, exactly as on the base commit. `tsc -b` and ESLint are clean.

## What to check

- Whether each finding is genuinely fixed — reproduce the way you reproduced it.
- Whether the redaction still holds. The reference is `redactSecrets(stripTerminalCodes(text))`, truncated to the preview limit; the streaming test pins that over thirty-four fixtures, at every split and at every pair of splits.
- Whether the redaction is still bounded and still fast, and whether the safety valve can now lose ordinary output.
- Whether the flush leaves the store's persisted preview exact, and whether it can lose output.
- Whether anything else broke: the preview is still set rather than appended; the redaction can be turned off mid-stream; the store keeps one redactor per history entry and forgets it when the entry goes; the whole-text `redactSecrets` is unchanged and still used elsewhere.

The bar is unchanged: zero unresolved P0 or P1 findings.

## Complete diff of the new commit

```diff
diff --git a/apps/desktop/src/lib/redact-secrets.streaming.test.ts b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
index 6bb2bc1..545d577 100644
--- a/apps/desktop/src/lib/redact-secrets.streaming.test.ts
+++ b/apps/desktop/src/lib/redact-secrets.streaming.test.ts
@@ -82,7 +82,7 @@ describe("redacting a stream of output", () => {
   });
 
   it("gives the same preview when the output arrives in three pieces", () => {
-    for (const text of FIXTURES.filter((fixture) => fixture.length < 120).slice(0, 12)) {
+    for (const text of FIXTURES.filter((fixture) => fixture.length < 120)) {
       const expected = wholeTextPreview(text);
 
       for (let first = 1; first < text.length; first += 1) {
@@ -164,6 +164,62 @@ describe("redacting a stream of output", () => {
     expect(Date.now() - started).toBeLessThan(5_000);
   });
 
+  it("never shows the tail of a token that is longer than the preview", () => {
+    // The preview is the tail of the output, so masking only the tail of
+    // the held text would leave the tail of a long token in it.
+    const redactor = new OutputRedactor();
+    redactor.append(`ghp_${"A".repeat(1_000)}`);
+
+    const preview = redactor.append("");
+    expect(preview).not.toMatch(/A{100}/);
+    expect(preview).toContain("[redacted]");
+  });
+
+  it("never shows the tail of a token that grows past the limit", () => {
+    // A run that grows without an end is given up on: the rest of it is
+    // dropped, so that the tail of a token cannot reach the preview.
+    const redactor = new OutputRedactor();
+    const text = `ghp_${"A".repeat(70_000)}`;
+    for (let index = 0; index < text.length; index += 1_000) {
+      redactor.append(text.slice(index, index + 1_000));
+    }
+
+    const preview = redactor.append("");
+    expect(preview).not.toMatch(/A{100}/);
+    expect(redactor.heldLength).toBeLessThanOrEqual(64 * 1024);
+  });
+
+  it("gives up on an escape sequence that never finishes", () => {
+    // An unfinished escape sequence is held, and it cannot be a secret on
+    // its own: it is dropped rather than held for ever.
+    const redactor = new OutputRedactor();
+    redactor.append("\u001b[");
+    for (let index = 0; index < 100; index += 1) {
+      redactor.append("1".repeat(1_000));
+    }
+
+    expect(redactor.heldLength).toBeLessThanOrEqual(64 * 1024);
+  });
+
+  it("keeps an ordinary value that is longer than the limit", () => {
+    // An ordinary value is not a secret: it is released as it is, so that
+    // nothing is lost.
+    const redactor = new OutputRedactor();
+    const text = `key=${"x".repeat(65_540)}`;
+    redactor.append(text);
+
+    expect(redactor.append("")).toBe(wholeTextPreview(text));
+  });
+
+  it("finishes a value that was still open when the output ended", () => {
+    // A quoted value that was never closed falls back to the bare value,
+    // the way the whole-text redaction falls back to it.
+    const redactor = new OutputRedactor();
+    redactor.append('password="secret with spaces');
+
+    expect(redactor.flush()).toBe(wholeTextPreview('password="secret with spaces'));
+  });
+
   it("starts again when the redaction is turned on or off", () => {
     // A construct that was half-read under one setting must not swallow the
     // output under the other.
diff --git a/apps/desktop/src/lib/redact-secrets.ts b/apps/desktop/src/lib/redact-secrets.ts
index 1dae979..958e5df 100644
--- a/apps/desktop/src/lib/redact-secrets.ts
+++ b/apps/desktop/src/lib/redact-secrets.ts
@@ -459,6 +459,7 @@ export class OutputRedactor {
     | "secret-quoted-value"
     | "plain-value"
     | "plain-quoted-value"
+    | "drop-run"
     | "key" = "normal";
   /** The quote that opened the value, when the value is quoted. */
   private valueQuote = "";
@@ -490,6 +491,38 @@ export class OutputRedactor {
     this.valueMasked = false;
   }
 
+  /**
+   * Finish the output.
+   *
+   * A value that was still open when the output ended is masked the way the
+   * whole-text redaction masks it — a quoted value that was never closed
+   * falls back to the bare value — so that what is kept is the same as if
+   * the output had arrived in one piece.
+   */
+  flush(): string {
+    if (
+      this.mode === "secret-value" ||
+      this.mode === "secret-quoted-value" ||
+      this.mode === "plain-value" ||
+      this.mode === "plain-quoted-value"
+    ) {
+      const secret =
+        this.redactEnabled &&
+        (this.mode === "secret-value" || this.mode === "secret-quoted-value");
+      const bare = /[\s,;}]/.exec(this.pending);
+      const value = bare ? this.pending.slice(0, bare.index) : this.pending;
+      if (secret) {
+        this.release(maskedValue(value));
+      } else {
+        this.releaseTokens(value);
+      }
+      this.pending = bare ? this.pending.slice(bare.index) : "";
+      this.mode = "normal";
+      this.valueMasked = false;
+    }
+    return this.preview();
+  }
+
   /**
    * How much text the redactor is holding back.
    *
@@ -538,22 +571,47 @@ export class OutputRedactor {
    * dropped: the preview says less than it could, never more.
    */
   private guardHeldText(): void {
-    if (this.pending.length <= MAX_HELD_TEXT) {
+    if (this.pending.length + this.escapeCarry.length <= MAX_HELD_TEXT) {
       return;
     }
     const held = this.pending;
     this.pending = "";
-    this.release(REDACTION_PLACEHOLDER);
-    if (this.mode === "plain-value" || this.mode === "plain-quoted-value") {
-      this.mode = "normal";
-    }
-    if (this.mode === "key") {
-      return;
+    // An unfinished escape sequence is dropped: it cannot be a secret on
+    // its own, and it would otherwise be held for ever.
+    this.escapeCarry = "";
+
+    switch (this.mode) {
+      case "plain-value":
+      case "plain-quoted-value":
+        // An ordinary value is not a secret: it is released as it is, so
+        // that nothing is lost.
+        this.releaseTokens(held);
+        this.mode = "normal";
+        return;
+      case "secret-value":
+      case "secret-quoted-value":
+        // The value is a secret: it is dropped, and the placeholder says
+        // so.
+        this.release(REDACTION_PLACEHOLDER);
+        this.mode = "normal";
+        this.valueMasked = false;
+        return;
+      case "key":
+        // The body of a key block is already dropped.
+        return;
+      default:
+        break;
     }
-    // The rest of a construct that grows without an end is dropped.
+
+    this.release(REDACTION_PLACEHOLDER);
     if (held.includes("-----BEGIN")) {
+      // The rest of a key block is dropped.
       this.mode = "key";
+      return;
     }
+    // The rest of a run is dropped, so that the tail of a token cannot
+    // reach the preview.
+    this.mode = "drop-run";
   }
 
   /** Read as much of the held text as can be read. */
@@ -575,6 +633,9 @@ export class OutputRedactor {
         case "plain-quoted-value":
           progressed = this.lexValue();
           break;
+        case "drop-run":
+          progressed = this.lexDropRun();
+          break;
         case "key":
           progressed = this.lexKey();
           break;
@@ -785,6 +846,26 @@ export class OutputRedactor {
     return this.valueQuote !== "";
   }
 
+  /**
+   * The rest of a run that was given up on is arriving: it is dropped.
+   *
+   * The run was too long to hold, and it may be a token, so the rest of it
+   * cannot be released.
+   */
+  private lexDropRun(): boolean {
+    const end = this.pending.search(/[^A-Za-z0-9_.-]/);
+    if (end < 0) {
+      if (this.pending.length === 0) {
+        return false;
+      }
+      this.pending = "";
+      return true;
+    }
+    this.pending = this.pending.slice(end);
+    this.mode = "normal";
+    return true;
+  }
+
   /** The body of a private key block is arriving: it is dropped. */
   private lexKey(): boolean {
     const text = this.pending;
@@ -881,14 +962,19 @@ export class OutputRedactor {
         : this.mode === "key"
           ? ""
           : this.redactEnabled
-          ? // Only the tail of the held text is shown, so only the tail is
-            // masked: the cost of a piece of output must not grow with the
-            // text held back.
-            maskTokens(
-              this.pending.length > REDACTED_PREVIEW_LIMIT
-                ? this.pending.slice(-REDACTED_PREVIEW_LIMIT)
-                : this.pending
-            )
+          ? // A run that is a token is shown as the placeholder: masking
+            // only the tail of it would leave the tail of a long token in
+            // the preview.
+            isTokenRun(this.pending)
+            ? REDACTION_PLACEHOLDER
+            : // Only the tail of the held text is shown, so only the tail
+              // is masked: the cost of a piece of output must not grow with
+              // the text held back.
+              maskTokens(
+                this.pending.length > REDACTED_PREVIEW_LIMIT
+                  ? this.pending.slice(-REDACTED_PREVIEW_LIMIT)
+                  : this.pending
+              )
           : this.pending;
     return `${this.emitted}${held}`.slice(-REDACTED_PREVIEW_LIMIT).trim();
   }
diff --git a/apps/desktop/src/store/sessions-store.redaction.test.ts b/apps/desktop/src/store/sessions-store.redaction.test.ts
index 2fe6e43..a125793 100644
--- a/apps/desktop/src/store/sessions-store.redaction.test.ts
+++ b/apps/desktop/src/store/sessions-store.redaction.test.ts
@@ -169,6 +169,21 @@ describe("the session history and secrets", () => {
     expect(entry.command).toBe("cat .env");
   });
 
+  it("finishes the output of a command when the next one starts", () => {
+    // A quoted value that was never closed is masked the way the whole-text
+    // redaction masks it, once the output of the command is over.
+    const entry = recordOutput('password="secret with spaces');
+
+    const paneId = useSessionsStore.getState().tabs[0]?.paneIds[0];
+    expect(paneId).toBeTruthy();
+    useSessionsStore.getState().recordPaneCommand(paneId as string, "next command");
+
+    const finished = useSessionsStore
+      .getState()
+      .commandHistory.find((candidate) => candidate.id === entry?.id);
+    expect(finished?.outputPreview).toBe('password="[redacted]" with spaces');
+  });
+
   it("leaves the output alone when the user turns redaction off", () => {
     useAppStore.setState({ redactCommandOutput: false });
     const entry = recordOutput("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY");
diff --git a/apps/desktop/src/store/sessions-store.ts b/apps/desktop/src/store/sessions-store.ts
index 0e80f8d..f87de9c 100644
--- a/apps/desktop/src/store/sessions-store.ts
+++ b/apps/desktop/src/store/sessions-store.ts
@@ -814,8 +814,15 @@ export const useSessionsStore = create<SessionsState>()(
       recordPaneCommand: (paneId, command, source = "queued") => {
         const nextState = recordPaneCommandHistory(get(), paneId, command, source);
         forgetDroppedCommandOutput(nextState.commandHistory);
-        set(nextState);
-        return nextState.commandHistory[0]?.id;
+        // The output of the commands before this one is finished, so a value
+        // that was still open is masked the way the whole-text redaction
+        // masks it.
+        let finished = nextState;
+        for (const [entryId, redactor] of outputRedactors) {
+          finished = setPaneCommandHistoryOutput(finished, entryId, redactor.flush());
+        }
+        set(finished);
+        return finished.commandHistory[0]?.id;
       },
       appendCommandOutput: (entryId, output) => {
         // The preview is persisted with the history, so a secret printed by a
```
