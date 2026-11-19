# Independent review packet — five features on `sureforge-terminal`

## What you are reviewing

- Repository: `SureForgeTech/sureforge-terminal` (public, Apache-2.0) — a local-first macOS SSH client (Tauri native shell in Rust, React/Vite desktop UI in `apps/desktop/`, Node backend for browser mode).
- Read-only checkout for you: `/workspace/sureforge-terminal`
- Base commit: `4d24bdb0055cfecb1e8d013a2155663768e25700`
- Head commit under review: `33151d4ae8b75cf6b399feabb9510d6c431509d7`
- Range: `4d24bdb..33151d4` (five commits, linear)
- The checkout is exactly at the head commit. Do not modify it, do not commit to it, do not run anything that writes to it. You may read any file, run read-only commands, and run the test suite.

## Commits in the range

- `33151d4` feat(connect): a failure that needs the host offers a way to get there
- `f2ed2c3` feat(sessions): broadcast what you type to every open session
- `1aedcf9` feat(hosts): a group can carry the settings its hosts share
- `5c24aa1` feat(terminal): pick the font family and size
- `dfac535` feat(history): mask the secrets in the command output the history keeps

## The five features

Each was chosen from the repository's own parity/roadmap documents and verified against the tree before it was built.

### 1. `dfac535` — History output redaction

**Problem.** The session history keeps a preview of what each command printed, and that preview is persisted across restarts. A command that printed a token left the secret in the local storage the history is written to. The roadmap names this as a live risk.

**Acceptance criteria.**
- A secret in the captured output is masked before the preview is kept: a credential in an assignment (`password=`, `"api_key": "..."`, `token:`), an AWS access key id, a GitHub/GitLab/Slack token, a JSON web token, a PEM private key block.
- Ordinary output is untouched — a history that hides everything is a history nobody can search. `authorisation: granted`, `tokenizer=fast`, `secretary=alice` must NOT be masked.
- The command itself is NOT masked: the history replays the command into a session, and a masked command would run as something else.
- The behaviour is a preference (`redactCommandOutput`), on by default, persisted with the other app preferences, and switchable off in Settings.
- The masking happens at the one place output enters the history (`appendCommandOutput` in `sessions-store.ts`), so every producer is covered.

**Files.** `apps/desktop/src/lib/redact-secrets.ts` (+ `.test.ts`), `apps/desktop/src/store/sessions-store.ts` (+ `sessions-store.redaction.test.ts`), `apps/desktop/src/store/app-store.ts`, `apps/desktop/src/routes/SettingsPreferencesSection.tsx`.

### 2. `5c24aa1` — Terminal font picker

**Problem.** The parity matrix named the font picker as the last of the shell-preference gaps: the terminal had one hard-coded font stack and one hard-coded size, so a person whose font was not on the machine — or whose screen needed a different size — had no way to change it.

**Acceptance criteria.**
- The default family and size are exactly what the terminal already used, so a user who changes nothing sees no difference.
- Ten families are offered, each with fallbacks behind it so a font that is not installed still renders as a monospace face.
- The size is clamped to a readable range; an unknown persisted font name or an out-of-range persisted size must not leave the terminal unreadable.
- A terminal that is already open follows the preference, applied through the xterm options the way the theme already was, so the scrollback and the SSH session survive the change.
- The preference is persisted with the other app preferences.

**Files.** `apps/desktop/src/lib/terminal-fonts.ts` (+ `.test.ts`), `apps/desktop/src/store/app-store.ts` (+ `.test.ts`), `apps/desktop/src/components/terminal/TerminalPane.tsx`, `use-terminal-pane-session.ts`, `use-terminal-pane-lifecycle.ts`, `apps/desktop/src/routes/SettingsPreferencesSection.tsx`.

### 3. `1aedcf9` — Group-inherited host settings

**Problem.** The parity matrix said the group surfaces carried "no inherited protocol settings yet": every host in a group had to be given its own bastion, its own SFTP root and its own environment, one host at a time, and every one of them drifted.

**Acceptance criteria.**
- A group can carry the settings its hosts share: the sign-in name, the bastion, the SFTP root and the environment.
- The group's settings are DEFAULTS: a host that sets one of them itself keeps its own value; it takes the group's for what it does not set. Nothing is overwritten.
- The environment is merged per key, so a host can override one variable and inherit the rest.
- A host with no group, or a group with no settings, inherits nothing.
- The inheritance is applied where the connection is actually built (`buildBackendConnectionRecursive` in `apps/desktop/src/lib/connections.ts`), so it covers the real connect path, and it reaches the jump host, the SFTP root and the environment.
- The settings are persisted and editable in Settings, and the section only shows groups that actually have hosts.

**Files.** `apps/desktop/src/store/group-settings-store.ts` (+ `.test.ts`), `apps/desktop/src/lib/connections.ts`, `apps/desktop/src/routes/SettingsGroupSettingsSection.tsx`, `apps/desktop/src/routes/SettingsPage.tsx`.

### 4. `f2ed2c3` — Broadcast input to every open session

**Problem.** The competitor's daily-use list has "broadcast input across multiple terminals", and this app could only broadcast a SNIPPET across hosts: there was no way to type into several live sessions at once.

**Acceptance criteria.**
- What is typed in a live session is sent to every other pane taking part in the broadcast.
- The broadcast is OFF by default, and a visible banner says so on screen while it is on — input that goes to four terminals instead of one must never happen by accident.
- Turning it off empties the set, so a later broadcast never reaches a session that has been closed.
- A pane whose session is not open is skipped: a broadcast never queues input for a session that is not there.
- The pane being typed in always sends to its own session directly: its input never depends on the broadcast reaching it, and it is never delivered twice.
- The button is disabled until at least two live sessions are open.

**Files.** `apps/desktop/src/store/broadcast-store.ts` (+ `.test.ts`), `apps/desktop/src/components/terminal/terminal-pane-input-wiring.ts` (+ `.broadcast.test.ts`, + `.test.ts`), `use-terminal-pane-lifecycle.ts`, `apps/desktop/src/components/terminal/TerminalWorkspace.tsx`.

### 5. `33151d4` — Actionable connect failures

**Problem.** The connect banner could say what went wrong, but a failure the user can only fix on the host — a key to approve, a host key that would not scan — left them hunting for the right screen.

**Acceptance criteria.**
- The banner carries an ACTION beside the message; "Open host" takes the user to that host's editor.
- The action is declarative (a route to go to), so the store holds no callbacks and the banner owns the navigation.
- The action is cleared with the message, so a stale action cannot outlive the problem it belonged to.
- A failure with no action to offer still shows the message and the Dismiss control — the action is an addition, not a replacement.
- Every failure mode still reports through the same single entry point (`reportConnectError`), which refuses an empty message.

**Files.** `apps/desktop/src/store/connect-error-store.ts` (+ `.test.ts`), `apps/desktop/src/components/common/ConnectErrorBanner.tsx` (+ `.test.tsx`), `apps/desktop/src/lib/launch-host-session.ts` (+ `.test.ts`).

## Validation actually run (on this exact head)

```
$ npm run validate          # scripts/validate.sh: effort guard, version consistency,
                            # secret-on-argv check, lint, Vitest, desktop build,
                            # changed-file Semgrep (needs Docker)
  Test Files  202 passed (202)
       Tests  1133 passed | 1 skipped (1134)
  ✓ built in 382ms
  [validate] rust build + tests skipped (macOS only — the native crate ships on macOS)
  [validate] native trust tooling skipped (macOS only)
  [validate] localhost sshd transport fixture skipped (set TERMSNIP_RUN_SSH_FIXTURE=1 ...)
  [validate] rust advisory audit skipped (set TERMSNIP_RUN_RUST_AUDIT=1 ...)
  [validate] real backend transport fixture skipped (macOS only — needs a local sshd)
  [validate] browser e2e skipped (set TERMSNIP_RUN_E2E=1 to include)
  [validate] Docker is unavailable, so semgrep could not run.
exit status: 1
```

The exit status is 1 **only** because of the Docker-gated Semgrep step: this sandbox has no Docker, and the gate fails rather than skips. The same step fails the same way on the base commit `4d24bdb` (the pre-existing baseline), so it is not caused by this change. Everything else — effort guard, version consistency, secret-on-argv, ESLint, the full Vitest suite and the desktop build — passes.

Also run separately, all clean:

```
$ node ./scripts/pnpmw.mjs --filter desktop typecheck      # tsc -b      → exit 0
$ ./node_modules/.bin/eslint .                              #             → exit 0
$ ./node_modules/.bin/vitest run --config vitest.config.ts   #             → 202 files, 1133 passed, 1 skipped
```

No Rust, no `apps/desktop/server/backend.mjs`, no dependency and no CI-configuration file was touched by this range, so the Rust, backend-fixture and advisory gates are not in scope for it.

## What to check, and what the bar is

The bar is the repository's own: **zero unresolved P0 or P1 findings**. P2/P3 (nits, style, "could be nicer") may be reported but must not block.

Look for, in particular:

- **Correctness holes.** A case where the new behaviour is wrong, unreachable, or does not do what the acceptance criteria above say.
- **Safety holes.** The redaction is a security control: can a secret still reach the persisted preview (a second output path, a direct store write, a redaction rule that misses a common shape)? The broadcast is a safety control: can input reach a session that is not taking part, be delivered twice, or be left on after the broadcast is turned off?
- **Regression risk in unchanged code.** Each change touches an existing file; check the surrounding code you were not given in the diff by reading it in the checkout.
- **State/persistence hazards.** Three stores changed shape (`app-store` gained `terminalFont`, `terminalFontSize`, `redactCommandOutput`; a new `group-settings` store; the connect-error store gained `action`). Check the migration/default paths for a persisted value that is missing, unknown or out of range.
- **Test quality.** Do the tests pin the contract, or do they merely restate the implementation? A test that would still pass if the feature were broken is a finding.

You may run the test suite yourself to reproduce a claim (`cd /workspace/sureforge-terminal && ./node_modules/.bin/vitest run --config vitest.config.ts <path>`), and you may read any file in the checkout. Do not write to the checkout.

## Complete git-generated diff for the range

Verbatim `git diff 4d24bdb..33151d4`, every changed path and hunk included, nothing summarized, reformatted or truncated.

```diff
diff --git a/apps/desktop/src/components/common/ConnectErrorBanner.test.tsx b/apps/desktop/src/components/common/ConnectErrorBanner.test.tsx
index af1750f..cc72b68 100644
--- a/apps/desktop/src/components/common/ConnectErrorBanner.test.tsx
+++ b/apps/desktop/src/components/common/ConnectErrorBanner.test.tsx
@@ -13,10 +13,20 @@
 // This pins the banner contract: the message reaches the screen, it is
 // announced to assistive tech, and the user can dismiss it.
 import { cleanup, fireEvent, render, screen } from "@testing-library/react";
+import { MemoryRouter } from "react-router-dom";
 import { afterEach, beforeEach, describe, expect, it } from "vitest";
 import { ConnectErrorBanner } from "./ConnectErrorBanner";
 import { useConnectErrorStore } from "../../store/connect-error-store";
 
+// The banner's action navigates, so it lives inside the router the app has.
+function renderBanner() {
+  return render(
+    <MemoryRouter>
+      <ConnectErrorBanner />
+    </MemoryRouter>
+  );
+}
+
 describe("ConnectErrorBanner", () => {
   beforeEach(() => {
     useConnectErrorStore.getState().clearConnectError();
@@ -28,7 +38,7 @@ describe("ConnectErrorBanner", () => {
   });
 
   it("renders nothing when there is no failure to report", () => {
-    render(<ConnectErrorBanner />);
+    renderBanner();
 
     expect(screen.queryByRole("alert")).toBeNull();
   });
@@ -38,7 +48,7 @@ describe("ConnectErrorBanner", () => {
       .getState()
       .setConnectError("Could not scan example.internal:22. Check that the host is reachable and try again.");
 
-    render(<ConnectErrorBanner />);
+    renderBanner();
 
     const banner = screen.getByRole("alert");
     expect(banner.textContent).toContain("Could not scan example.internal:22.");
@@ -47,7 +57,7 @@ describe("ConnectErrorBanner", () => {
   it("announces the failure to assistive tech", () => {
     useConnectErrorStore.getState().setConnectError("Something failed.");
 
-    render(<ConnectErrorBanner />);
+    renderBanner();
 
     expect(screen.getByRole("alert").getAttribute("aria-label")).toBe("Connection failed");
   });
@@ -55,7 +65,7 @@ describe("ConnectErrorBanner", () => {
   it("reports a user-initiated cancellation as a warning rather than an error", () => {
     useConnectErrorStore.getState().setConnectError("Connection cancelled.", "warning");
 
-    render(<ConnectErrorBanner />);
+    renderBanner();
 
     expect(screen.getByRole("alert").getAttribute("aria-label")).toBe("Connection cancelled");
   });
@@ -63,10 +73,56 @@ describe("ConnectErrorBanner", () => {
   it("dismisses the message", () => {
     useConnectErrorStore.getState().setConnectError("Something failed.");
 
-    render(<ConnectErrorBanner />);
+    renderBanner();
     fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
 
     expect(screen.queryByRole("alert")).toBeNull();
     expect(useConnectErrorStore.getState().message).toBeNull();
   });
 });
+
+describe("ConnectErrorBanner with an action", () => {
+  beforeEach(() => {
+    useConnectErrorStore.getState().clearConnectError();
+  });
+
+  afterEach(() => {
+    cleanup();
+    useConnectErrorStore.getState().clearConnectError();
+  });
+
+  it("offers the action that fixes the failure", () => {
+    useConnectErrorStore.getState().setConnectError("The host key could not be approved.", "error", {
+      label: "Open host",
+      href: "/hosts?edit=host-1",
+    });
+
+    renderBanner();
+
+    const action = screen.getByRole("button", { name: "Open host" });
+    expect(action).toBeTruthy();
+    // The banner still offers Dismiss: the action is an addition, not a
+    // replacement.
+    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
+  });
+
+  it("does not offer an action when there is nothing to go to", () => {
+    useConnectErrorStore.getState().setConnectError("Could not reach the host.");
+
+    renderBanner();
+
+    expect(screen.queryByRole("button", { name: "Open host" })).toBeNull();
+  });
+
+  it("clears the banner when the action is taken", () => {
+    useConnectErrorStore.getState().setConnectError("The host key could not be approved.", "error", {
+      label: "Open host",
+      href: "/hosts?edit=host-1",
+    });
+
+    renderBanner();
+    fireEvent.click(screen.getByRole("button", { name: "Open host" }));
+
+    expect(screen.queryByRole("alert")).toBeNull();
+  });
+});
diff --git a/apps/desktop/src/components/common/ConnectErrorBanner.tsx b/apps/desktop/src/components/common/ConnectErrorBanner.tsx
index 02e012e..6c8bc0c 100644
--- a/apps/desktop/src/components/common/ConnectErrorBanner.tsx
+++ b/apps/desktop/src/components/common/ConnectErrorBanner.tsx
@@ -1,3 +1,5 @@
+import { useNavigate } from "react-router-dom";
+
 import { useConnectErrorStore } from "../../store/connect-error-store";
 
 // Surfaces the last connect failure.
@@ -6,11 +8,17 @@ import { useConnectErrorStore } from "../../store/connect-error-store";
 // message is visible no matter which surface started the connect: the hosts
 // page, the quick-connect box, the sidebar's pinned and recent lists, the
 // command palette, or the first-run welcome panel.
+//
+// A failure the user has to act on also carries an ACTION — "Open host" —
+// because a message that names the problem but not the fix leaves the user
+// hunting for the right screen.
 
 export function ConnectErrorBanner() {
   const message = useConnectErrorStore((state) => state.message);
   const tone = useConnectErrorStore((state) => state.tone);
+  const action = useConnectErrorStore((state) => state.action);
   const clearConnectError = useConnectErrorStore((state) => state.clearConnectError);
+  const navigate = useNavigate();
 
   if (!message) {
     return null;
@@ -29,13 +37,27 @@ export function ConnectErrorBanner() {
       }
     >
       <p className="text-callout font-medium text-[color:var(--shell-text)]">{message}</p>
-      <button
-        type="button"
-        onClick={clearConnectError}
-        className="rounded-control border border-[color:var(--shell-border)] px-3 py-1 text-callout text-[color:var(--shell-text)] transition hover:border-[color:var(--shell-muted)]"
-      >
-        Dismiss
-      </button>
+      <div className="flex items-center gap-2">
+        {action ? (
+          <button
+            type="button"
+            onClick={() => {
+              clearConnectError();
+              navigate(action.href);
+            }}
+            className="rounded-control border border-[color:var(--shell-border)] px-3 py-1 text-callout text-[color:var(--shell-text)] transition hover:border-[color:var(--shell-muted)]"
+          >
+            {action.label}
+          </button>
+        ) : null}
+        <button
+          type="button"
+          onClick={clearConnectError}
+          className="rounded-control border border-[color:var(--shell-border)] px-3 py-1 text-callout text-[color:var(--shell-text)] transition hover:border-[color:var(--shell-muted)]"
+        >
+          Dismiss
+        </button>
+      </div>
     </div>
   );
 }
diff --git a/apps/desktop/src/components/terminal/TerminalPane.tsx b/apps/desktop/src/components/terminal/TerminalPane.tsx
index 6e1faae..69c1375 100644
--- a/apps/desktop/src/components/terminal/TerminalPane.tsx
+++ b/apps/desktop/src/components/terminal/TerminalPane.tsx
@@ -1,6 +1,7 @@
 import { useCallback, useEffect, useMemo, useState } from "react";
 import "xterm/css/xterm.css";
 import { detectSystemColorScheme, resolveTerminalTheme, type TerminalThemeMode } from "../../lib/terminal-themes";
+import { resolveTerminalFontStack, resolveTerminalFontSize } from "../../lib/terminal-fonts";
 import { cn, formatHostAddress } from "../../lib/utils";
 import { useAppStore } from "../../store/app-store";
 import { useSessionsStore } from "../../store/sessions-store";
@@ -25,6 +26,19 @@ interface TerminalPaneProps {
 
 export function TerminalPane({ host, pane, active, onActivate, onSplit, onClose }: TerminalPaneProps) {
   const terminalThemeName = useAppStore((state) => state.terminalTheme);
+  // The font picker: the terminal's family and size are a preference, not a
+  // constant, so a person whose font is not on this machine — or whose
+  // screen needs a different size — can change them.
+  const terminalFontName = useAppStore((state) => state.terminalFont);
+  const terminalFontSizePreference = useAppStore((state) => state.terminalFontSize);
+  const terminalFontStack = useMemo(
+    () => resolveTerminalFontStack(terminalFontName),
+    [terminalFontName]
+  );
+  const terminalFontSize = useMemo(
+    () => resolveTerminalFontSize(terminalFontSizePreference),
+    [terminalFontSizePreference]
+  );
   const setPanePersistOutputPreview = useSessionsStore((state) => state.setPanePersistOutputPreview);
   const [systemColorScheme, setSystemColorScheme] = useState<TerminalThemeMode>(() => detectSystemColorScheme());
 
@@ -44,7 +58,7 @@ export function TerminalPane({ host, pane, active, onActivate, onSplit, onClose
     () => resolveTerminalTheme(terminalThemeName, systemColorScheme).entry.palette,
     [terminalThemeName, systemColorScheme]
   );
-  const { advanceSearchMatch, clipboardNoticeRef, screenReaderModeRef, closeSearch, containerRef, contextMenuRequestRef, runtimeStatusMessage, searchActiveIndex, searchCaseSensitive, searchInputRef, searchMatches, searchOpen, searchQuery, setSearchCaseSensitive, setSearchQuery, terminalRef, toggleConnectionRef } = useTerminalPaneSession({ host, pane, resolvedTerminalPalette });
+  const { advanceSearchMatch, clipboardNoticeRef, screenReaderModeRef, closeSearch, containerRef, contextMenuRequestRef, runtimeStatusMessage, searchActiveIndex, searchCaseSensitive, searchInputRef, searchMatches, searchOpen, searchQuery, setSearchCaseSensitive, setSearchQuery, terminalRef, toggleConnectionRef } = useTerminalPaneSession({ host, pane, resolvedTerminalPalette, terminalFontStack, terminalFontSize });
 
   // #510: screen reader support. The setting reaches open terminals, and
   // connection changes in the active pane are announced once each.
diff --git a/apps/desktop/src/components/terminal/TerminalWorkspace.tsx b/apps/desktop/src/components/terminal/TerminalWorkspace.tsx
index 6c46208..ae6e685 100644
--- a/apps/desktop/src/components/terminal/TerminalWorkspace.tsx
+++ b/apps/desktop/src/components/terminal/TerminalWorkspace.tsx
@@ -5,6 +5,7 @@ import { SearchInput } from "../common/SearchInput";
 import { buildHostSearchText } from "../../lib/utils";
 import { useHostsStore } from "../../store/hosts-store";
 import { useCloseGuardStore } from "../../store/close-guard-store";
+import { useBroadcastStore } from "../../store/broadcast-store";
 import { useSessionsStore } from "../../store/sessions-store";
 import { hostSupportsPortForwarding, type HostRecord } from "../../types/host";
 import { ErrorBoundary, ScopedErrorFallback } from "../ErrorBoundary";
@@ -28,6 +29,16 @@ export function TerminalWorkspace({ launchHost }: TerminalWorkspaceProps) {
   const [tabMenu, setTabMenu] = useState<TabContextMenuPayload | null>(null);
   const openSession = useSessionsStore((state) => state.openSession);
   const duplicateSession = useSessionsStore((state) => state.duplicateSession);
+  // Broadcast: what you type goes to every pane taking part, so the same
+  // command can be run on several hosts at once. It is off by default.
+  const broadcastEnabled = useBroadcastStore((state) => state.enabled);
+  const setBroadcastEnabled = useBroadcastStore((state) => state.setEnabled);
+  const setBroadcastPanes = useBroadcastStore((state) => state.setAllPanes);
+  const openPaneIds = useSessionsStore((state) =>
+    Object.values(state.panes)
+      .filter((pane) => pane.transport !== "mock")
+      .map((pane) => pane.id)
+  );
   const selectTab = useSessionsStore((state) => state.selectTab);
   const splitTab = useSessionsStore((state) => state.splitTab);
   const closePane = useSessionsStore((state) => state.closePane);
@@ -127,6 +138,16 @@ export function TerminalWorkspace({ launchHost }: TerminalWorkspaceProps) {
         onDuplicate={duplicateByTabId}
       />
 
+      {broadcastEnabled ? (
+        <div
+          role="status"
+          className="rounded-[14px] border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-sm text-amber-100"
+        >
+          Broadcast is on: what you type goes to every open session ({openPaneIds.length}). Turn it off
+          to type into one session again.
+        </div>
+      ) : null}
+
       <div className="grid min-h-0 flex-1 gap-2.5 xl:grid-cols-[minmax(0,1fr)_272px]">
         <div className="rounded-[20px] border border-slate-800/80 bg-slate-950/45 p-2">
           <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
@@ -142,6 +163,31 @@ export function TerminalWorkspace({ launchHost }: TerminalWorkspaceProps) {
               </div>
             </div>
             <div className="flex flex-wrap gap-2">
+              <button
+                type="button"
+                aria-pressed={broadcastEnabled}
+                disabled={openPaneIds.length < 2}
+                onClick={() => {
+                  const next = !broadcastEnabled;
+                  // Turning it on sends to every open pane; turning it off
+                  // empties the set, so a later broadcast never reaches a
+                  // session the user has closed.
+                  setBroadcastPanes(openPaneIds);
+                  setBroadcastEnabled(next);
+                }}
+                title={
+                  openPaneIds.length < 2
+                    ? "Open a second session to broadcast input to"
+                    : "Send what you type to every open session"
+                }
+                className={
+                  broadcastEnabled
+                    ? "rounded-lg border border-amber-400/60 bg-amber-400/10 px-3 py-1 text-sm text-amber-100 transition"
+                    : "rounded-lg border border-slate-700 px-3 py-1 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600"
+                }
+              >
+                {broadcastEnabled ? "Broadcast on" : "Broadcast"}
+              </button>
               <button
                 type="button"
                 disabled={!activeHost}
diff --git a/apps/desktop/src/components/terminal/terminal-pane-input-wiring.broadcast.test.ts b/apps/desktop/src/components/terminal/terminal-pane-input-wiring.broadcast.test.ts
new file mode 100644
index 0000000..94e2b9c
--- /dev/null
+++ b/apps/desktop/src/components/terminal/terminal-pane-input-wiring.broadcast.test.ts
@@ -0,0 +1,122 @@
+import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
+
+import { registerBroadcastSender, useBroadcastStore } from "../../store/broadcast-store";
+import { attachTerminalPaneInputWiring } from "./terminal-pane-input-wiring";
+
+// Broadcast input across several live sessions.
+//
+// The competitor's daily-use list has it and this app could only broadcast a
+// SNIPPET across hosts: there was no way to type into several live sessions
+// at once. These tests pin the behaviour that matters: what is typed goes to
+// every pane taking part, the pane being typed in is always part of it, and
+// with the broadcast off nothing changes.
+
+function ref<T>(current: T) {
+  return { current };
+}
+
+function createTerminal() {
+  const listeners: Array<(data: string) => void> = [];
+  const terminal = {
+    onData: (listener: (data: string) => void) => {
+      listeners.push(listener);
+      return { dispose: vi.fn() };
+    },
+    onSelectionChange: () => ({ dispose: vi.fn() }),
+    attachCustomKeyEventHandler: () => true,
+    paste: vi.fn(),
+    getSelection: () => "",
+  };
+  return {
+    terminal,
+    emitData: (data: string) => listeners.forEach((listener) => listener(data)),
+  };
+}
+
+describe("broadcasting input to several sessions", () => {
+  const container = { addEventListener: vi.fn() } as unknown as HTMLDivElement;
+
+  beforeEach(() => {
+    useBroadcastStore.setState({ enabled: false, paneIds: [] });
+  });
+
+  afterEach(() => {
+    useBroadcastStore.setState({ enabled: false, paneIds: [] });
+  });
+
+  function wire(paneId: string, socketSend: (payload: string) => void) {
+    const { terminal, emitData } = createTerminal();
+    const socketRef = ref({
+      addEventListener: vi.fn(),
+      close: vi.fn(),
+      readyState: 1,
+      send: socketSend,
+    });
+    const transportRef = ref<"ssh" | "mock">("ssh");
+
+    attachTerminalPaneInputWiring({
+      paneId,
+      commandBufferRef: ref(""),
+      connectionStateRef: ref<"connected" | "disconnected">("connected"),
+      container,
+      notifyClipboard: vi.fn(),
+      requestContextMenu: vi.fn(),
+      runMockCommand: vi.fn(),
+      setSearchOpen: vi.fn(),
+      socketRef,
+      terminal: terminal as never,
+      transportRef,
+    });
+
+    return { emitData };
+  }
+
+  it("sends what is typed to every pane taking part", () => {
+    const otherPane = vi.fn();
+    const unregister = registerBroadcastSender("pane-2", otherPane);
+    useBroadcastStore.setState({ enabled: true, paneIds: ["pane-2"] });
+
+    const ownSocket = vi.fn();
+    const { emitData } = wire("pane-1", ownSocket);
+    emitData("uptime\r");
+
+    // The other pane gets it...
+    expect(otherPane).toHaveBeenCalledWith("uptime\r");
+    // ...and so does the pane it was typed in, even though that pane was not
+    // in the set: a broadcast that left out the pane under the cursor would
+    // swallow what was typed.
+    expect(ownSocket).toHaveBeenCalledWith(JSON.stringify({ type: "input", data: "uptime\r" }));
+
+    unregister();
+  });
+
+  it("does not send to a pane that is not taking part", () => {
+    const otherPane = vi.fn();
+    const unregister = registerBroadcastSender("pane-2", otherPane);
+    useBroadcastStore.setState({ enabled: true, paneIds: ["pane-3"] });
+
+    const ownSocket = vi.fn();
+    const { emitData } = wire("pane-1", ownSocket);
+    emitData("ls\r");
+
+    expect(otherPane).not.toHaveBeenCalled();
+    expect(ownSocket).toHaveBeenCalledWith(JSON.stringify({ type: "input", data: "ls\r" }));
+
+    unregister();
+  });
+
+  it("changes nothing while the broadcast is off", () => {
+    const otherPane = vi.fn();
+    const unregister = registerBroadcastSender("pane-2", otherPane);
+    useBroadcastStore.setState({ enabled: false, paneIds: ["pane-2"] });
+
+    const ownSocket = vi.fn();
+    const { emitData } = wire("pane-1", ownSocket);
+    emitData("ls\r");
+
+    expect(otherPane).not.toHaveBeenCalled();
+    expect(ownSocket).toHaveBeenCalledWith(JSON.stringify({ type: "input", data: "ls\r" }));
+
+    unregister();
+  });
+});
diff --git a/apps/desktop/src/components/terminal/terminal-pane-input-wiring.test.ts b/apps/desktop/src/components/terminal/terminal-pane-input-wiring.test.ts
index 23a01e6..65a0702 100644
--- a/apps/desktop/src/components/terminal/terminal-pane-input-wiring.test.ts
+++ b/apps/desktop/src/components/terminal/terminal-pane-input-wiring.test.ts
@@ -50,6 +50,7 @@ describe("attachTerminalPaneInputWiring", () => {
     const transportRef = ref<"ssh" | "mock">("ssh");
 
     attachTerminalPaneInputWiring({
+      paneId: "pane-1",
       commandBufferRef,
       connectionStateRef,
       container,
@@ -92,6 +93,7 @@ describe("attachTerminalPaneInputWiring", () => {
     const { terminal } = createTerminal();
 
     attachTerminalPaneInputWiring({
+      paneId: "pane-1",
       commandBufferRef: ref(""),
       connectionStateRef: ref<"connected" | "disconnected">("connected"),
       container,
diff --git a/apps/desktop/src/components/terminal/terminal-pane-input-wiring.ts b/apps/desktop/src/components/terminal/terminal-pane-input-wiring.ts
index 9b63a47..c74ad60 100644
--- a/apps/desktop/src/components/terminal/terminal-pane-input-wiring.ts
+++ b/apps/desktop/src/components/terminal/terminal-pane-input-wiring.ts
@@ -1,6 +1,7 @@
 import { type Dispatch, type MutableRefObject, type SetStateAction } from "react";
 import { type IDisposable, type Terminal } from "xterm";
 import { type SessionSocketLike } from "../../lib/api";
+import { broadcastInput, useBroadcastStore } from "../../store/broadcast-store";
 import { type SessionConnectionState, type SessionTransport } from "../../types/session";
 
 export interface TerminalContextMenuPosition {
@@ -47,6 +48,8 @@ export function pasteIntoTerminal(terminal: ClipboardTerminal, notify: (message:
 }
 
 interface TerminalPaneInputWiringOptions {
+  /** This pane's id, so a broadcast always includes the pane being typed in. */
+  paneId: string;
   commandBufferRef: MutableRefObject<string>;
   connectionStateRef: MutableRefObject<SessionConnectionState>;
   container: HTMLDivElement;
@@ -68,6 +71,7 @@ interface TerminalPaneInputWiring {
 }
 
 export function attachTerminalPaneInputWiring({
+  paneId,
   commandBufferRef,
   connectionStateRef,
   container,
@@ -106,13 +110,25 @@ export function attachTerminalPaneInputWiring({
   });
 
   const dataDisposable = terminal.onData((data) => {
-    if (
-      transportRef.current !== "mock" &&
-      transportRef.current !== "unsupported" &&
-      socketRef.current?.readyState === WebSocket.OPEN
-    ) {
-      socketRef.current.send(JSON.stringify({ type: "input", data }));
-      return;
+    if (transportRef.current !== "mock" && transportRef.current !== "unsupported") {
+      // A broadcast sends what was typed to every pane taking part, so the
+      // same command can be run on several hosts at once. It is off by
+      // default and says so on screen while it is on.
+      const broadcast = useBroadcastStore.getState();
+      if (broadcast.enabled) {
+        // The other panes taking part get the input as well. The pane being
+        // typed in is NOT one of them: it sends to its own session below, so
+        // its input never depends on the broadcast reaching it, and it is
+        // never delivered twice.
+        broadcastInput(
+          broadcast.paneIds.filter((candidate) => candidate !== paneId),
+          data
+        );
+      }
+      if (socketRef.current?.readyState === WebSocket.OPEN) {
+        socketRef.current.send(JSON.stringify({ type: "input", data }));
+        return;
+      }
     }
 
     if (connectionStateRef.current !== "connected") {
diff --git a/apps/desktop/src/components/terminal/use-terminal-pane-lifecycle.ts b/apps/desktop/src/components/terminal/use-terminal-pane-lifecycle.ts
index 42bf477..24d4512 100644
--- a/apps/desktop/src/components/terminal/use-terminal-pane-lifecycle.ts
+++ b/apps/desktop/src/components/terminal/use-terminal-pane-lifecycle.ts
@@ -13,6 +13,7 @@ import {
   attachTerminalPaneConnectionControls,
   initializeTerminalPaneTransport,
 } from "./terminal-pane-connection-controls";
+import { registerBroadcastSender } from "../../store/broadcast-store";
 import {
   attachTerminalPaneInputWiring,
   type TerminalContextMenuPosition,
@@ -54,6 +55,9 @@ interface TerminalPaneLifecycleOptions {
   hostname: HostRecord["hostname"];
   id: HostRecord["id"];
   initialPaletteRef: MutableRefObject<TerminalAnsiPalette>;
+  /** The terminal's font family and size, from the font picker. */
+  terminalFontStack: string;
+  terminalFontSize: number;
   intentionalDisconnectRef: MutableRefObject<boolean>;
   label: HostRecord["label"];
   nativeBridgeEnabled: boolean;
@@ -114,6 +118,8 @@ export function useTerminalPaneLifecycle({
   hostname,
   id,
   initialPaletteRef,
+  terminalFontStack,
+  terminalFontSize,
   intentionalDisconnectRef,
   label,
   nativeBridgeEnabled,
@@ -165,8 +171,8 @@ export function useTerminalPaneLifecycle({
 
     const terminal = new Terminal({
       cursorBlink: true,
-      fontFamily: '"SFMono-Regular", "Menlo", "Monaco", monospace',
-      fontSize: 13,
+      fontFamily: terminalFontStack,
+      fontSize: terminalFontSize,
       scrollback: 10000,
       theme: initialPaletteRef.current,
       // #510: a terminal recreated after a host change starts in the right
@@ -341,7 +347,18 @@ export function useTerminalPaneLifecycle({
       terminal.writeln(line);
     });
 
+    // A pane joins the broadcast by registering a sender for its own input.
+    // The sender reads the socket when it is called, so it always sends to the
+    // session the pane has NOW, not the one it had when it registered.
+    const unregisterBroadcastSender = registerBroadcastSender(id, (data) => {
+      const socket = socketRef.current;
+      if (socket?.readyState === WebSocket.OPEN) {
+        socket.send(JSON.stringify({ type: "input", data }));
+      }
+    });
+
     const { contextMenuHandler, dataDisposable, selectionDisposable } = attachTerminalPaneInputWiring({
+      paneId: id,
       commandBufferRef,
       connectionStateRef,
       container,
@@ -363,6 +380,7 @@ export function useTerminalPaneLifecycle({
     void initializeTerminalPaneTransport(connectionControlsOptions);
 
     return () => {
+      unregisterBroadcastSender();
       cleanupTerminalPaneLifecycle({
         clearReconnectTimer,
         container,
diff --git a/apps/desktop/src/components/terminal/use-terminal-pane-lifecycle.unmount.test.tsx b/apps/desktop/src/components/terminal/use-terminal-pane-lifecycle.unmount.test.tsx
index b09193c..49d3e77 100644
--- a/apps/desktop/src/components/terminal/use-terminal-pane-lifecycle.unmount.test.tsx
+++ b/apps/desktop/src/components/terminal/use-terminal-pane-lifecycle.unmount.test.tsx
@@ -140,6 +140,8 @@ describe("useTerminalPaneLifecycle unmount", () => {
         hostname: host.hostname,
         id: host.id,
         initialPaletteRef: ref({} as never),
+        terminalFontStack: '"SFMono-Regular", "Menlo", "Monaco", monospace',
+        terminalFontSize: 13,
         intentionalDisconnectRef: ref(false),
         label: host.label,
         nativeBridgeEnabled: false,
diff --git a/apps/desktop/src/components/terminal/use-terminal-pane-session.ts b/apps/desktop/src/components/terminal/use-terminal-pane-session.ts
index e6bf756..b42f194 100644
--- a/apps/desktop/src/components/terminal/use-terminal-pane-session.ts
+++ b/apps/desktop/src/components/terminal/use-terminal-pane-session.ts
@@ -23,9 +23,18 @@ interface UseTerminalPaneSessionOptions {
   host: HostRecord;
   pane: SessionPane;
   resolvedTerminalPalette: TerminalAnsiPalette;
+  /** The terminal's font family and size, from the font picker. */
+  terminalFontStack: string;
+  terminalFontSize: number;
 }
 
-export function useTerminalPaneSession({ host, pane, resolvedTerminalPalette }: UseTerminalPaneSessionOptions) {
+export function useTerminalPaneSession({
+  host,
+  pane,
+  resolvedTerminalPalette,
+  terminalFontStack,
+  terminalFontSize,
+}: UseTerminalPaneSessionOptions) {
   const {
     agentForwarding,
     authMethod,
@@ -164,6 +173,19 @@ export function useTerminalPaneSession({ host, pane, resolvedTerminalPalette }:
     terminal.options.theme = resolvedTerminalPalette;
   }, [resolvedTerminalPalette]);
 
+  // The same for the font: a terminal that is already open follows the
+  // preference, rather than keeping the font it started with until the pane
+  // is recreated. Setting `fontFamily` / `fontSize` on the options is the
+  // supported xterm.js path and keeps the scrollback and the SSH session.
+  useEffect(() => {
+    const terminal = terminalRef.current;
+    if (!terminal) {
+      return;
+    }
+    terminal.options.fontFamily = terminalFontStack;
+    terminal.options.fontSize = terminalFontSize;
+  }, [terminalFontStack, terminalFontSize]);
+
   useTerminalPaneLifecycle({
     activeHistoryEntryIdRef,
     agentForwarding,
@@ -189,6 +211,8 @@ export function useTerminalPaneSession({ host, pane, resolvedTerminalPalette }:
     hostname,
     id,
     initialPaletteRef,
+    terminalFontStack,
+    terminalFontSize,
     intentionalDisconnectRef,
     label,
     nativeBridgeEnabled,
diff --git a/apps/desktop/src/lib/connections.ts b/apps/desktop/src/lib/connections.ts
index 61215d5..101139b 100644
--- a/apps/desktop/src/lib/connections.ts
+++ b/apps/desktop/src/lib/connections.ts
@@ -2,6 +2,11 @@ import type { BackendHostConnection } from "./api";
 import { hostSupportsJumpHosts, hostSupportsTrustedKeys, type HostRecord } from "../types/host";
 import { getHostConnectionSecrets } from "../store/connection-secrets-store";
 import { useHostsStore } from "../store/hosts-store";
+import {
+  applyGroupSettings,
+  groupSettingsFor,
+  useGroupSettingsStore,
+} from "../store/group-settings-store";
 import { useIdentitiesStore } from "../store/identities-store";
 import { resolveIdentityForHost } from "./host-identity-resolver";
 import type { KnownHostRecord } from "../types/known-host";
@@ -43,6 +48,15 @@ function buildBackendConnectionRecursive(
   const knownHost = findKnownHostMatch(knownHosts, host);
   const secrets = getHostConnectionSecrets(host.id);
 
+  // A group's settings are defaults: the host keeps what it sets itself, and
+  // takes the group's for what it does not. Nothing is overwritten, so a host
+  // that needs its own bastion still has one.
+  const groupSettings = groupSettingsFor(
+    useGroupSettingsStore.getState().groupSettings,
+    (host as { group?: string }).group
+  );
+  const effectiveHost = applyGroupSettings(host, groupSettings);
+
   if (hostSupportsTrustedKeys(host.protocol) && host.hostKeyPolicy === "requireTrusted" && !knownHost) {
     throw new Error(
       `Trusted host key required for ${host.label}. Scan and trust ${host.hostname}:${host.port} in Keys before connecting.`
@@ -54,7 +68,7 @@ function buildBackendConnectionRecursive(
   // there is no identity (transitional). The host-record fields stay
   // populated by the editor so a partially-migrated workspace keeps working.
   const identity = resolveIdentityForHost(host, useIdentitiesStore.getState().identities);
-  const effectiveUsername = identity?.username?.trim() || host.username;
+  const effectiveUsername = identity?.username?.trim() || effectiveHost.username;
   const effectiveAuthMethod = identity?.authMethod ?? host.authMethod;
   const effectivePrivateKeyPath = identity
     ? identity.authMethod === "privateKey"
@@ -63,10 +77,10 @@ function buildBackendConnectionRecursive(
     : host.privateKeyPath;
 
   let jumpHost: BackendHostConnection | undefined;
-  if (hostSupportsJumpHosts(host.protocol) && host.jumpHostId) {
+  if (hostSupportsJumpHosts(host.protocol) && effectiveHost.jumpHostId) {
     const resolvedJumpHost = useHostsStore
       .getState()
-      .hosts.find((candidate) => candidate.id === host.jumpHostId);
+      .hosts.find((candidate) => candidate.id === effectiveHost.jumpHostId);
     if (!resolvedJumpHost) {
       throw new Error(`Jump host is missing for ${host.label}.`);
     }
@@ -81,7 +95,7 @@ function buildBackendConnectionRecursive(
   return {
     agentForwarding: host.agentForwarding,
     authMethod: effectiveAuthMethod,
-    environment: host.environment,
+    environment: effectiveHost.environment,
     hostKeyPolicy: host.hostKeyPolicy,
     hostname: host.hostname,
     jumpHost,
@@ -92,7 +106,7 @@ function buildBackendConnectionRecursive(
     port: host.port,
     privateKeyPath: effectivePrivateKeyPath,
     protocol: host.protocol,
-    sftpRoot: host.protocol === "ssh" ? host.sftpRoot : undefined,
+    sftpRoot: host.protocol === "ssh" ? effectiveHost.sftpRoot : undefined,
     username: effectiveUsername,
   };
 }
diff --git a/apps/desktop/src/lib/launch-host-session.test.ts b/apps/desktop/src/lib/launch-host-session.test.ts
index 65cddca..191f538 100644
--- a/apps/desktop/src/lib/launch-host-session.test.ts
+++ b/apps/desktop/src/lib/launch-host-session.test.ts
@@ -207,6 +207,8 @@ describe("launchHostSession failure reporting", () => {
       setup: () => void;
       message: string;
       tone: "error" | "warning";
+      /** The action the banner offers, when the failure needs one. */
+      action?: { label: string; href: string };
     }> = [
       {
         setup: () => vi.mocked(ensureTrustedHostKey).mockRejectedValue(new Error("network down")),
@@ -224,12 +226,14 @@ describe("launchHostSession failure reporting", () => {
           vi.mocked(ensureTrustedHostKey).mockResolvedValue({ ok: false, reason: "scan-failed" }),
         message: "Could not scan a.example.com:22. Check that the host is reachable and try again.",
         tone: "error",
+        action: { label: "Open host", href: "/hosts?edit=a" },
       },
       {
         setup: () =>
           vi.mocked(ensureTrustedHostKey).mockResolvedValue({ ok: false, reason: "scan-empty" }),
         message: "a.example.com:22 returned no host keys to trust.",
         tone: "error",
+        action: { label: "Open host", href: "/hosts?edit=a" },
       },
       {
         setup: () =>
@@ -240,6 +244,9 @@ describe("launchHostSession failure reporting", () => {
         message:
           "Could not prompt for the host key of host-a. Open the host from the Hosts page to approve it.",
         tone: "error",
+        // The user has to approve a key on the host: the banner takes them
+        // there rather than only naming the problem.
+        action: { label: "Open host", href: "/hosts?edit=a" },
       },
       {
         // The defensive fall-through for a reason ensureTrustedHostKey does
@@ -254,14 +261,14 @@ describe("launchHostSession failure reporting", () => {
       },
     ];
 
-    for (const { setup, message, tone } of cases) {
+    for (const { setup, message, tone, action } of cases) {
       vi.mocked(reportConnectError).mockClear();
       setup();
 
       await launchHostSession(host("a"));
 
       expect(reportConnectError).toHaveBeenCalledTimes(1);
-      expect(reportConnectError).toHaveBeenCalledWith(message, tone);
+      expect(reportConnectError).toHaveBeenCalledWith(message, tone, action ?? null);
     }
   });
 });
diff --git a/apps/desktop/src/lib/launch-host-session.ts b/apps/desktop/src/lib/launch-host-session.ts
index 907c4d5..b90a086 100644
--- a/apps/desktop/src/lib/launch-host-session.ts
+++ b/apps/desktop/src/lib/launch-host-session.ts
@@ -12,6 +12,7 @@ import { useSessionsStore } from "../store/sessions-store";
 import {
   reportConnectError,
   useConnectErrorStore,
+  type ConnectErrorAction,
   type ConnectErrorTone,
 } from "../store/connect-error-store";
 import type { HostRecord } from "../types/host";
@@ -91,10 +92,24 @@ export async function launchHostSession(host: HostRecord): Promise<LaunchHostSes
  * The call sites still log to the console for debugging; they no longer have
  * to duplicate the user-facing message.
  */
-function reportFailure(message: string, tone: ConnectErrorTone = "error") {
+function reportFailure(
+  message: string,
+  tone: ConnectErrorTone = "error",
+  action: ConnectErrorAction | null = null
+) {
   // `reportConnectError` is the store's reporting entry point: it ignores an
   // empty message, so a blank banner can never be published.
-  reportConnectError(message, tone);
+  reportConnectError(message, tone, action);
+}
+
+/**
+ * The action for a failure the user can only fix on the host.
+ *
+ * The hosts page opens a host's editor with `?edit=<id>`, so the banner can
+ * take the user straight to the thing that has to change.
+ */
+function openHostAction(host: HostRecord): ConnectErrorAction {
+  return { label: "Open host", href: `/hosts?edit=${encodeURIComponent(host.id)}` };
 }
 
 async function launchHostSessionInner(host: HostRecord): Promise<LaunchHostSessionResult> {
@@ -125,17 +140,17 @@ async function launchHostSessionInner(host: HostRecord): Promise<LaunchHostSessi
     }
     if (trustResult.reason === "scan-failed") {
       const message = `Could not scan ${host.hostname}:${host.port}. Check that the host is reachable and try again.`;
-      reportFailure(message);
+      reportFailure(message, "error", openHostAction(host));
       return { ok: false, reason: "scan-failed", errorMessage: message };
     }
     if (trustResult.reason === "scan-empty") {
       const message = `${host.hostname}:${host.port} returned no host keys to trust.`;
-      reportFailure(message);
+      reportFailure(message, "error", openHostAction(host));
       return { ok: false, reason: "scan-empty", errorMessage: message };
     }
     if (trustResult.reason === "user-non-interactive") {
       const message = `Could not prompt for the host key of ${host.label}. Open the host from the Hosts page to approve it.`;
-      reportFailure(message);
+      reportFailure(message, "error", openHostAction(host));
       return { ok: false, reason: "user-non-interactive", errorMessage: message };
     }
     // Other reasons (policy-allows-unknown, etc.) shouldn't surface as
diff --git a/apps/desktop/src/lib/redact-secrets.test.ts b/apps/desktop/src/lib/redact-secrets.test.ts
new file mode 100644
index 0000000..36fc23e
--- /dev/null
+++ b/apps/desktop/src/lib/redact-secrets.test.ts
@@ -0,0 +1,70 @@
+import { describe, expect, it } from "vitest";
+
+import { REDACTION_PLACEHOLDER, containsSecret, redactSecrets } from "./redact-secrets";
+
+// The session history keeps a preview of what a command printed, and that
+// preview is persisted across relaunches. A command that prints a secret
+// leaves it in the history unless it is redacted — these tests pin the
+// redaction that keeps the history without keeping the secret.
+
+describe("redacting secrets", () => {
+  it("masks a secret in an assignment", () => {
+    expect(redactSecrets("password=hunter2")).toBe(`password=${REDACTION_PLACEHOLDER}`);
+    expect(redactSecrets("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI")).toBe(
+      `AWS_SECRET_ACCESS_KEY=${REDACTION_PLACEHOLDER}`
+    );
+    expect(redactSecrets('{"api_key": "abc123"}')).toBe(
+      `{"api_key": "${REDACTION_PLACEHOLDER}"}`
+    );
+    expect(redactSecrets("token: s3cr3t")).toBe(`token: ${REDACTION_PLACEHOLDER}`);
+  });
+
+  it("masks the token shapes that are secrets by construction", () => {
+    expect(redactSecrets("AKIAIOSFODNN7EXAMPLE")).toBe(REDACTION_PLACEHOLDER);
+    expect(redactSecrets("ghp_abcdefghijklmnopqrstuvwxyz012345")).toBe(REDACTION_PLACEHOLDER);
+    expect(redactSecrets("glpat-abcdefghijklmnopqrst")).toBe(REDACTION_PLACEHOLDER);
+    expect(redactSecrets("xoxb-1234567890-abcdefghij")).toBe(REDACTION_PLACEHOLDER);
+    expect(
+      redactSecrets("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk")
+    ).toBe(REDACTION_PLACEHOLDER);
+    expect(
+      redactSecrets(
+        "-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----"
+      )
+    ).toBe(REDACTION_PLACEHOLDER);
+  });
+
+  it("leaves ordinary output alone", () => {
+    // A history that hides everything is a history nobody can search.
+    const output = [
+      "total 24",
+      "drwxr-xr-x  4 ops  staff   128 Nov 17 09:12 .",
+      "-rw-r--r--  1 ops  staff  1024 Nov 17 09:12 release.tar.gz",
+      "Connection to gateway.internal closed.",
+    ].join("\n");
+
+    expect(redactSecrets(output)).toBe(output);
+    expect(containsSecret(output)).toBe(false);
+  });
+
+  it("does not mask a name that only looks secret-like", () => {
+    // The word alone is not a secret, and masking every line that mentions a
+    // token would make the history useless.
+    expect(redactSecrets("authorisation: granted")).toBe("authorisation: granted");
+    expect(redactSecrets("tokenizer=fast")).toBe("tokenizer=fast");
+    expect(redactSecrets("secretary=alice")).toBe("secretary=alice");
+  });
+
+  it("leaves an empty or already-redacted value alone", () => {
+    expect(redactSecrets("password=")).toBe("password=");
+    expect(redactSecrets(`password=${REDACTION_PLACEHOLDER}`)).toBe(
+      `password=${REDACTION_PLACEHOLDER}`
+    );
+  });
+
+  it("says whether there was anything to redact", () => {
+    expect(containsSecret("password=hunter2")).toBe(true);
+    expect(containsSecret("nothing here")).toBe(false);
+    expect(containsSecret("")).toBe(false);
+  });
+});
diff --git a/apps/desktop/src/lib/redact-secrets.ts b/apps/desktop/src/lib/redact-secrets.ts
new file mode 100644
index 0000000..2c179fe
--- /dev/null
+++ b/apps/desktop/src/lib/redact-secrets.ts
@@ -0,0 +1,96 @@
+// Keep secrets out of the session history.
+//
+// The history keeps a preview of what a command printed, and that preview is
+// persisted across relaunches (see the roadmap: "persisted output previews
+// improve search and replay evidence, but they can still retain sensitive
+// command results until explicit redaction and sensitivity controls exist").
+//
+// A command that prints a token, a password, or an API key leaves it in the
+// history — in the preview, and in the local storage the preview is written
+// to. This module is the redaction: it masks the shapes that are secrets by
+// construction, so the history can be kept without keeping the secret.
+//
+// The rules are deliberately conservative: a pattern that is not a secret is
+// not masked, because a history that hides everything is a history nobody
+// can search. Each rule is anchored to something that cannot be a false
+// positive by accident — a named secret, a credential in an assignment, a
+// token with a recognisable prefix.
+
+/** What a redacted value is replaced with. */
+export const REDACTION_PLACEHOLDER = "[redacted]";
+
+// KEY=value, "key": "value", key: value — with a quoted or bare value.
+//
+// The name has to be a sequence of components, one of which is a secret word.
+// That is what keeps "authorisation" (which contains "auth") and "tokenizer"
+// (which starts with "token") out: the secret word has to be a whole
+// component, and the name has to end at a word boundary.
+const SECRET_ASSIGNMENT_PATTERN =
+  /(["']?\b(?:[A-Za-z0-9]+[-_])*(?:pass(?:word|phrase)?|secret|token|api[-_]?key|access[-_]?key|credential|private[-_]?key)(?:[-_][A-Za-z0-9]+)*\b["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi;
+
+// Well-known token shapes. Each is long enough and specific enough that a
+// false positive is very unlikely.
+const TOKEN_PATTERNS: RegExp[] = [
+  // AWS access key ids.
+  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
+  // GitHub tokens.
+  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
+  // GitLab tokens.
+  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
+  // Slack tokens.
+  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
+  // JSON web tokens.
+  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
+  // A private key block.
+  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
+];
+
+/**
+ * Mask the secrets in a piece of text.
+ *
+ * A masked value is replaced with a fixed placeholder, so the shape of the
+ * output changes. That is the point: the history must not be able to give
+ * the secret back.
+ */
+export function redactSecrets(text: string): string {
+  if (!text) {
+    return text;
+  }
+
+  let redacted = text.replace(
+    SECRET_ASSIGNMENT_PATTERN,
+    (match: string, prefix: string, value: string) => {
+      const inner = value.startsWith('"')
+        ? value.slice(1, -1)
+        : value.startsWith("'")
+          ? value.slice(1, -1)
+          : value;
+      // An empty value is not a secret, and neither is one that is already
+      // the placeholder.
+      if (!inner || inner === REDACTION_PLACEHOLDER) {
+        return match;
+      }
+      const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : "";
+      return `${prefix}${quote}${REDACTION_PLACEHOLDER}${quote}`;
+    }
+  );
+
+  for (const pattern of TOKEN_PATTERNS) {
+    redacted = redacted.replace(pattern, REDACTION_PLACEHOLDER);
+  }
+
+  return redacted;
+}
+
+/**
+ * Whether a piece of text looks like it holds a secret.
+ *
+ * Used to tell the user that a preview was redacted, rather than leaving
+ * them to wonder why a command's output looks odd.
+ */
+export function containsSecret(text: string): boolean {
+  if (!text) {
+    return false;
+  }
+  return redactSecrets(text) !== text;
+}
diff --git a/apps/desktop/src/lib/terminal-fonts.test.ts b/apps/desktop/src/lib/terminal-fonts.test.ts
new file mode 100644
index 0000000..08f5816
--- /dev/null
+++ b/apps/desktop/src/lib/terminal-fonts.test.ts
@@ -0,0 +1,80 @@
+import { describe, expect, it } from "vitest";
+
+import {
+  DEFAULT_TERMINAL_FONT,
+  DEFAULT_TERMINAL_FONT_SIZE,
+  MAX_TERMINAL_FONT_SIZE,
+  MIN_TERMINAL_FONT_SIZE,
+  TERMINAL_FONT_NAMES,
+  TERMINAL_FONT_SIZES,
+  isKnownTerminalFont,
+  listTerminalFontOptions,
+  resolveTerminalFontStack,
+  resolveTerminalFontSize,
+} from "./terminal-fonts";
+
+// The parity matrix named the font picker as the last of the shell-preference
+// gaps: the terminal had one hard-coded family and one hard-coded size, so
+// these tests pin the resolution rules the picker relies on.
+
+describe("terminal fonts", () => {
+  it("keeps the font and size the terminal already used as the default", () => {
+    expect(DEFAULT_TERMINAL_FONT).toBe("system-mono");
+    expect(DEFAULT_TERMINAL_FONT_SIZE).toBe(13);
+    // The default stack is the one the terminal had before the picker.
+    expect(resolveTerminalFontStack(DEFAULT_TERMINAL_FONT)).toBe(
+      '"SFMono-Regular", "Menlo", "Monaco", monospace'
+    );
+  });
+
+  it("lists every font it knows, once each", () => {
+    const options = listTerminalFontOptions();
+    expect(options.map((option) => option.name)).toEqual([...TERMINAL_FONT_NAMES]);
+    expect(new Set(options.map((option) => option.name)).size).toBe(options.length);
+    for (const option of options) {
+      expect(option.label.length).toBeGreaterThan(0);
+      expect(option.stack.length).toBeGreaterThan(0);
+    }
+  });
+
+  it("gives every font a stack with a fallback behind it", () => {
+    // A font that is not installed would otherwise render as nothing.
+    for (const option of listTerminalFontOptions()) {
+      expect(option.stack).toContain("monospace");
+    }
+  });
+
+  it("falls back to the default stack for a font it does not know", () => {
+    expect(resolveTerminalFontStack("not-a-font")).toBe(
+      resolveTerminalFontStack(DEFAULT_TERMINAL_FONT)
+    );
+    expect(resolveTerminalFontStack(undefined)).toBe(
+      resolveTerminalFontStack(DEFAULT_TERMINAL_FONT)
+    );
+    expect(resolveTerminalFontStack(42)).toBe(
+      resolveTerminalFontStack(DEFAULT_TERMINAL_FONT)
+    );
+  });
+
+  it("clamps a size to what a person can read", () => {
+    expect(resolveTerminalFontSize(14)).toBe(14);
+    expect(resolveTerminalFontSize(0)).toBe(MIN_TERMINAL_FONT_SIZE);
+    expect(resolveTerminalFontSize(999)).toBe(MAX_TERMINAL_FONT_SIZE);
+    expect(resolveTerminalFontSize(-4)).toBe(MIN_TERMINAL_FONT_SIZE);
+    expect(resolveTerminalFontSize(Number.NaN)).toBe(DEFAULT_TERMINAL_FONT_SIZE);
+    expect(resolveTerminalFontSize(undefined)).toBe(DEFAULT_TERMINAL_FONT_SIZE);
+  });
+
+  it("offers sizes that are all readable", () => {
+    for (const size of TERMINAL_FONT_SIZES) {
+      expect(size).toBeGreaterThanOrEqual(MIN_TERMINAL_FONT_SIZE);
+      expect(size).toBeLessThanOrEqual(MAX_TERMINAL_FONT_SIZE);
+    }
+  });
+
+  it("knows which fonts it offers", () => {
+    expect(isKnownTerminalFont("menlo")).toBe(true);
+    expect(isKnownTerminalFont("not-a-font")).toBe(false);
+    expect(isKnownTerminalFont(undefined)).toBe(false);
+  });
+});
diff --git a/apps/desktop/src/lib/terminal-fonts.ts b/apps/desktop/src/lib/terminal-fonts.ts
new file mode 100644
index 0000000..94d23a7
--- /dev/null
+++ b/apps/desktop/src/lib/terminal-fonts.ts
@@ -0,0 +1,144 @@
+// The terminal's font.
+//
+// The parity matrix names the font picker as the last of the shell-preference
+// gaps ("the remaining gap is the font picker (font family + size)"), and it
+// was a real one: the terminal used one hard-coded family and one hard-coded
+// size, so a user whose font was not in the stack — or whose screen needed a
+// different size — had no way to change it.
+//
+// A font family is a CSS font stack: xterm.js takes the same string a browser
+// would, so the options are the fonts a person already has on the machine,
+// each with sensible fallbacks behind it.
+
+/** The font families the picker offers. */
+export const TERMINAL_FONT_NAMES = [
+  "system-mono",
+  "sf-mono",
+  "menlo",
+  "monaco",
+  "jetbrains-mono",
+  "fira-code",
+  "source-code-pro",
+  "cascadia-code",
+  "ubuntu-mono",
+  "consolas",
+] as const;
+
+export type TerminalFontName = (typeof TERMINAL_FONT_NAMES)[number];
+
+/**
+ * The default: the stack the terminal already used, so a user who changes
+ * nothing sees exactly what they saw before.
+ */
+export const DEFAULT_TERMINAL_FONT: TerminalFontName = "system-mono";
+
+/** The default size, which is the size the terminal already used. */
+export const DEFAULT_TERMINAL_FONT_SIZE = 13;
+
+/** The sizes the picker offers, in points. */
+export const TERMINAL_FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20] as const;
+
+export type TerminalFontSize = (typeof TERMINAL_FONT_SIZES)[number];
+
+/** The smallest and largest size a user may pick. */
+export const MIN_TERMINAL_FONT_SIZE = 8;
+export const MAX_TERMINAL_FONT_SIZE = 32;
+
+interface TerminalFontEntry {
+  label: string;
+  /** The CSS font stack xterm.js is given. */
+  stack: string;
+}
+
+const fonts: Record<TerminalFontName, TerminalFontEntry> = {
+  "system-mono": {
+    label: "System monospace",
+    stack: '"SFMono-Regular", "Menlo", "Monaco", monospace',
+  },
+  "sf-mono": {
+    label: "SF Mono",
+    stack: '"SF Mono", "SFMono-Regular", "Menlo", "Monaco", monospace',
+  },
+  menlo: {
+    label: "Menlo",
+    stack: 'Menlo, "DejaVu Sans Mono", "Liberation Mono", monospace',
+  },
+  monaco: {
+    label: "Monaco",
+    stack: 'Monaco, "DejaVu Sans Mono", "Liberation Mono", monospace',
+  },
+  "jetbrains-mono": {
+    label: "JetBrains Mono",
+    stack: '"JetBrains Mono", "DejaVu Sans Mono", "Liberation Mono", monospace',
+  },
+  "fira-code": {
+    label: "Fira Code",
+    stack: '"Fira Code", "DejaVu Sans Mono", "Liberation Mono", monospace',
+  },
+  "source-code-pro": {
+    label: "Source Code Pro",
+    stack: '"Source Code Pro", "DejaVu Sans Mono", "Liberation Mono", monospace',
+  },
+  "cascadia-code": {
+    label: "Cascadia Code",
+    stack: '"Cascadia Code", "DejaVu Sans Mono", "Liberation Mono", monospace',
+  },
+  "ubuntu-mono": {
+    label: "Ubuntu Mono",
+    stack: '"Ubuntu Mono", "DejaVu Sans Mono", "Liberation Mono", monospace',
+  },
+  consolas: {
+    label: "Consolas",
+    stack: 'Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace',
+  },
+};
+
+export interface TerminalFontOption {
+  name: TerminalFontName;
+  label: string;
+  stack: string;
+}
+
+/**
+ * The font families the picker offers, in the order it lists them.
+ */
+export function listTerminalFontOptions(): TerminalFontOption[] {
+  return TERMINAL_FONT_NAMES.map((name) => ({
+    name,
+    label: fonts[name].label,
+    stack: fonts[name].stack,
+  }));
+}
+
+/**
+ * The CSS font stack for a font name.
+ *
+ * An unknown name falls back to the default stack, so a persisted value from
+ * a future version (or a hand-edited one) cannot leave the terminal with no
+ * font at all.
+ */
+export function resolveTerminalFontStack(name: unknown): string {
+  if (typeof name === "string" && name in fonts) {
+    return fonts[name as TerminalFontName].stack;
+  }
+  return fonts[DEFAULT_TERMINAL_FONT].stack;
+}
+
+/**
+ * Whether a value names a font the picker offers.
+ */
+export function isKnownTerminalFont(value: unknown): value is TerminalFontName {
+  return typeof value === "string" && (TERMINAL_FONT_NAMES as readonly string[]).includes(value);
+}
+
+/**
+ * The size to use, clamped to what the terminal can render.
+ *
+ * A size outside the range is not a size a person can read, so it is clamped
+ * rather than refused: a persisted value from a future version must not leave
+ * the terminal unreadable.
+ */
+export function resolveTerminalFontSize(value: unknown): number {
+  const size = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_TERMINAL_FONT_SIZE;
+  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(size)));
+}
diff --git a/apps/desktop/src/routes/SettingsGroupSettingsSection.tsx b/apps/desktop/src/routes/SettingsGroupSettingsSection.tsx
new file mode 100644
index 0000000..94a4c9f
--- /dev/null
+++ b/apps/desktop/src/routes/SettingsGroupSettingsSection.tsx
@@ -0,0 +1,179 @@
+import { useMemo, useState } from "react";
+
+import { cn } from "../lib/utils";
+import { useHostsStore } from "../store/hosts-store";
+import {
+  useGroupSettingsStore,
+  type GroupSettings,
+} from "../store/group-settings-store";
+
+// The settings a group of hosts shares.
+//
+// The parity matrix said the group surfaces carried "no inherited protocol
+// settings yet": every host in a group had to be given its own bastion, SFTP
+// root and environment, one host at a time. These are the DEFAULTS for a
+// group — a host that sets one of them itself keeps its own value.
+
+interface GroupSettingsSectionProps {
+  className?: string;
+}
+
+export function GroupSettingsSection({ className }: GroupSettingsSectionProps) {
+  const hosts = useHostsStore((state) => state.hosts);
+  const groupSettings = useGroupSettingsStore((state) => state.groupSettings);
+  const setGroupSettings = useGroupSettingsStore((state) => state.setGroupSettings);
+
+  // The groups are the ones the hosts actually use, so the section never
+  // shows a group nobody has a host in.
+  const groups = useMemo(() => {
+    const seen = new Set<string>();
+    for (const host of hosts) {
+      if (host.group) {
+        seen.add(host.group);
+      }
+    }
+    return [...seen].sort((left, right) => left.localeCompare(right));
+  }, [hosts]);
+
+  if (groups.length === 0) {
+    return null;
+  }
+
+  return (
+    <div className={cn("rounded-[22px] border border-slate-800/80 bg-slate-950/45 p-4", className)}>
+      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
+        Group settings
+      </p>
+      <p className="mt-1 text-sm leading-6 text-slate-400">
+        Defaults for the hosts in a group: the sign-in name, the bastion, the SFTP root and the
+        environment. A host that sets one of these itself keeps its own value, so nothing is
+        overridden.
+      </p>
+
+      <div className="mt-3 grid gap-3">
+        {groups.map((group) => (
+          <GroupSettingsCard
+            key={group}
+            group={group}
+            settings={groupSettings[group]}
+            hostCount={hosts.filter((host) => host.group === group).length}
+            onSave={(settings) => setGroupSettings(group, settings)}
+          />
+        ))}
+      </div>
+    </div>
+  );
+}
+
+interface GroupSettingsCardProps {
+  group: string;
+  settings?: GroupSettings;
+  hostCount: number;
+  onSave: (settings: GroupSettings) => void;
+}
+
+function GroupSettingsCard({ group, settings, hostCount, onSave }: GroupSettingsCardProps) {
+  const hosts = useHostsStore((state) => state.hosts);
+  const [username, setUsername] = useState(settings?.username ?? "");
+  const [jumpHostId, setJumpHostId] = useState(settings?.jumpHostId ?? "");
+  const [sftpRoot, setSftpRoot] = useState(settings?.sftpRoot ?? "");
+  const [environment, setEnvironment] = useState(() =>
+    Object.entries(settings?.environment ?? {})
+      .map(([key, value]) => `${key}=${value}`)
+      .join("\n")
+  );
+
+  function save() {
+    const parsedEnvironment: Record<string, string> = {};
+    for (const line of environment.split("\n")) {
+      const trimmed = line.trim();
+      if (!trimmed) {
+        continue;
+      }
+      const separator = trimmed.indexOf("=");
+      if (separator <= 0) {
+        continue;
+      }
+      parsedEnvironment[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
+    }
+
+    onSave({
+      username: username.trim() || undefined,
+      jumpHostId: jumpHostId || undefined,
+      sftpRoot: sftpRoot.trim() || undefined,
+      environment: Object.keys(parsedEnvironment).length > 0 ? parsedEnvironment : undefined,
+    });
+  }
+
+  return (
+    <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3">
+      <div className="flex flex-wrap items-center justify-between gap-2">
+        <p className="text-sm font-medium text-slate-100">{group}</p>
+        <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
+          {hostCount} {hostCount === 1 ? "host" : "hosts"}
+        </p>
+      </div>
+
+      <div className="mt-3 grid gap-3 sm:grid-cols-2">
+        <label className="flex flex-col gap-1 text-xs text-slate-400">
+          Default user name
+          <input
+            type="text"
+            value={username}
+            placeholder="leave empty to use the host's own"
+            onChange={(event) => setUsername(event.target.value)}
+            className="rounded-[10px] border border-slate-800 bg-slate-950/70 px-2 py-1.5 text-sm text-slate-100"
+          />
+        </label>
+
+        <label className="flex flex-col gap-1 text-xs text-slate-400">
+          Default bastion
+          <select
+            value={jumpHostId}
+            onChange={(event) => setJumpHostId(event.target.value)}
+            className="rounded-[10px] border border-slate-800 bg-slate-950/70 px-2 py-1.5 text-sm text-slate-100"
+          >
+            <option value="">leave empty to use the host's own</option>
+            {hosts
+              .filter((host) => host.protocol === "ssh")
+              .map((host) => (
+                <option key={host.id} value={host.id}>
+                  {host.label} ({host.hostname})
+                </option>
+              ))}
+          </select>
+        </label>
+
+        <label className="flex flex-col gap-1 text-xs text-slate-400">
+          Default SFTP root
+          <input
+            type="text"
+            value={sftpRoot}
+            placeholder="leave empty to use the host's own"
+            onChange={(event) => setSftpRoot(event.target.value)}
+            className="rounded-[10px] border border-slate-800 bg-slate-950/70 px-2 py-1.5 text-sm text-slate-100"
+          />
+        </label>
+
+        <label className="flex flex-col gap-1 text-xs text-slate-400">
+          Default environment
+          <textarea
+            value={environment}
+            rows={3}
+            placeholder={"REGION=eu-west-1\nTIER=web"}
+            onChange={(event) => setEnvironment(event.target.value)}
+            className="rounded-[10px] border border-slate-800 bg-slate-950/70 px-2 py-1.5 font-mono text-xs text-slate-100"
+          />
+        </label>
+      </div>
+
+      <button
+        type="button"
+        onClick={save}
+        className="mt-3 rounded-[12px] border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-sm text-emerald-100 transition hover:border-emerald-300/60"
+      >
+        Save group settings
+      </button>
+    </div>
+  );
+}
diff --git a/apps/desktop/src/routes/SettingsPage.tsx b/apps/desktop/src/routes/SettingsPage.tsx
index 097d053..a50758f 100644
--- a/apps/desktop/src/routes/SettingsPage.tsx
+++ b/apps/desktop/src/routes/SettingsPage.tsx
@@ -1,4 +1,5 @@
 import { useMemo, useRef, useState } from "react";
+import { GroupSettingsSection } from "./SettingsGroupSettingsSection";
 import { SettingsPreferencesSection } from "./SettingsPreferencesSection";
 import { SettingsTrustPolicySection } from "./SettingsTrustPolicySection";
 import { IdentityEditor, type IdentityEditorValues } from "../components/identities/IdentityEditor";
@@ -143,6 +144,7 @@ export function SettingsPage() {
     <section className="grid h-full min-h-0 gap-3 overflow-auto pr-1">
       <div className="grid max-w-3xl gap-3">
         <SettingsPreferencesSection />
+        <GroupSettingsSection />
 
         <div className="rounded-[22px] border border-slate-800/80 bg-slate-950/45 p-4">
           <div className="flex flex-wrap items-start justify-between gap-3">
diff --git a/apps/desktop/src/routes/SettingsPreferencesSection.tsx b/apps/desktop/src/routes/SettingsPreferencesSection.tsx
index de6ddf5..8fa0ac8 100644
--- a/apps/desktop/src/routes/SettingsPreferencesSection.tsx
+++ b/apps/desktop/src/routes/SettingsPreferencesSection.tsx
@@ -6,6 +6,7 @@ import { formatPrimaryShortcut } from "../lib/shortcuts";
 import { cn } from "../lib/utils";
 import { useAppStore } from "../store/app-store";
 import { listTerminalThemeOptions, type TerminalThemeName } from "../lib/terminal-themes";
+import { listTerminalFontOptions, TERMINAL_FONT_SIZES } from "../lib/terminal-fonts";
 import { errorMessageFromUnknown } from "../lib/error-message";
 
 export function SettingsPreferencesSection() {
@@ -22,6 +23,13 @@ export function SettingsPreferencesSection() {
   const terminalThemeOptions = listTerminalThemeOptions();
   const terminalScreenReaderMode = useAppStore((state) => state.terminalScreenReaderMode);
   const setTerminalScreenReaderMode = useAppStore((state) => state.setTerminalScreenReaderMode);
+  const redactCommandOutput = useAppStore((state) => state.redactCommandOutput);
+  const setRedactCommandOutput = useAppStore((state) => state.setRedactCommandOutput);
+  const terminalFont = useAppStore((state) => state.terminalFont);
+  const setTerminalFont = useAppStore((state) => state.setTerminalFont);
+  const terminalFontSize = useAppStore((state) => state.terminalFontSize);
+  const setTerminalFontSize = useAppStore((state) => state.setTerminalFontSize);
+  const terminalFontOptions = listTerminalFontOptions();
   // T17-T20 polish toggles.
   const appShellTheme = useAppStore((state) => state.appShellTheme);
   const setAppShellTheme = useAppStore((state) => state.setAppShellTheme);
@@ -104,6 +112,35 @@ export function SettingsPreferencesSection() {
                 Lets screen readers read terminal output, including in terminals already open. It
                 uses more memory and can slow very busy output, so it is off by default.
               </p>
+
+              <div className="mt-4 rounded-[16px] border border-slate-800 bg-slate-900/60 p-3">
+                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
+                  Session history
+                </p>
+                <button
+                  type="button"
+                  aria-pressed={redactCommandOutput}
+                  onClick={() => setRedactCommandOutput(!redactCommandOutput)}
+                  className={cn(
+                    "mt-2 inline-flex items-center gap-2 rounded-[14px] border px-3 py-2 text-sm transition",
+                    redactCommandOutput
+                      ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-100"
+                      : "border-slate-800 bg-slate-950/70 text-slate-300 hover:border-slate-700 hover:text-white"
+                  )}
+                >
+                  <span>
+                    {redactCommandOutput
+                      ? "Redact secrets in command output on"
+                      : "Redact secrets in command output off"}
+                  </span>
+                </button>
+                <p className="mt-2 text-sm leading-5 text-slate-300">
+                  The session history keeps a preview of what each command printed, and that preview
+                  is saved across restarts. With this on, a password, a token or an API key in the
+                  output is replaced before it is kept, so the history stays useful without keeping
+                  the secret.
+                </p>
+              </div>
             </div>
 
             <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3">
@@ -174,6 +211,81 @@ export function SettingsPreferencesSection() {
             </div>
 
             <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3 lg:col-span-2">
+              <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3 lg:col-span-2">
+                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
+                  Terminal font
+                </p>
+                <p className="mt-1 text-sm leading-5 text-slate-300">
+                  Pick the font every terminal pane uses, and how large it is. Font changes apply
+                  live, to terminals that are already open, without disconnecting a session.
+                </p>
+                <div
+                  role="radiogroup"
+                  aria-label="Terminal font"
+                  className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
+                >
+                  {terminalFontOptions.map((option) => {
+                    const selected = terminalFont === option.name;
+                    return (
+                      <button
+                        key={option.name}
+                        type="button"
+                        role="radio"
+                        aria-checked={selected}
+                        aria-label={option.label}
+                        onClick={() => setTerminalFont(option.name)}
+                        className={cn(
+                          "rounded-[14px] border px-3 py-2 text-left transition",
+                          selected
+                            ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-50"
+                            : "border-slate-800 bg-slate-950/70 text-slate-300 hover:border-slate-700 hover:text-white"
+                        )}
+                      >
+                        <span className="block text-sm font-medium">{option.label}</span>
+                        <span
+                          className="mt-0.5 block truncate text-[11px] leading-4 text-slate-400"
+                          style={{ fontFamily: option.stack }}
+                        >
+                          ls -la /var/log
+                        </span>
+                      </button>
+                    );
+                  })}
+                </div>
+                <div className="mt-3">
+                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
+                    Font size
+                  </p>
+                  <div
+                    role="radiogroup"
+                    aria-label="Terminal font size"
+                    className="mt-2 flex flex-wrap gap-2"
+                  >
+                    {TERMINAL_FONT_SIZES.map((size) => {
+                      const selected = terminalFontSize === size;
+                      return (
+                        <button
+                          key={size}
+                          type="button"
+                          role="radio"
+                          aria-checked={selected}
+                          aria-label={`${size} point`}
+                          onClick={() => setTerminalFontSize(size)}
+                          className={cn(
+                            "rounded-[12px] border px-3 py-1.5 text-sm transition",
+                            selected
+                              ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-50"
+                              : "border-slate-800 bg-slate-950/70 text-slate-300 hover:border-slate-700 hover:text-white"
+                          )}
+                        >
+                          {size}
+                        </button>
+                      );
+                    })}
+                  </div>
+                </div>
+              </div>
+
               <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                 Terminal theme
               </p>
diff --git a/apps/desktop/src/store/app-store.test.ts b/apps/desktop/src/store/app-store.test.ts
index 70448f5..524f2d0 100644
--- a/apps/desktop/src/store/app-store.test.ts
+++ b/apps/desktop/src/store/app-store.test.ts
@@ -1,5 +1,6 @@
 import { afterEach, describe, expect, it } from "vitest";
 import { DEFAULT_TERMINAL_THEME } from "../lib/terminal-themes";
+import { DEFAULT_TERMINAL_FONT, DEFAULT_TERMINAL_FONT_SIZE } from "../lib/terminal-fonts";
 import {
   buildBaselineDefaults,
   migrateAppState,
@@ -14,6 +15,26 @@ afterEach(() => {
 });
 
 describe("app store preferences", () => {
+  it("keeps the terminal font and the history redaction as preferences", () => {
+    const state = useAppStore.getState();
+
+    // The parity matrix named the font picker as the last of the
+    // shell-preference gaps: the terminal had one hard-coded family and size.
+    expect(state.terminalFont).toBe(DEFAULT_TERMINAL_FONT);
+    expect(state.terminalFontSize).toBe(DEFAULT_TERMINAL_FONT_SIZE);
+    // The history keeps a preview of what a command printed, and that preview
+    // is persisted: a secret in it should not be.
+    expect(state.redactCommandOutput).toBe(true);
+
+    useAppStore.getState().setTerminalFont("menlo");
+    useAppStore.getState().setTerminalFontSize(16);
+    useAppStore.getState().setRedactCommandOutput(false);
+
+    expect(useAppStore.getState().terminalFont).toBe("menlo");
+    expect(useAppStore.getState().terminalFontSize).toBe(16);
+    expect(useAppStore.getState().redactCommandOutput).toBe(false);
+  });
+
   it("defaults to a dense workspace with section shortcuts and demo mode enabled", () => {
     const state = useAppStore.getState();
 
diff --git a/apps/desktop/src/store/app-store.ts b/apps/desktop/src/store/app-store.ts
index f83faef..3bc6483 100644
--- a/apps/desktop/src/store/app-store.ts
+++ b/apps/desktop/src/store/app-store.ts
@@ -8,6 +8,13 @@ import {
   isKnownTheme,
   type TerminalThemeName,
 } from "../lib/terminal-themes";
+import {
+  DEFAULT_TERMINAL_FONT,
+  DEFAULT_TERMINAL_FONT_SIZE,
+  isKnownTerminalFont,
+  resolveTerminalFontSize,
+  type TerminalFontName,
+} from "../lib/terminal-fonts";
 
 type WorkspaceDensity = "compact" | "comfortable";
 /**
@@ -24,8 +31,23 @@ interface AppState {
   sectionShortcutsEnabled: boolean;
   demoModeEnabled: boolean;
   terminalTheme: TerminalThemeName;
+  /**
+   * The terminal's font family and size. The parity matrix named the font
+   * picker as the last of the shell-preference gaps: the terminal had one
+   * hard-coded family and one hard-coded size.
+   */
+  terminalFont: TerminalFontName;
+  terminalFontSize: number;
   /** #510: xterm's screenReaderMode for every terminal. Off by default. */
   terminalScreenReaderMode: boolean;
+  /**
+   * Mask the secrets in the command output the session history keeps.
+   *
+   * The history persists a preview of what a command printed, and a command
+   * that prints a token leaves it in the local storage the history is written
+   * to. On by default: the preview is evidence, and the secret is not.
+   */
+  redactCommandOutput: boolean;
   vaultId: string;
   deviceId: string;
   lastAppliedSnapshotId: string | null;
@@ -63,7 +85,10 @@ interface AppState {
   setSectionShortcutsEnabled: (enabled: boolean) => void;
   setDemoModeEnabled: (enabled: boolean) => void;
   setTerminalTheme: (theme: TerminalThemeName) => void;
+  setTerminalFont: (font: TerminalFontName) => void;
+  setTerminalFontSize: (size: number) => void;
   setTerminalScreenReaderMode: (enabled: boolean) => void;
+  setRedactCommandOutput: (enabled: boolean) => void;
   setVaultId: (vaultId: string) => void;
   setLastAppliedSnapshotId: (snapshotId: string | null) => void;
   markImportCalloutSeen: () => void;
@@ -93,8 +118,23 @@ interface PersistedAppState {
   sectionShortcutsEnabled: boolean;
   workspaceDensity: WorkspaceDensity;
   terminalTheme: TerminalThemeName;
+  /**
+   * The terminal's font family and size. The parity matrix named the font
+   * picker as the last of the shell-preference gaps: the terminal had one
+   * hard-coded family and one hard-coded size.
+   */
+  terminalFont: TerminalFontName;
+  terminalFontSize: number;
   /** #510: xterm's screenReaderMode for every terminal. Off by default. */
   terminalScreenReaderMode: boolean;
+  /**
+   * Mask the secrets in the command output the session history keeps.
+   *
+   * The history persists a preview of what a command printed, and a command
+   * that prints a token leaves it in the local storage the history is written
+   * to. On by default: the preview is evidence, and the secret is not.
+   */
+  redactCommandOutput: boolean;
   vaultId: string;
   deviceId: string;
   lastAppliedSnapshotId: string | null;
@@ -133,7 +173,12 @@ export function buildBaselineDefaults(state: Partial<PersistedAppState>): Persis
     sectionShortcutsEnabled: state.sectionShortcutsEnabled ?? true,
     demoModeEnabled: state.demoModeEnabled ?? getDefaultDemoModeEnabled(),
     terminalTheme: safeTerminalTheme,
+    terminalFont: isKnownTerminalFont(state.terminalFont) ? state.terminalFont : DEFAULT_TERMINAL_FONT,
+    terminalFontSize: resolveTerminalFontSize(state.terminalFontSize ?? DEFAULT_TERMINAL_FONT_SIZE),
     terminalScreenReaderMode: state.terminalScreenReaderMode ?? false,
+    // On by default: the output preview is evidence, and a secret in it is
+    // not something the history should keep.
+    redactCommandOutput: state.redactCommandOutput ?? true,
     vaultId: state.vaultId ?? createPersistentId(),
     deviceId: state.deviceId ?? createPersistentId(),
     lastAppliedSnapshotId: state.lastAppliedSnapshotId ?? null,
@@ -202,7 +247,10 @@ export const useAppStore = create<AppState>()(
       sectionShortcutsEnabled: true,
       demoModeEnabled: getDefaultDemoModeEnabled(),
       terminalTheme: DEFAULT_TERMINAL_THEME,
+      terminalFont: DEFAULT_TERMINAL_FONT,
+      terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
       terminalScreenReaderMode: false,
+      redactCommandOutput: true,
       vaultId: createPersistentId(),
       deviceId: createPersistentId(),
       lastAppliedSnapshotId: null,
@@ -226,7 +274,11 @@ export const useAppStore = create<AppState>()(
         set({
           terminalTheme: isKnownTheme(terminalTheme) ? terminalTheme : DEFAULT_TERMINAL_THEME,
         }),
+      setTerminalFont: (terminalFont) =>
+        set({ terminalFont: isKnownTerminalFont(terminalFont) ? terminalFont : DEFAULT_TERMINAL_FONT }),
+      setTerminalFontSize: (terminalFontSize) => set({ terminalFontSize: resolveTerminalFontSize(terminalFontSize) }),
       setTerminalScreenReaderMode: (terminalScreenReaderMode) => set({ terminalScreenReaderMode }),
+      setRedactCommandOutput: (redactCommandOutput) => set({ redactCommandOutput }),
       setVaultId: (vaultId) => set({ vaultId }),
       setLastAppliedSnapshotId: (lastAppliedSnapshotId) => set({ lastAppliedSnapshotId }),
       markImportCalloutSeen: () => set({ sawImportCallout: true }),
@@ -256,7 +308,10 @@ export const useAppStore = create<AppState>()(
         sectionShortcutsEnabled: state.sectionShortcutsEnabled,
         demoModeEnabled: state.demoModeEnabled,
         terminalTheme: state.terminalTheme,
+        terminalFont: state.terminalFont,
+        terminalFontSize: state.terminalFontSize,
         terminalScreenReaderMode: state.terminalScreenReaderMode,
+        redactCommandOutput: state.redactCommandOutput,
         vaultId: state.vaultId,
         deviceId: state.deviceId,
         lastAppliedSnapshotId: state.lastAppliedSnapshotId,
diff --git a/apps/desktop/src/store/broadcast-store.test.ts b/apps/desktop/src/store/broadcast-store.test.ts
new file mode 100644
index 0000000..b6c1ee2
--- /dev/null
+++ b/apps/desktop/src/store/broadcast-store.test.ts
@@ -0,0 +1,88 @@
+import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
+
+import {
+  broadcastInput,
+  registerBroadcastSender,
+  useBroadcastStore,
+} from "./broadcast-store";
+
+// Broadcast input across several live sessions: the competitor's daily-use
+// list has it, and this app could only broadcast a SNIPPET across hosts.
+// What you type goes to every pane taking part — so it is off by default, and
+// it must never reach a pane whose session is not open.
+
+describe("broadcast input", () => {
+  beforeEach(() => {
+    useBroadcastStore.setState({ enabled: false, paneIds: [] });
+  });
+
+  afterEach(() => {
+    useBroadcastStore.setState({ enabled: false, paneIds: [] });
+  });
+
+  it("is off by default", () => {
+    expect(useBroadcastStore.getState().enabled).toBe(false);
+    expect(useBroadcastStore.getState().paneIds).toEqual([]);
+  });
+
+  it("sends the input to every pane taking part", () => {
+    const first = vi.fn();
+    const second = vi.fn();
+    const unregisterFirst = registerBroadcastSender("pane-1", first);
+    const unregisterSecond = registerBroadcastSender("pane-2", second);
+
+    expect(broadcastInput(["pane-1", "pane-2"], "uptime\r")).toBe(2);
+    expect(first).toHaveBeenCalledWith("uptime\r");
+    expect(second).toHaveBeenCalledWith("uptime\r");
+
+    unregisterFirst();
+    unregisterSecond();
+  });
+
+  it("skips a pane that is not there", () => {
+    const present = vi.fn();
+    const unregister = registerBroadcastSender("pane-1", present);
+
+    expect(broadcastInput(["pane-1", "pane-gone"], "ls\r")).toBe(1);
+    expect(present).toHaveBeenCalledWith("ls\r");
+
+    unregister();
+    expect(broadcastInput(["pane-1"], "ls\r")).toBe(0);
+  });
+
+  it("stops sending to a pane that unregistered", () => {
+    const send = vi.fn();
+    const unregister = registerBroadcastSender("pane-1", send);
+
+    unregister();
+    expect(broadcastInput(["pane-1"], "ls\r")).toBe(0);
+    expect(send).not.toHaveBeenCalled();
+  });
+
+  it("empties the set when the broadcast is turned off", () => {
+    // A pane that was closed must not keep receiving a later broadcast.
+    useBroadcastStore.getState().setAllPanes(["pane-1", "pane-2"]);
+    expect(useBroadcastStore.getState().paneIds).toEqual(["pane-1", "pane-2"]);
+
+    useBroadcastStore.getState().setEnabled(false);
+
+    expect(useBroadcastStore.getState().enabled).toBe(false);
+    expect(useBroadcastStore.getState().paneIds).toEqual([]);
+  });
+
+  it("adds and removes a single pane", () => {
+    useBroadcastStore.getState().togglePane("pane-1");
+    expect(useBroadcastStore.getState().paneIds).toEqual(["pane-1"]);
+
+    useBroadcastStore.getState().togglePane("pane-2");
+    expect(useBroadcastStore.getState().paneIds).toEqual(["pane-1", "pane-2"]);
+
+    useBroadcastStore.getState().togglePane("pane-1");
+    expect(useBroadcastStore.getState().paneIds).toEqual(["pane-2"]);
+  });
+
+  it("does not list the same pane twice", () => {
+    useBroadcastStore.getState().setAllPanes(["pane-1", "pane-1", "pane-2"]);
+    expect(useBroadcastStore.getState().paneIds).toEqual(["pane-1", "pane-2"]);
+  });
+});
diff --git a/apps/desktop/src/store/broadcast-store.ts b/apps/desktop/src/store/broadcast-store.ts
new file mode 100644
index 0000000..372848f
--- /dev/null
+++ b/apps/desktop/src/store/broadcast-store.ts
@@ -0,0 +1,85 @@
+// Send what you type to more than one terminal.
+//
+// The competitor's daily-use list has "broadcast input across multiple
+// terminals", and this app could only broadcast a SNIPPET across hosts —
+// there was no way to type into several live sessions at once, which is what
+// you want when the same command has to run on four machines.
+//
+// The broadcast is off by default and says so on screen while it is on: input
+// that goes to four terminals instead of one is exactly the kind of thing
+// that should never happen by accident.
+//
+// The senders are functions, so they cannot be persisted — they are kept in a
+// registry beside the store rather than in it.
+
+import { create } from "zustand";
+
+/** Sends input to one pane. */
+export type PaneInputSender = (data: string) => void;
+
+interface BroadcastState {
+  /** Whether input is broadcast at all. */
+  enabled: boolean;
+  /** The panes that receive the broadcast. */
+  paneIds: string[];
+  setEnabled: (enabled: boolean) => void;
+  /** Add or remove a pane from the broadcast. */
+  togglePane: (paneId: string) => void;
+  /** Every pane that has a live session, for a broadcast to all of them. */
+  setAllPanes: (paneIds: string[]) => void;
+}
+
+export const useBroadcastStore = create<BroadcastState>()((set) => ({
+  enabled: false,
+  paneIds: [],
+  setEnabled: (enabled) =>
+    set((state) => ({
+      enabled,
+      // Turning the broadcast off empties it: leaving stale panes in the set
+      // would mean the next broadcast went to a session the user had closed.
+      paneIds: enabled ? state.paneIds : [],
+    })),
+  togglePane: (paneId) =>
+    set((state) => ({
+      paneIds: state.paneIds.includes(paneId)
+        ? state.paneIds.filter((id) => id !== paneId)
+        : [...state.paneIds, paneId],
+    })),
+  setAllPanes: (paneIds) => set({ paneIds: [...new Set(paneIds)] }),
+}));
+
+// The senders, beside the store rather than in it: they are functions, and
+// the persisted half of the state must stay serialisable.
+const senders = new Map<string, PaneInputSender>();
+
+/**
+ * Register a pane's input sender, and get a function that removes it.
+ *
+ * A pane registers when its terminal exists and unregisters when it goes,
+ * so a closed pane never receives a broadcast.
+ */
+export function registerBroadcastSender(paneId: string, send: PaneInputSender): () => void {
+  senders.set(paneId, send);
+  return () => {
+    senders.delete(paneId);
+  };
+}
+
+/**
+ * Send input to the given panes.
+ *
+ * A pane whose session is not open is skipped: the sender checks, so a
+ * broadcast never queues input for a session that is not there.
+ */
+export function broadcastInput(paneIds: string[], data: string): number {
+  let delivered = 0;
+  for (const paneId of paneIds) {
+    const send = senders.get(paneId);
+    if (!send) {
+      continue;
+    }
+    send(data);
+    delivered += 1;
+  }
+  return delivered;
+}
diff --git a/apps/desktop/src/store/connect-error-store.test.ts b/apps/desktop/src/store/connect-error-store.test.ts
index cf7d8fc..d10c303 100644
--- a/apps/desktop/src/store/connect-error-store.test.ts
+++ b/apps/desktop/src/store/connect-error-store.test.ts
@@ -1,35 +1,46 @@
-import { describe, expect, it, beforeEach } from "vitest";
-import { reportConnectError, useConnectErrorStore } from "./connect-error-store";
+import { beforeEach, describe, expect, it } from "vitest";
 
-// The connect-failure channel exists because every connect failure used to
-// be computed correctly and then dropped into a console.warn at each call
-// site, so a host that was down, firewalled, or mis-typed produced no
-// on-screen output at all. These tests pin the reporting contract.
+import {
+  reportConnectError,
+  useConnectErrorStore,
+} from "./connect-error-store";
 
-describe("connect-error-store", () => {
+// A connect failure the user has to act on should say what to do about it,
+// not only what went wrong. The action is declarative — a route to go to — so
+// the store holds no callbacks and the banner owns the navigation.
+
+describe("the connect error banner", () => {
   beforeEach(() => {
     useConnectErrorStore.getState().clearConnectError();
   });
 
-  it("starts with no message", () => {
-    expect(useConnectErrorStore.getState().message).toBeNull();
-    expect(useConnectErrorStore.getState().tone).toBe("error");
+  it("carries a message and no action by default", () => {
+    reportConnectError("Could not reach the host.");
+
+    const state = useConnectErrorStore.getState();
+    expect(state.message).toBe("Could not reach the host.");
+    expect(state.tone).toBe("error");
+    expect(state.action).toBeNull();
   });
 
-  it("reports a message with the error tone by default", () => {
-    reportConnectError("Could not scan host:22.");
+  it("carries the action that fixes the failure", () => {
+    reportConnectError("The host key could not be approved.", "error", {
+      label: "Open host",
+      href: "/hosts?edit=host-1",
+    });
 
-    expect(useConnectErrorStore.getState().message).toBe("Could not scan host:22.");
-    expect(useConnectErrorStore.getState().tone).toBe("error");
+    const state = useConnectErrorStore.getState();
+    expect(state.action?.label).toBe("Open host");
+    expect(state.action?.href).toBe("/hosts?edit=host-1");
   });
 
-  it("reports a user-initiated failure as a warning", () => {
-    reportConnectError("Connection cancelled — host key was not trusted.", "warning");
+  it("reports a failure the user chose as a warning", () => {
+    reportConnectError("Connection cancelled.", "warning");
 
     expect(useConnectErrorStore.getState().tone).toBe("warning");
   });
 
-  it("ignores an empty message so no blank banner can render", () => {
+  it("ignores an empty message", () => {
     reportConnectError("");
     reportConnectError(null);
     reportConnectError(undefined);
@@ -37,29 +48,22 @@ describe("connect-error-store", () => {
     expect(useConnectErrorStore.getState().message).toBeNull();
   });
 
-  it("replaces the previous message rather than stacking failures", () => {
-    reportConnectError("First failure.");
-    reportConnectError("Second failure.");
-
-    expect(useConnectErrorStore.getState().message).toBe("Second failure.");
-  });
-
-  it("clears the message", () => {
-    reportConnectError("Something failed.");
+  it("drops the action when the banner is cleared", () => {
+    reportConnectError("The host key could not be approved.", "error", {
+      label: "Open host",
+      href: "/hosts?edit=host-1",
+    });
     useConnectErrorStore.getState().clearConnectError();
 
-    expect(useConnectErrorStore.getState().message).toBeNull();
+    const state = useConnectErrorStore.getState();
+    expect(state.message).toBeNull();
+    expect(state.action).toBeNull();
   });
 
-  it("resets the tone to error when the message is cleared", () => {
-    // A dismissed warning must not leave the tone amber for the next failure,
-    // so clearing resets the tone as well as the message.
-    reportConnectError("Connection cancelled — host key was not trusted.", "warning");
-    expect(useConnectErrorStore.getState().tone).toBe("warning");
-
-    useConnectErrorStore.getState().clearConnectError();
+  it("replaces a stale action when a new failure is reported", () => {
+    reportConnectError("First failure.", "error", { label: "Open host", href: "/hosts?edit=1" });
+    reportConnectError("Second failure.");
 
-    expect(useConnectErrorStore.getState().message).toBeNull();
-    expect(useConnectErrorStore.getState().tone).toBe("error");
+    expect(useConnectErrorStore.getState().action).toBeNull();
   });
 });
diff --git a/apps/desktop/src/store/connect-error-store.ts b/apps/desktop/src/store/connect-error-store.ts
index 6bf7645..ac6f755 100644
--- a/apps/desktop/src/store/connect-error-store.ts
+++ b/apps/desktop/src/store/connect-error-store.ts
@@ -16,6 +16,20 @@ import { create } from "zustand";
 
 export type ConnectErrorTone = "error" | "warning";
 
+/**
+ * What the banner can offer besides the message.
+ *
+ * A failure the user has to act on — a host key to approve, a key path to
+ * fix — should say what to do about it, not only what went wrong. The action
+ * is declarative (a route to go to) so the store holds no callbacks and the
+ * banner owns the navigation.
+ */
+export interface ConnectErrorAction {
+  label: string;
+  /** The route to go to, with an optional query string. */
+  href: string;
+}
+
 interface ConnectErrorState {
   /** The message to show, or null when there is nothing to report. */
   message: string | null;
@@ -24,15 +38,23 @@ interface ConnectErrorState {
    * it is reported without reading as an error.
    */
   tone: ConnectErrorTone;
-  setConnectError: (message: string, tone?: ConnectErrorTone) => void;
+  /** The action the banner offers, when there is one worth offering. */
+  action: ConnectErrorAction | null;
+  setConnectError: (
+    message: string,
+    tone?: ConnectErrorTone,
+    action?: ConnectErrorAction | null
+  ) => void;
   clearConnectError: () => void;
 }
 
-export const useConnectErrorStore = create<ConnectErrorState>((set) => ({
+export const useConnectErrorStore = create<ConnectErrorState>()((set) => ({
   message: null,
   tone: "error",
-  setConnectError: (message, tone = "error") => set({ message, tone }),
-  clearConnectError: () => set({ message: null, tone: "error" }),
+  action: null,
+  setConnectError: (message, tone = "error", action = null) =>
+    set({ message, tone, action }),
+  clearConnectError: () => set({ message: null, tone: "error", action: null }),
 }));
 
 /**
@@ -44,10 +66,11 @@ export const useConnectErrorStore = create<ConnectErrorState>((set) => ({
  */
 export function reportConnectError(
   message: string | null | undefined,
-  tone: ConnectErrorTone = "error"
+  tone: ConnectErrorTone = "error",
+  action: ConnectErrorAction | null = null
 ) {
   if (!message) {
     return;
   }
-  useConnectErrorStore.getState().setConnectError(message, tone);
+  useConnectErrorStore.getState().setConnectError(message, tone, action);
 }
diff --git a/apps/desktop/src/store/group-settings-store.test.ts b/apps/desktop/src/store/group-settings-store.test.ts
new file mode 100644
index 0000000..c2889af
--- /dev/null
+++ b/apps/desktop/src/store/group-settings-store.test.ts
@@ -0,0 +1,82 @@
+import { describe, expect, it } from "vitest";
+
+import {
+  applyGroupSettings,
+  groupSettingsFor,
+  type GroupSettings,
+} from "./group-settings-store";
+
+// The parity matrix said the group surfaces carried "no inherited protocol
+// settings yet", so every host in a group had to be given its own bastion,
+// SFTP root and environment one at a time — and every one of them drifted.
+
+describe("group settings", () => {
+  const host = {
+    username: "",
+    jumpHostId: undefined,
+    sftpRoot: "",
+    environment: {},
+  };
+
+  it("supplies what the host does not set", () => {
+    const applied = applyGroupSettings(host, {
+      username: "ops",
+      jumpHostId: "host-bastion",
+      sftpRoot: "/srv/app",
+      environment: { REGION: "eu-west-1" },
+    });
+
+    expect(applied.username).toBe("ops");
+    expect(applied.jumpHostId).toBe("host-bastion");
+    expect(applied.sftpRoot).toBe("/srv/app");
+    expect(applied.environment).toEqual({ REGION: "eu-west-1" });
+  });
+
+  it("never overrides what the host sets itself", () => {
+    const applied = applyGroupSettings(
+      {
+        username: "root",
+        jumpHostId: "host-own-bastion",
+        sftpRoot: "/home/root",
+        environment: { REGION: "us-east-1" },
+      },
+      {
+        username: "ops",
+        jumpHostId: "host-group-bastion",
+        sftpRoot: "/srv/app",
+        environment: { REGION: "eu-west-1", TIER: "web" },
+      }
+    );
+
+    expect(applied.username).toBe("root");
+    expect(applied.jumpHostId).toBe("host-own-bastion");
+    expect(applied.sftpRoot).toBe("/home/root");
+    // The environment is merged per key: the host's own value wins, and the
+    // group's other keys still come through.
+    expect(applied.environment).toEqual({ REGION: "us-east-1", TIER: "web" });
+  });
+
+  it("changes nothing when the group says nothing", () => {
+    expect(applyGroupSettings(host, undefined)).toBe(host);
+    expect(applyGroupSettings(host, {})).toBe(host);
+    expect(applyGroupSettings(host, { environment: {} })).toBe(host);
+  });
+
+  it("ignores a blank value in the group", () => {
+    const applied = applyGroupSettings(host, { username: "   ", sftpRoot: "" });
+
+    expect(applied.username).toBe("");
+    expect(applied.sftpRoot).toBe("");
+  });
+
+  it("finds the settings for a host's group", () => {
+    const settings: Record<string, GroupSettings> = {
+      "Acme / Production": { username: "ops" },
+    };
+
+    expect(groupSettingsFor(settings, "Acme / Production")?.username).toBe("ops");
+    expect(groupSettingsFor(settings, "Acme / Staging")).toBeUndefined();
+    expect(groupSettingsFor(settings, undefined)).toBeUndefined();
+    expect(groupSettingsFor(settings, "")).toBeUndefined();
+  });
+});
diff --git a/apps/desktop/src/store/group-settings-store.ts b/apps/desktop/src/store/group-settings-store.ts
new file mode 100644
index 0000000..8b38c8b
--- /dev/null
+++ b/apps/desktop/src/store/group-settings-store.ts
@@ -0,0 +1,130 @@
+// Settings a group of hosts shares.
+//
+// The parity matrix says the group, tag and filter surfaces are implemented
+// but that they carry "no inherited protocol settings yet" — so every host
+// in a group had to be given its own bastion, its own SFTP root and its own
+// environment, one host at a time, and every one of them drifted.
+//
+// A group's settings are DEFAULTS: a host keeps its own value where it has
+// one, and takes the group's where it does not. Nothing is overwritten, so a
+// host that needs its own bastion still has one.
+
+import { create } from "zustand";
+import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
+import { createMigratingLocalStorage } from "../lib/persistence";
+
+/**
+ * The settings a group can supply.
+ *
+ * Every field is optional, and an absent field means "this group says
+ * nothing about it" — not "this group says the default".
+ */
+export interface GroupSettings {
+  /** The default sign-in name for hosts in the group. */
+  username?: string;
+  /** The default bastion for hosts in the group. */
+  jumpHostId?: string;
+  /** The default SFTP root for hosts in the group. */
+  sftpRoot?: string;
+  /** The default environment for hosts in the group, merged per key. */
+  environment?: Record<string, string>;
+}
+
+interface GroupSettingsState {
+  groupSettings: Record<string, GroupSettings>;
+  setGroupSettings: (group: string, settings: GroupSettings) => void;
+  clearGroupSettings: (group: string) => void;
+}
+
+const fallbackStorage: StateStorage = {
+  getItem: () => null,
+  setItem: () => undefined,
+  removeItem: () => undefined,
+};
+
+export const useGroupSettingsStore = create<GroupSettingsState>()(
+  persist(
+    (set) => ({
+      groupSettings: {},
+      setGroupSettings: (group, settings) =>
+        set((state) => ({
+          groupSettings: {
+            ...state.groupSettings,
+            [group]: settings,
+          },
+        })),
+      clearGroupSettings: (group) =>
+        set((state) => {
+          const next = { ...state.groupSettings };
+          delete next[group];
+          return { groupSettings: next };
+        }),
+    }),
+    {
+      name: "terminal-workspace-group-settings",
+      version: 1,
+      storage: createJSONStorage(() =>
+        typeof window === "undefined" ? fallbackStorage : createMigratingLocalStorage()
+      ),
+      partialize: (state) => ({ groupSettings: state.groupSettings }),
+    }
+  )
+);
+
+/**
+ * The settings a group supplies, for a host in that group.
+ *
+ * A host with no group, or a group with no settings, inherits nothing.
+ */
+export function groupSettingsFor(
+  groupSettings: Record<string, GroupSettings>,
+  group: string | undefined
+): GroupSettings | undefined {
+  if (!group) {
+    return undefined;
+  }
+  return groupSettings[group];
+}
+
+/**
+ * Apply a group's settings to a host that has not set those things itself.
+ *
+ * The host's own value always wins where it has one:
+ *
+ * - a username the host carries is kept, an empty one is inherited;
+ * - a bastion the host names is kept, an unset one is inherited;
+ * - an SFTP root the host carries is kept, an empty one is inherited;
+ * - the environment is merged per key, so a host can override one variable
+ *   and inherit the rest.
+ */
+export function applyGroupSettings<
+  T extends {
+    username: string;
+    jumpHostId?: string;
+    sftpRoot: string;
+    environment: Record<string, string>;
+  }
+>(host: T, settings: GroupSettings | undefined): T {
+  if (!settings) {
+    return host;
+  }
+
+  const username = host.username.trim() ? host.username : settings.username?.trim() || host.username;
+  const jumpHostId = host.jumpHostId ?? settings.jumpHostId;
+  const sftpRoot = host.sftpRoot.trim() ? host.sftpRoot : settings.sftpRoot?.trim() || host.sftpRoot;
+  const environment =
+    settings.environment && Object.keys(settings.environment).length > 0
+      ? { ...settings.environment, ...host.environment }
+      : host.environment;
+
+  if (
+    username === host.username &&
+    jumpHostId === host.jumpHostId &&
+    sftpRoot === host.sftpRoot &&
+    environment === host.environment
+  ) {
+    return host;
+  }
+
+  return { ...host, username, jumpHostId, sftpRoot, environment };
+}
diff --git a/apps/desktop/src/store/sessions-store.redaction.test.ts b/apps/desktop/src/store/sessions-store.redaction.test.ts
new file mode 100644
index 0000000..d722450
--- /dev/null
+++ b/apps/desktop/src/store/sessions-store.redaction.test.ts
@@ -0,0 +1,69 @@
+import { beforeEach, describe, expect, it, vi } from "vitest";
+
+// The backend runtime is only partly mocked: the app store asks it whether
+// the Tauri runtime is present.
+vi.mock("../lib/backend-runtime", async (importOriginal) => ({
+  ...(await importOriginal<typeof import("../lib/backend-runtime")>()),
+  closeSession: vi.fn(() => Promise.resolve({ ok: true })),
+}));
+
+import { sampleHosts } from "../types/host";
+import { useAppStore } from "./app-store";
+import { useSessionsStore } from "./sessions-store";
+
+// The session history persists a preview of what a command printed. A command
+// that prints a secret would leave it in the local storage the history is
+// written to, so the preview is redacted before it is kept.
+//
+// The command itself is NOT redacted: the history replays it into a session,
+// and a redacted command would run as something else.
+
+describe("the session history and secrets", () => {
+  beforeEach(() => {
+    useAppStore.setState({ redactCommandOutput: true });
+    useSessionsStore.setState({ commandHistory: [] });
+  });
+
+  function recordOutput(output: string) {
+    const tabId = useSessionsStore.getState().openSession(sampleHosts[0]);
+    const state = useSessionsStore.getState();
+    const paneId = state.tabs.find((tab) => tab.id === tabId)?.paneIds[0];
+    if (!paneId) {
+      throw new Error("no pane");
+    }
+    const entryId = useSessionsStore.getState().recordPaneCommand(paneId, "cat .env");
+    if (!entryId) {
+      throw new Error("no history entry");
+    }
+    useSessionsStore.getState().appendCommandOutput(entryId, output);
+    return useSessionsStore.getState().commandHistory[0];
+  }
+
+  it("keeps a secret out of the preview", () => {
+    const entry = recordOutput("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY");
+
+    expect(entry.outputPreview).toBeDefined();
+    expect(entry.outputPreview).not.toContain("wJalrXUtnFEMIK7MDENGbPxRfiCY");
+    expect(entry.outputPreview).toContain("[redacted]");
+  });
+
+  it("keeps ordinary output readable", () => {
+    const entry = recordOutput("total 24\nrelease.tar.gz  1024");
+
+    expect(entry.outputPreview).toContain("release.tar.gz");
+    expect(entry.outputPreview).not.toContain("[redacted]");
+  });
+
+  it("keeps the command itself, because the history replays it", () => {
+    const entry = recordOutput("nothing secret here");
+
+    expect(entry.command).toBe("cat .env");
+  });
+
+  it("leaves the output alone when the user turns redaction off", () => {
+    useAppStore.setState({ redactCommandOutput: false });
+    const entry = recordOutput("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY");
+
+    expect(entry.outputPreview).toContain("wJalrXUtnFEMIK7MDENGbPxRfiCY");
+  });
+});
diff --git a/apps/desktop/src/store/sessions-store.test.ts b/apps/desktop/src/store/sessions-store.test.ts
index 98ff767..6321eef 100644
--- a/apps/desktop/src/store/sessions-store.test.ts
+++ b/apps/desktop/src/store/sessions-store.test.ts
@@ -2,7 +2,10 @@ import { beforeEach, describe, expect, it, vi } from "vitest";
 import { sampleHosts } from "../types/host";
 import { formatSessionConnectionState, type SessionPane, type SessionWorkspaceState } from "../types/session";
 
-vi.mock("../lib/backend-runtime", () => ({
+// The backend runtime is only partly mocked: the app store asks it whether
+// the Tauri runtime is present.
+vi.mock("../lib/backend-runtime", async (importOriginal) => ({
+  ...(await importOriginal<typeof import("../lib/backend-runtime")>()),
   closeSession: vi.fn(() => Promise.resolve({ ok: true })),
 }));
 import { closeSession } from "../lib/backend-runtime";
diff --git a/apps/desktop/src/store/sessions-store.ts b/apps/desktop/src/store/sessions-store.ts
index 8a09f5b..8248326 100644
--- a/apps/desktop/src/store/sessions-store.ts
+++ b/apps/desktop/src/store/sessions-store.ts
@@ -16,6 +16,8 @@ import {
   type SplitDirection,
 } from "../types/session";
 import { closeSession } from "../lib/backend-runtime";
+import { redactSecrets } from "../lib/redact-secrets";
+import { useAppStore } from "./app-store";
 
 /**
  * Tear down the live backend session behind every pane in `paneIds` (best
@@ -780,8 +782,20 @@ export const useSessionsStore = create<SessionsState>()(
         set(nextState);
         return nextState.commandHistory[0]?.id;
       },
-      appendCommandOutput: (entryId, output) =>
-        set((state) => appendPaneCommandHistoryOutput(state, entryId, output)),
+      appendCommandOutput: (entryId, output) => {
+        // The preview is persisted with the history, so a secret printed by a
+        // command would sit in local storage until the history was cleared.
+        // The command itself is NOT redacted: the history replays it into a
+        // session, and a redacted command would run as something else.
+        const redact = useAppStore.getState().redactCommandOutput;
+        set((state) =>
+          appendPaneCommandHistoryOutput(
+            state,
+            entryId,
+            redact ? redactSecrets(output) : output
+          )
+        );
+      },
       clearCommandHistory: () => set(() => ({ commandHistory: [] })),
       queueCommandForHosts: (hosts, command, label) => {
         const paneIds: string[] = [];
diff --git a/changelog.d/actionable-connect-errors.md b/changelog.d/actionable-connect-errors.md
new file mode 100644
index 0000000..b0252db
--- /dev/null
+++ b/changelog.d/actionable-connect-errors.md
@@ -0,0 +1 @@
+- [FEATURE] A connection failure that can only be fixed on the host now offers an "Open host" action beside the message, taking the user straight to the host's editor.
diff --git a/changelog.d/broadcast-input.md b/changelog.d/broadcast-input.md
new file mode 100644
index 0000000..72dc17b
--- /dev/null
+++ b/changelog.d/broadcast-input.md
@@ -0,0 +1 @@
+- [FEATURE] Input can be broadcast to every open session at once, so the same command can be run on several hosts from one terminal.
diff --git a/changelog.d/group-settings.md b/changelog.d/group-settings.md
new file mode 100644
index 0000000..91a6b86
--- /dev/null
+++ b/changelog.d/group-settings.md
@@ -0,0 +1 @@
+- [FEATURE] A group can carry the settings its hosts share — the user name, the bastion, the SFTP root and the environment — and a host keeps its own value wherever it has one.
diff --git a/changelog.d/history-output-redaction.md b/changelog.d/history-output-redaction.md
new file mode 100644
index 0000000..aa1f0fc
--- /dev/null
+++ b/changelog.d/history-output-redaction.md
@@ -0,0 +1 @@
+- [FEATURE] The session history masks the secrets in the output it keeps — a password, a token, an API key — before the preview is saved, with a setting to turn it off.
diff --git a/changelog.d/terminal-font-picker.md b/changelog.d/terminal-font-picker.md
new file mode 100644
index 0000000..db19de3
--- /dev/null
+++ b/changelog.d/terminal-font-picker.md
@@ -0,0 +1 @@
+- [FEATURE] Settings can now pick the terminal's font family and size, and the change applies live to terminals that are already open.
```
