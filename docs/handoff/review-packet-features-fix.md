# Follow-up review packet — the findings, and what changed about them

## What you are reviewing

- Repository: `SureForgeTech/sureforge-terminal`
- Read-only checkout: `/workspace/sureforge-terminal` (now at the head below; do not modify it)
- Previous head you reviewed: `33151d4ae8b75cf6b399feabb9510d6c431509d7` (your verdict: BLOCK, 1 P0 / 5 P1 / 3 P2-P3)
- Head under review now: `7fdcc1be49341aa801821d169925ae6a481dd166`
- Base of the whole feature range (unchanged): `4d24bdb0055cfecb1e8d013a2155663768e25700`

One commit was added on top of the head you reviewed: `7fdcc1b fix(features): what the review of the five features found`. Nothing below it changed — the five feature commits are byte-identical to the ones you reviewed.

## How to verify

Work from the checkout at `7fdcc1b`. For each finding you raised, decide whether it is actually fixed, by reading the code and by running the tests. Re-derive the answer; do not take the description below as evidence that the fix works.

The complete diff of the new commit is at the end of this packet, and is also in `/tmp/opencode/features-fix-33151d4..7fdcc1b.diff`.

## The findings, and where each was addressed

**P0 — streamed output persisted a secret split across chunks.** `apps/desktop/src/store/sessions-store.ts`: the raw output of a history entry is now kept in memory (a module-level map, never written into the store state, so it cannot be persisted) and the preview is always the redacted form of the WHOLE output. The escape codes are stripped before the redaction. `setPaneCommandHistoryOutput` replaced `appendPaneCommandHistoryOutput` because the preview can no longer be built by appending redacted pieces.

**P1.1 — camelCase credentials and `github_pat_` tokens were not masked.** `apps/desktop/src/lib/redact-secrets.ts`: the assignment pattern now captures the name on its own, and the name is checked word by word (`secretNameWords`, `isSecretName`). The GitHub fine-grained token shape was added.

**P1.2 — a fresh connection dropped the host's group.** `apps/desktop/src/lib/connections.ts`: `group` is part of `BackendConnectionHost`. `apps/desktop/src/components/terminal/terminal-pane-native-session.ts` passes `group: readLatestHost().group`.

**P1.3 — the host editor could not leave a value to the group.** `apps/desktop/src/components/hosts/HostEditor.tsx` and `apps/desktop/src/store/hosts-store.ts`: the user name is only required when neither the host nor the group has one; an empty SFTP root stays empty when the group supplies one.

**P1.4 — the broadcast registered under the host's id.** `apps/desktop/src/components/terminal/use-terminal-pane-lifecycle.ts` and `use-terminal-pane-session.ts`: the lifecycle takes a `paneId` and registers the sender under it.

**P1.5 — the broadcast counted panes that were not live, and could not be turned off.** `apps/desktop/src/store/broadcast-store.ts`, `apps/desktop/src/components/terminal/broadcast-participants.ts`, `apps/desktop/src/components/terminal/TerminalWorkspace.tsx`: the senders report whether they actually sent; the live participants are the connected panes with a terminal; the membership follows them; the two-session rule applies only to turning the broadcast on.

**P2/P3.** `apps/desktop/src/lib/terminal-fonts.ts` (own-property check), `apps/desktop/src/components/common/ConnectErrorBanner.test.tsx` (asserts the route), and the `changelog.d/` fragments: the `(#N)` suffix is the pull request's number, which does not exist until the pull request is opened, and adding it would change the head after the review — the roll script accepts the fragments as they are.

## Validation on the new head

```
$ npm run validate
  Test Files  203 passed (203)
       Tests  1152 passed | 1 skipped (1153)
  ✓ built in ...
  [validate] Docker is unavailable, so semgrep could not run.
exit status: 1
```

Exit 1 is the Docker-gated Semgrep step alone, exactly as on the base commit. `tsc -b` and ESLint are clean.

## What to check

- Whether each finding is genuinely fixed — reproduce the way you reproduced it the first time.
- Whether the fixes are complete: the P0 in particular has to hold on the real streaming path, not only in the test.
- Whether the fixes broke anything else: the redaction now replaces the preview instead of appending to it, the connection host type changed, the host editor's validation changed, the broadcast's sender contract changed, and the workspace now derives its participants.
- Whether the new tests would still pass if the fix were reverted — a test that does not fail without the fix is not evidence.
- Anything the fixes introduced that is itself a P0 or P1.

The bar is unchanged: zero unresolved P0 or P1 findings.

## Complete diff of the new commit

```diff
diff --git a/apps/desktop/src/components/common/ConnectErrorBanner.test.tsx b/apps/desktop/src/components/common/ConnectErrorBanner.test.tsx
index cc72b68..684cf91 100644
--- a/apps/desktop/src/components/common/ConnectErrorBanner.test.tsx
+++ b/apps/desktop/src/components/common/ConnectErrorBanner.test.tsx
@@ -13,16 +13,29 @@
 // This pins the banner contract: the message reaches the screen, it is
 // announced to assistive tech, and the user can dismiss it.
 import { cleanup, fireEvent, render, screen } from "@testing-library/react";
-import { MemoryRouter } from "react-router-dom";
+import { MemoryRouter, useLocation } from "react-router-dom";
 import { afterEach, beforeEach, describe, expect, it } from "vitest";
 import { ConnectErrorBanner } from "./ConnectErrorBanner";
 import { useConnectErrorStore } from "../../store/connect-error-store";
 
+/**
+ * Where the router is.
+ *
+ * The action has to take the user to the host that has to change, so the
+ * route it navigates to is part of the contract: a banner that only
+ * cleared itself would pass a test that only checked the banner went away.
+ */
+function CurrentRoute() {
+  const location = useLocation();
+  return <span data-testid="current-route">{`${location.pathname}${location.search}`}</span>;
+}
+
 // The banner's action navigates, so it lives inside the router the app has.
 function renderBanner() {
   return render(
-    <MemoryRouter>
+    <MemoryRouter initialEntries={["/sessions"]}>
       <ConnectErrorBanner />
+      <CurrentRoute />
     </MemoryRouter>
   );
 }
@@ -114,15 +127,19 @@ describe("ConnectErrorBanner with an action", () => {
     expect(screen.queryByRole("button", { name: "Open host" })).toBeNull();
   });
 
-  it("clears the banner when the action is taken", () => {
+  it("takes the user to the host when the action is taken", () => {
     useConnectErrorStore.getState().setConnectError("The host key could not be approved.", "error", {
       label: "Open host",
       href: "/hosts?edit=host-1",
     });
 
     renderBanner();
+    expect(screen.getByTestId("current-route").textContent).toBe("/sessions");
+
     fireEvent.click(screen.getByRole("button", { name: "Open host" }));
 
+    // The banner goes, and the user lands on the host's editor.
     expect(screen.queryByRole("alert")).toBeNull();
+    expect(screen.getByTestId("current-route").textContent).toBe("/hosts?edit=host-1");
   });
 });
diff --git a/apps/desktop/src/components/hosts/HostEditor.tsx b/apps/desktop/src/components/hosts/HostEditor.tsx
index 463e36d..351398f 100644
--- a/apps/desktop/src/components/hosts/HostEditor.tsx
+++ b/apps/desktop/src/components/hosts/HostEditor.tsx
@@ -20,6 +20,10 @@ import {
   type ConnectionSecretRecord,
   useConnectionSecretsStore,
 } from "../../store/connection-secrets-store";
+import {
+  groupSettingsFor,
+  useGroupSettingsStore,
+} from "../../store/group-settings-store";
 import { useHostsStore } from "../../store/hosts-store";
 import { useIdentitiesStore } from "../../store/identities-store";
 import type { IdentityRecord } from "../../types/identity";
@@ -138,6 +142,13 @@ function HostEditorContent({
   const supportsSftp = hostSupportsSftp(values.protocol);
   const supportsNetworkFields = values.protocol !== "localShell";
   const requiresUsername = protocolRequiresUsername(values.protocol);
+  // The group's settings are defaults for the hosts in it: a host that
+  // leaves the user name or the SFTP root empty takes the group's, so the
+  // form must not insist on a value the group already supplies.
+  const groupSettings = useGroupSettingsStore((state) => state.groupSettings);
+  const groupDefaults = groupSettingsFor(groupSettings, values.group.trim());
+  const groupUsername = groupDefaults?.username?.trim() ?? "";
+  const groupSftpRoot = groupDefaults?.sftpRoot?.trim() ?? "";
   const hostnameLabel = values.protocol === "serial" ? "Device path" : "Hostname";
   const hostnamePlaceholder =
     values.protocol === "serial" ? "/dev/cu.usbserial-1410" : "bastion.acme.internal";
@@ -170,7 +181,9 @@ function HostEditorContent({
         : "A hostname is required."
       : null;
   const usernameError =
-    requiresUsername && !values.username.trim() ? "A username is required." : null;
+    requiresUsername && !values.username.trim() && !groupUsername
+      ? "A username is required."
+      : null;
   const portError = supportsNetworkFields
     ? validatePortOrBaudRate(values.port, values.protocol)
     : null;
@@ -181,7 +194,7 @@ function HostEditorContent({
   const isInvalid =
     !values.label.trim() ||
     (supportsNetworkFields && !values.hostname.trim()) ||
-    (requiresUsername && !values.username.trim()) ||
+    (requiresUsername && !values.username.trim() && !groupUsername) ||
     portError !== null;
   const jumpHostOptions = hosts.filter(
     (candidate) => candidate.id !== host?.id && candidate.protocol === "ssh"
@@ -355,7 +368,8 @@ function HostEditorContent({
                 jumpHostId: hostSupportsJumpHosts(protocol) ? current.jumpHostId : "",
                 agentForwarding: hostSupportsCredentialPrompt(protocol) ? current.agentForwarding : false,
                 keyLabel: hostSupportsCredentialPrompt(protocol) ? current.keyLabel : "",
-                sftpRoot: hostSupportsSftp(protocol) ? current.sftpRoot || "/home" : "",
+                // An empty root is left empty: it means "the group's root".
+                sftpRoot: hostSupportsSftp(protocol) ? current.sftpRoot : "",
               }));
             }}
             className={fieldClassName}
@@ -401,7 +415,7 @@ function HostEditorContent({
               value={values.username}
               onChange={(event) => setValues((current) => ({ ...current, username: event.target.value }))}
               className={fieldClassName}
-              placeholder="ops"
+              placeholder={groupUsername ? `inherited from the group: ${groupUsername}` : "ops"}
               aria-invalid={usernameError ? true : undefined}
               aria-describedby={usernameError ? `${formId}-username-error` : undefined}
             />
@@ -671,7 +685,18 @@ function HostEditorContent({
           <span className="text-sm text-slate-300">Group</span>
           <input
             value={values.group}
-            onChange={(event) => setValues((current) => ({ ...current, group: event.target.value }))}
+            onChange={(event) => {
+              const group = event.target.value;
+              setValues((current) => {
+                const groupSftpRoot = groupSettingsFor(groupSettings, group.trim())?.sftpRoot?.trim();
+                // The form starts with the default SFTP root. A group that
+                // supplies one takes it over, so the host inherits instead
+                // of carrying a root it never chose.
+                const sftpRoot =
+                  groupSftpRoot && current.sftpRoot === "/home" ? "" : current.sftpRoot;
+                return { ...current, group, sftpRoot };
+              });
+            }}
             className={fieldClassName}
             placeholder="Acme / Production"
           />
@@ -703,7 +728,7 @@ function HostEditorContent({
             value={values.sftpRoot}
             onChange={(event) => setValues((current) => ({ ...current, sftpRoot: event.target.value }))}
             className={fieldClassName}
-            placeholder="/srv"
+            placeholder={groupSftpRoot ? `inherited from the group: ${groupSftpRoot}` : "/srv"}
           />
         </label>
         ) : null}
diff --git a/apps/desktop/src/components/terminal/TerminalWorkspace.tsx b/apps/desktop/src/components/terminal/TerminalWorkspace.tsx
index ae6e685..2781093 100644
--- a/apps/desktop/src/components/terminal/TerminalWorkspace.tsx
+++ b/apps/desktop/src/components/terminal/TerminalWorkspace.tsx
@@ -1,16 +1,22 @@
-import { useEffect, useMemo, useState } from "react";
+import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
 import { useSessions } from "../../hooks/useSessions";
 import { describeHostRuntime, formatHostAddress } from "../../lib/utils";
 import { SearchInput } from "../common/SearchInput";
 import { buildHostSearchText } from "../../lib/utils";
 import { useHostsStore } from "../../store/hosts-store";
 import { useCloseGuardStore } from "../../store/close-guard-store";
-import { useBroadcastStore } from "../../store/broadcast-store";
+import {
+  countBroadcastSenders,
+  hasBroadcastSender,
+  subscribeBroadcastSenders,
+  useBroadcastStore,
+} from "../../store/broadcast-store";
 import { useSessionsStore } from "../../store/sessions-store";
 import { hostSupportsPortForwarding, type HostRecord } from "../../types/host";
 import { ErrorBoundary, ScopedErrorFallback } from "../ErrorBoundary";
 import { EmptyState } from "../common/EmptyState";
 import { PortForwardPanel } from "./PortForwardPanel";
+import { selectLiveBroadcastPanes } from "./broadcast-participants";
 import { SplitLayout } from "./SplitLayout";
 import { TerminalPane } from "./TerminalPane";
 import { TabContextMenu, type TabContextMenuPayload } from "./TabContextMenu";
@@ -34,11 +40,40 @@ export function TerminalWorkspace({ launchHost }: TerminalWorkspaceProps) {
   const broadcastEnabled = useBroadcastStore((state) => state.enabled);
   const setBroadcastEnabled = useBroadcastStore((state) => state.setEnabled);
   const setBroadcastPanes = useBroadcastStore((state) => state.setAllPanes);
-  const openPaneIds = useSessionsStore((state) =>
-    Object.values(state.panes)
-      .filter((pane) => pane.transport !== "mock")
-      .map((pane) => pane.id)
+  const broadcastPaneIds = useBroadcastStore((state) => state.paneIds);
+  // The broadcast reaches the PANES that are actually live: a pane whose
+  // session is connected and whose terminal is on screen. A restored tab
+  // that is not open, a pane still waiting for a secret and a mock session
+  // are not taking part, and neither is a pane whose session has dropped.
+  const sessionPanes = useSessionsStore((state) => state.panes);
+  const senderCount = useSyncExternalStore(
+    subscribeBroadcastSenders,
+    countBroadcastSenders
   );
+  const livePaneIds = useMemo(
+    () => {
+      // Without a registered terminal there is nothing that can receive a
+      // broadcast, whatever the sessions say.
+      if (senderCount === 0) {
+        return [];
+      }
+      return selectLiveBroadcastPanes(sessionPanes, hasBroadcastSender);
+    },
+    [sessionPanes, senderCount]
+  );
+  const livePaneKey = livePaneIds.join(",");
+  // The membership follows the live panes: a session that opens joins the
+  // broadcast, and a session that closes leaves it. Without this the banner
+  // would count a session the broadcast does not reach.
+  useEffect(() => {
+    if (!broadcastEnabled) {
+      return;
+    }
+    if (livePaneKey !== broadcastPaneIds.join(",")) {
+      setBroadcastPanes(livePaneIds);
+    }
+    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the stable value of the list
+  }, [broadcastEnabled, livePaneKey]);
   const selectTab = useSessionsStore((state) => state.selectTab);
   const splitTab = useSessionsStore((state) => state.splitTab);
   const closePane = useSessionsStore((state) => state.closePane);
@@ -143,8 +178,8 @@ export function TerminalWorkspace({ launchHost }: TerminalWorkspaceProps) {
           role="status"
           className="rounded-[14px] border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-sm text-amber-100"
         >
-          Broadcast is on: what you type goes to every open session ({openPaneIds.length}). Turn it off
-          to type into one session again.
+          Broadcast is on: what you type goes to every open session ({broadcastPaneIds.length}). Turn
+          it off to type into one session again.
         </div>
       ) : null}
 
@@ -166,19 +201,26 @@ export function TerminalWorkspace({ launchHost }: TerminalWorkspaceProps) {
               <button
                 type="button"
                 aria-pressed={broadcastEnabled}
-                disabled={openPaneIds.length < 2}
+                // The two-session rule applies to turning the broadcast ON.
+                // While it is on, the button stays usable: a pane that
+                // closed must not leave the user unable to turn it off.
+                disabled={!broadcastEnabled && livePaneIds.length < 2}
                 onClick={() => {
                   const next = !broadcastEnabled;
-                  // Turning it on sends to every open pane; turning it off
+                  // Turning it on sends to every live pane; turning it off
                   // empties the set, so a later broadcast never reaches a
                   // session the user has closed.
-                  setBroadcastPanes(openPaneIds);
+                  if (next) {
+                    setBroadcastPanes(livePaneIds);
+                  }
                   setBroadcastEnabled(next);
                 }}
                 title={
-                  openPaneIds.length < 2
-                    ? "Open a second session to broadcast input to"
-                    : "Send what you type to every open session"
+                  broadcastEnabled
+                    ? "Turn the broadcast off"
+                    : livePaneIds.length < 2
+                      ? "Open a second session to broadcast input to"
+                      : "Send what you type to every open session"
                 }
                 className={
                   broadcastEnabled
diff --git a/apps/desktop/src/components/terminal/broadcast-participants.test.ts b/apps/desktop/src/components/terminal/broadcast-participants.test.ts
new file mode 100644
index 0000000..e993f7c
--- /dev/null
+++ b/apps/desktop/src/components/terminal/broadcast-participants.test.ts
@@ -0,0 +1,76 @@
+import { describe, expect, it } from "vitest";
+
+import { selectLiveBroadcastPanes } from "./broadcast-participants";
+import { type SessionPane } from "../../types/session";
+
+// Which panes can take part in a broadcast.
+//
+// The broadcast reaches the panes that are actually live. A restored tab
+// that is not open, a pane still waiting for a secret, a mock session and a
+// pane whose session has dropped are not taking part — counting them as if
+// they were would put the wrong number on the banner and offer the
+// broadcast when it cannot deliver.
+
+function pane(overrides: Partial<SessionPane>): SessionPane {
+  return {
+    id: "pane-1",
+    hostId: "host-1",
+    title: "host-1",
+    connectionState: "connected",
+    transport: "ssh",
+    queuedCommands: [],
+    reconnectOnRestore: false,
+    persistOutputPreview: true,
+    createdAt: "2026-11-18T00:00:00.000Z",
+    updatedAt: "2026-11-18T00:00:00.000Z",
+    ...overrides,
+  };
+}
+
+describe("the panes that can take part in a broadcast", () => {
+  it("takes the connected panes that have a terminal", () => {
+    const panes = {
+      "pane-1": pane({ id: "pane-1" }),
+      "pane-2": pane({ id: "pane-2" }),
+    };
+
+    expect(selectLiveBroadcastPanes(panes, () => true)).toEqual(["pane-1", "pane-2"]);
+  });
+
+  it("leaves out a pane that is not connected", () => {
+    const panes = {
+      "pane-1": pane({ id: "pane-1" }),
+      "pane-2": pane({ id: "pane-2", connectionState: "disconnected" }),
+      "pane-3": pane({ id: "pane-3", connectionState: "connecting" }),
+      "pane-4": pane({ id: "pane-4", connectionState: "pendingSecrets" }),
+      "pane-5": pane({ id: "pane-5", connectionState: "error" }),
+    };
+
+    expect(selectLiveBroadcastPanes(panes, () => true)).toEqual(["pane-1"]);
+  });
+
+  it("leaves out a pane with no terminal", () => {
+    // A pane whose terminal is not on screen cannot receive anything.
+    const panes = {
+      "pane-1": pane({ id: "pane-1" }),
+      "pane-2": pane({ id: "pane-2" }),
+    };
+
+    expect(selectLiveBroadcastPanes(panes, (paneId) => paneId === "pane-1")).toEqual([
+      "pane-1",
+    ]);
+  });
+
+  it("leaves out a mock session", () => {
+    const panes = {
+      "pane-1": pane({ id: "pane-1", transport: "mock" }),
+      "pane-2": pane({ id: "pane-2" }),
+    };
+
+    expect(selectLiveBroadcastPanes(panes, () => true)).toEqual(["pane-2"]);
+  });
+
+  it("returns nothing when there is no pane at all", () => {
+    expect(selectLiveBroadcastPanes({}, () => true)).toEqual([]);
+  });
+});
diff --git a/apps/desktop/src/components/terminal/broadcast-participants.ts b/apps/desktop/src/components/terminal/broadcast-participants.ts
new file mode 100644
index 0000000..2a96e34
--- /dev/null
+++ b/apps/desktop/src/components/terminal/broadcast-participants.ts
@@ -0,0 +1,27 @@
+import { type SessionPane } from "../../types/session";
+
+/**
+ * The panes that can take part in a broadcast right now.
+ *
+ * A pane takes part when its session is CONNECTED and its terminal is on
+ * screen. A restored tab that is not open, a pane still waiting for a
+ * secret, a mock session and a pane whose session has dropped are not
+ * taking part — and counting them as if they were would put the wrong
+ * number on the banner and offer the broadcast when it cannot deliver.
+ *
+ * The pane ids are sorted so the list is stable between renders.
+ */
+export function selectLiveBroadcastPanes(
+  panes: Record<string, SessionPane>,
+  hasSender: (paneId: string) => boolean
+): string[] {
+  return Object.values(panes)
+    .filter(
+      (pane) =>
+        pane.transport !== "mock" &&
+        pane.connectionState === "connected" &&
+        hasSender(pane.id)
+    )
+    .map((pane) => pane.id)
+    .sort();
+}
diff --git a/apps/desktop/src/components/terminal/terminal-pane-native-session.ts b/apps/desktop/src/components/terminal/terminal-pane-native-session.ts
index 32dd781..5d1fb94 100644
--- a/apps/desktop/src/components/terminal/terminal-pane-native-session.ts
+++ b/apps/desktop/src/components/terminal/terminal-pane-native-session.ts
@@ -329,6 +329,11 @@ export function createTerminalPaneNativeSessionController(options: TerminalPaneN
                 agentForwarding,
                 authMethod,
                 environment: stableEnvironment,
+                // The group is what a group's settings hang off, so a fresh
+                // connection has to carry it: without it the group's user
+                // name, bastion, environment and SFTP root were ignored on
+                // every new session.
+                group: readLatestHost().group,
                 hostKeyPolicy,
                 hostname,
                 id,
diff --git a/apps/desktop/src/components/terminal/use-terminal-pane-lifecycle.ts b/apps/desktop/src/components/terminal/use-terminal-pane-lifecycle.ts
index 24d4512..8e60f9c 100644
--- a/apps/desktop/src/components/terminal/use-terminal-pane-lifecycle.ts
+++ b/apps/desktop/src/components/terminal/use-terminal-pane-lifecycle.ts
@@ -54,6 +54,13 @@ interface TerminalPaneLifecycleOptions {
   hostKeyPolicy: HostRecord["hostKeyPolicy"];
   hostname: HostRecord["hostname"];
   id: HostRecord["id"];
+  /**
+   * The pane's own id.
+   *
+   * A pane is not a host: a host can be open in two panes at once, and the
+   * broadcast works on PANES. The host id is kept for the session itself.
+   */
+  paneId: string;
   initialPaletteRef: MutableRefObject<TerminalAnsiPalette>;
   /** The terminal's font family and size, from the font picker. */
   terminalFontStack: string;
@@ -117,6 +124,7 @@ export function useTerminalPaneLifecycle({
   hostKeyPolicy,
   hostname,
   id,
+  paneId,
   initialPaletteRef,
   terminalFontStack,
   terminalFontSize,
@@ -349,16 +357,20 @@ export function useTerminalPaneLifecycle({
 
     // A pane joins the broadcast by registering a sender for its own input.
     // The sender reads the socket when it is called, so it always sends to the
-    // session the pane has NOW, not the one it had when it registered.
-    const unregisterBroadcastSender = registerBroadcastSender(id, (data) => {
+    // session the pane has NOW, not the one it had when it registered — and
+    // it reports whether it sent, so a pane whose session has dropped is
+    // skipped rather than counted.
+    const unregisterBroadcastSender = registerBroadcastSender(paneId, (data) => {
       const socket = socketRef.current;
-      if (socket?.readyState === WebSocket.OPEN) {
-        socket.send(JSON.stringify({ type: "input", data }));
+      if (socket?.readyState !== WebSocket.OPEN) {
+        return false;
       }
+      socket.send(JSON.stringify({ type: "input", data }));
+      return true;
     });
 
     const { contextMenuHandler, dataDisposable, selectionDisposable } = attachTerminalPaneInputWiring({
-      paneId: id,
+      paneId,
       commandBufferRef,
       connectionStateRef,
       container,
@@ -409,6 +421,7 @@ export function useTerminalPaneLifecycle({
     hostname,
     hostKeyPolicy,
     id,
+    paneId,
     label,
     demoModeEnabled,
     protocol,
diff --git a/apps/desktop/src/components/terminal/use-terminal-pane-lifecycle.unmount.test.tsx b/apps/desktop/src/components/terminal/use-terminal-pane-lifecycle.unmount.test.tsx
index 49d3e77..2dfa523 100644
--- a/apps/desktop/src/components/terminal/use-terminal-pane-lifecycle.unmount.test.tsx
+++ b/apps/desktop/src/components/terminal/use-terminal-pane-lifecycle.unmount.test.tsx
@@ -140,6 +140,7 @@ describe("useTerminalPaneLifecycle unmount", () => {
         hostname: host.hostname,
         id: host.id,
         initialPaletteRef: ref({} as never),
+        paneId: "pane-1",
         terminalFontStack: '"SFMono-Regular", "Menlo", "Monaco", monospace',
         terminalFontSize: 13,
         intentionalDisconnectRef: ref(false),
@@ -205,4 +206,89 @@ describe("useTerminalPaneLifecycle unmount", () => {
     vi.advanceTimersByTime(5000);
     expect(reconnect).not.toHaveBeenCalled();
   });
+
+  it("registers the broadcast sender under the pane's id, not the host's", async () => {
+    // A pane is not a host: the broadcast works on PANES, and a host can be
+    // open in two panes at once. Registering under the host's id would mean
+    // the broadcast could never find a recipient.
+    const { useTerminalPaneLifecycle } = await import("./use-terminal-pane-lifecycle");
+    const { hasBroadcastSender } = await import("../../store/broadcast-store");
+
+    const container = document.createElement("div");
+    document.body.appendChild(container);
+    const containerRef = createRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement | null>;
+    containerRef.current = container;
+
+    const socketRef = ref<unknown>(null) as MutableRefObject<never>;
+
+    const { unmount } = renderHook(() =>
+      useTerminalPaneLifecycle({
+        activeHistoryEntryIdRef: ref<string | undefined>(undefined),
+        agentForwarding: false as HostRecord["agentForwarding"],
+        appendCommandOutput: vi.fn(),
+        authMethod: host.authMethod,
+        backendSessionIdRef: ref<string | undefined>(undefined),
+        clipboardNoticeRef: ref<(message: string) => void>(() => {}),
+        screenReaderModeRef: ref(true),
+        commandBufferRef: ref(""),
+        contextMenuRequestRef: ref<(position: { x: number; y: number }) => void>(() => {}),
+        connectedOnceRef: ref(false),
+        connectingRef: ref(false),
+        connectionStateRef: ref(pane.connectionState),
+        consumePaneCommand: vi.fn(),
+        containerRef,
+        demoModeEnabled: true,
+        dispatchCommandRef: ref(() => {}),
+        ensureConnectedRef: ref(() => {}),
+        fitAddonRef: ref(null),
+        group: host.group,
+        host,
+        hostKeyPolicy: undefined as unknown as HostRecord["hostKeyPolicy"],
+        hostname: host.hostname,
+        id: host.id,
+        initialPaletteRef: ref({} as never),
+        paneId: pane.id,
+        terminalFontStack: '"SFMono-Regular", "Menlo", "Monaco", monospace',
+        terminalFontSize: 13,
+        intentionalDisconnectRef: ref(false),
+        label: host.label,
+        nativeBridgeEnabled: false,
+        pane,
+        pendingSecretsNoticeShownRef: ref(false),
+        port: host.port,
+        privateKeyPath: host.privateKeyPath,
+        protocol: host.protocol,
+        protocolLabel: "SSH",
+        reconnectAttemptRef: ref(0),
+        reconnectOnRestoreRef: ref(false),
+        reconnectTimeoutRef: ref<number | null>(null),
+        recordPaneCommand: vi.fn(),
+        runtimeStatusRef: ref(null),
+        setPaneBackendSession: vi.fn(),
+        setPaneReconnectOnRestore: vi.fn(),
+        setPaneState: vi.fn(),
+        setPaneTransport: vi.fn(),
+        setRuntimeStatusMessage: vi.fn(),
+        setSearchOpen: vi.fn(),
+        sftpRoot: undefined as unknown as HostRecord["sftpRoot"],
+        socketRef,
+        stableEnvironment: undefined as unknown as HostRecord["environment"],
+        stableTags: host.tags,
+        terminalRef: ref(null),
+        toggleConnectionRef: ref(() => {}),
+        transportRef: ref(pane.transport),
+        unsupportedTransport: false,
+        useMockTransport: true,
+        username: host.username,
+      })
+    );
+
+    expect(hasBroadcastSender(pane.id)).toBe(true);
+    expect(hasBroadcastSender(host.id)).toBe(false);
+
+    unmount();
+
+    // A closed pane leaves the broadcast.
+    expect(hasBroadcastSender(pane.id)).toBe(false);
+  });
 });
diff --git a/apps/desktop/src/components/terminal/use-terminal-pane-session.ts b/apps/desktop/src/components/terminal/use-terminal-pane-session.ts
index b42f194..9669d7a 100644
--- a/apps/desktop/src/components/terminal/use-terminal-pane-session.ts
+++ b/apps/desktop/src/components/terminal/use-terminal-pane-session.ts
@@ -218,6 +218,9 @@ export function useTerminalPaneSession({
     nativeBridgeEnabled,
     pane,
     pendingSecretsNoticeShownRef,
+    // The broadcast works on panes, not on hosts: a host can be open in two
+    // panes at once, and each pane takes part in its own right.
+    paneId: pane.id,
     port,
     privateKeyPath,
     protocol,
diff --git a/apps/desktop/src/lib/connections.test.ts b/apps/desktop/src/lib/connections.test.ts
index 4883c5e..8254328 100644
--- a/apps/desktop/src/lib/connections.test.ts
+++ b/apps/desktop/src/lib/connections.test.ts
@@ -2,14 +2,17 @@ import { afterEach, describe, expect, it } from "vitest";
 import { buildBackendConnection, buildBackendConnectionFromKnownHost } from "./connections";
 import { useConnectionSecretsStore } from "../store/connection-secrets-store";
 import { useHostsStore } from "../store/hosts-store";
+import { useGroupSettingsStore } from "../store/group-settings-store";
 import { useIdentitiesStore } from "../store/identities-store";
 import type { IdentityRecord } from "../types/identity";
 import type { KnownHostRecord } from "../types/known-host";
 
 const initialIdentitiesState = useIdentitiesStore.getState();
+const initialGroupSettingsState = useGroupSettingsStore.getState();
 
 afterEach(() => {
   useIdentitiesStore.setState(initialIdentitiesState);
+  useGroupSettingsStore.setState(initialGroupSettingsState);
 });
 
 const trustedKnownHost: KnownHostRecord = {
@@ -30,6 +33,7 @@ const baseHost = {
     APP_ENV: "local",
     TERMSNIP_TEST: "enabled",
   },
+  group: "Local / Validation",
   hostKeyPolicy: "allowUnknown" as const,
   hostname: "127.0.0.1",
   id: "local-test",
@@ -83,6 +87,55 @@ describe("connection helpers", () => {
     expect(connection.knownHostAlgorithm).toBe(trustedKnownHost.algorithm);
   });
 
+  it("applies the group's settings to a host that does not set them", () => {
+    // The group's settings are defaults for the hosts in it, and they are
+    // applied where the connection is built — so a host that leaves the user
+    // name, the SFTP root and the environment empty takes the group's.
+    useGroupSettingsStore.getState().setGroupSettings("Local / Validation", {
+      username: "ops",
+      sftpRoot: "/srv/app",
+      environment: { REGION: "eu-west-1" },
+    });
+
+    const connection = buildBackendConnection(
+      {
+        ...baseHost,
+        username: "",
+        sftpRoot: "",
+        environment: {},
+      },
+      []
+    );
+
+    expect(connection.username).toBe("ops");
+    expect(connection.sftpRoot).toBe("/srv/app");
+    expect(connection.environment).toEqual({ REGION: "eu-west-1" });
+  });
+
+  it("keeps the host's own settings over the group's", () => {
+    useGroupSettingsStore.getState().setGroupSettings("Local / Validation", {
+      username: "ops",
+      sftpRoot: "/srv/app",
+      environment: { REGION: "eu-west-1", TIER: "web" },
+    });
+
+    const connection = buildBackendConnection(
+      {
+        ...baseHost,
+        username: "root",
+        sftpRoot: "/home/root",
+        environment: { REGION: "us-east-1" },
+      },
+      []
+    );
+
+    expect(connection.username).toBe("root");
+    expect(connection.sftpRoot).toBe("/home/root");
+    // The environment is merged per key: the host's own value wins, and the
+    // group's other keys still come through.
+    expect(connection.environment).toEqual({ REGION: "us-east-1", TIER: "web" });
+  });
+
   it("builds a one-hop jump host chain", () => {
     useConnectionSecretsStore.getState().setHostSecrets("jump-host", {
       password: "",
diff --git a/apps/desktop/src/lib/connections.ts b/apps/desktop/src/lib/connections.ts
index 101139b..f3c8b1b 100644
--- a/apps/desktop/src/lib/connections.ts
+++ b/apps/desktop/src/lib/connections.ts
@@ -11,11 +11,20 @@ import { useIdentitiesStore } from "../store/identities-store";
 import { resolveIdentityForHost } from "./host-identity-resolver";
 import type { KnownHostRecord } from "../types/known-host";
 
+/**
+ * The host fields a connection is built from.
+ *
+ * The group is part of it: a group's settings are defaults for the hosts in
+ * it, so a caller that builds a connection from a subset of a host's fields
+ * has to say which group the host is in, or the group's settings are
+ * silently ignored.
+ */
 type BackendConnectionHost = Pick<
   HostRecord,
   | "agentForwarding"
   | "authMethod"
   | "environment"
+  | "group"
   | "hostKeyPolicy"
   | "id"
   | "hostname"
@@ -53,7 +62,7 @@ function buildBackendConnectionRecursive(
   // that needs its own bastion still has one.
   const groupSettings = groupSettingsFor(
     useGroupSettingsStore.getState().groupSettings,
-    (host as { group?: string }).group
+    host.group
   );
   const effectiveHost = applyGroupSettings(host, groupSettings);
 
diff --git a/apps/desktop/src/lib/redact-secrets.test.ts b/apps/desktop/src/lib/redact-secrets.test.ts
index 36fc23e..1cd1da9 100644
--- a/apps/desktop/src/lib/redact-secrets.test.ts
+++ b/apps/desktop/src/lib/redact-secrets.test.ts
@@ -1,9 +1,15 @@
 import { describe, expect, it } from "vitest";
 
-import { REDACTION_PLACEHOLDER, containsSecret, redactSecrets } from "./redact-secrets";
+import {
+  REDACTION_PLACEHOLDER,
+  containsSecret,
+  isSecretName,
+  redactSecrets,
+  secretNameWords,
+} from "./redact-secrets";
 
 // The session history keeps a preview of what a command printed, and that
-// preview is persisted across relaunches. A command that prints a secret
+// preview is persisted across restarts. A command that prints a secret
 // leaves it in the history unless it is redacted — these tests pin the
 // redaction that keeps the history without keeping the secret.
 
@@ -19,9 +25,31 @@ describe("redacting secrets", () => {
     expect(redactSecrets("token: s3cr3t")).toBe(`token: ${REDACTION_PLACEHOLDER}`);
   });
 
+  it("masks a credential whose name is camelCase", () => {
+    // The name of a credential is a WORD, not a fixed string: "accessToken"
+    // is a secret and "tokenizer" is not, and the difference is where the
+    // word ends.
+    expect(redactSecrets('{"accessToken":"opaque-value"}')).toBe(
+      `{"accessToken":"${REDACTION_PLACEHOLDER}"}`
+    );
+    expect(redactSecrets("clientSecret=opaque-value")).toBe(
+      `clientSecret=${REDACTION_PLACEHOLDER}`
+    );
+    expect(redactSecrets("apiKey: opaque-value")).toBe(`apiKey: ${REDACTION_PLACEHOLDER}`);
+    expect(redactSecrets("privateKey=opaque-value")).toBe(
+      `privateKey=${REDACTION_PLACEHOLDER}`
+    );
+    expect(redactSecrets('{"refresh_token": "opaque-value"}')).toBe(
+      `{"refresh_token": "${REDACTION_PLACEHOLDER}"}`
+    );
+  });
+
   it("masks the token shapes that are secrets by construction", () => {
     expect(redactSecrets("AKIAIOSFODNN7EXAMPLE")).toBe(REDACTION_PLACEHOLDER);
     expect(redactSecrets("ghp_abcdefghijklmnopqrstuvwxyz012345")).toBe(REDACTION_PLACEHOLDER);
+    expect(redactSecrets("github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz")).toBe(
+      REDACTION_PLACEHOLDER
+    );
     expect(redactSecrets("glpat-abcdefghijklmnopqrst")).toBe(REDACTION_PLACEHOLDER);
     expect(redactSecrets("xoxb-1234567890-abcdefghij")).toBe(REDACTION_PLACEHOLDER);
     expect(
@@ -53,6 +81,9 @@ describe("redacting secrets", () => {
     expect(redactSecrets("authorisation: granted")).toBe("authorisation: granted");
     expect(redactSecrets("tokenizer=fast")).toBe("tokenizer=fast");
     expect(redactSecrets("secretary=alice")).toBe("secretary=alice");
+    // A bare "key" is a lookup far more often than a credential.
+    expect(redactSecrets("key=release")).toBe("key=release");
+    expect(redactSecrets("monkey=banana")).toBe("monkey=banana");
   });
 
   it("leaves an empty or already-redacted value alone", () => {
@@ -67,4 +98,18 @@ describe("redacting secrets", () => {
     expect(containsSecret("nothing here")).toBe(false);
     expect(containsSecret("")).toBe(false);
   });
+
+  it("splits a name into the words a credential is named after", () => {
+    expect(secretNameWords("AWS_SECRET_ACCESS_KEY")).toEqual([
+      "aws",
+      "secret",
+      "access",
+      "key",
+    ]);
+    expect(secretNameWords("accessToken")).toEqual(["access", "token"]);
+    expect(secretNameWords("api-key")).toEqual(["api", "key"]);
+    expect(isSecretName("accessToken")).toBe(true);
+    expect(isSecretName("tokenizer")).toBe(false);
+    expect(isSecretName("key")).toBe(false);
+  });
 });
diff --git a/apps/desktop/src/lib/redact-secrets.ts b/apps/desktop/src/lib/redact-secrets.ts
index 2c179fe..99f6d08 100644
--- a/apps/desktop/src/lib/redact-secrets.ts
+++ b/apps/desktop/src/lib/redact-secrets.ts
@@ -19,14 +19,43 @@
 /** What a redacted value is replaced with. */
 export const REDACTION_PLACEHOLDER = "[redacted]";
 
-// KEY=value, "key": "value", key: value — with a quoted or bare value.
+// The words a secret is usually stored under.
 //
-// The name has to be a sequence of components, one of which is a secret word.
-// That is what keeps "authorisation" (which contains "auth") and "tokenizer"
-// (which starts with "token") out: the secret word has to be a whole
-// component, and the name has to end at a word boundary.
-const SECRET_ASSIGNMENT_PATTERN =
-  /(["']?\b(?:[A-Za-z0-9]+[-_])*(?:pass(?:word|phrase)?|secret|token|api[-_]?key|access[-_]?key|credential|private[-_]?key)(?:[-_][A-Za-z0-9]+)*\b["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi;
+// The comparison is against the WORDS of a name, not against the name as a
+// whole: "accessToken" is a secret and "tokenizer" is not, and the only
+// difference is the word boundary. A plural counts ("secrets", "tokens",
+// "passwords"), and the match is case-insensitive.
+const SECRET_WORDS = new Set([
+  "password",
+  "passwd",
+  "passphrase",
+  "secret",
+  "token",
+  "credential",
+  "auth",
+  "apikey",
+  "accesskey",
+  "privatekey",
+]);
+
+// A name that pairs a qualifier with "key" is a secret: "apiKey",
+// "accessKey", "privateKey". A bare "key" is NOT — "key=value" is far more
+// often a lookup than a credential.
+const SECRET_KEY_QUALIFIERS = new Set([
+  "api",
+  "access",
+  "private",
+  "client",
+  "signing",
+  "encryption",
+  "ssh",
+]);
+
+// KEY=value, "key": "value", key: value — the name is captured on its own so
+// it can be checked word by word, and the separator is captured so the
+// replacement keeps the shape of the text.
+const ASSIGNMENT_PATTERN =
+  /(["']?)([A-Za-z0-9_][A-Za-z0-9_.-]*)\1(\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/g;
 
 // Well-known token shapes. Each is long enough and specific enough that a
 // false positive is very unlikely.
@@ -35,6 +64,8 @@ const TOKEN_PATTERNS: RegExp[] = [
   /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
   // GitHub tokens.
   /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
+  // GitHub fine-grained personal access tokens.
+  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
   // GitLab tokens.
   /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
   // Slack tokens.
@@ -45,6 +76,64 @@ const TOKEN_PATTERNS: RegExp[] = [
   /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
 ];
 
+/**
+ * The words of a name.
+ *
+ * "AWS_SECRET_ACCESS_KEY" becomes [aws, secret, access, key], "accessToken"
+ * becomes [access, token], and "api-key" becomes [api, key]. The separators
+ * are `-`, `_`, `.` and the case change in a camelCase name.
+ */
+export function secretNameWords(name: string): string[] {
+  return name
+    .replace(/^["']|["']$/g, "")
+    .split(/[^A-Za-z0-9]+/)
+    .flatMap((chunk) => chunk.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" "))
+    .filter((word) => word.length > 0)
+    .map((word) => word.toLowerCase());
+}
+
+function isSecretWord(word: string): boolean {
+  if (SECRET_WORDS.has(word)) {
+    return true;
+  }
+  // A plural is the same word.
+  if (word.length > 3 && word.endsWith("s")) {
+    return SECRET_WORDS.has(word.slice(0, -1));
+  }
+  return false;
+}
+
+function singular(word: string): string {
+  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
+}
+
+/**
+ * Whether a name is one a secret is stored under.
+ *
+ * The name is split into words and checked: a secret word anywhere in it
+ * makes it a secret name, and so does a qualified "key" ("apiKey").
+ */
+export function isSecretName(name: string): boolean {
+  const words = secretNameWords(name);
+
+  for (const word of words) {
+    if (isSecretWord(word)) {
+      return true;
+    }
+  }
+
+  for (let index = 0; index + 1 < words.length; index += 1) {
+    if (words[index + 1] !== "key" && words[index + 1] !== "keys") {
+      continue;
+    }
+    if (SECRET_KEY_QUALIFIERS.has(singular(words[index]))) {
+      return true;
+    }
+  }
+
+  return false;
+}
+
 /**
  * Mask the secrets in a piece of text.
  *
@@ -58,8 +147,18 @@ export function redactSecrets(text: string): string {
   }
 
   let redacted = text.replace(
-    SECRET_ASSIGNMENT_PATTERN,
-    (match: string, prefix: string, value: string) => {
+    ASSIGNMENT_PATTERN,
+    (
+      match: string,
+      quote: string,
+      name: string,
+      separator: string,
+      value: string
+    ) => {
+      if (!isSecretName(name)) {
+        return match;
+      }
+
       const inner = value.startsWith('"')
         ? value.slice(1, -1)
         : value.startsWith("'")
@@ -70,8 +169,9 @@ export function redactSecrets(text: string): string {
       if (!inner || inner === REDACTION_PLACEHOLDER) {
         return match;
       }
-      const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : "";
-      return `${prefix}${quote}${REDACTION_PLACEHOLDER}${quote}`;
+
+      const valueQuote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : "";
+      return `${quote}${name}${quote}${separator}${valueQuote}${REDACTION_PLACEHOLDER}${valueQuote}`;
     }
   );
 
diff --git a/apps/desktop/src/lib/terminal-fonts.test.ts b/apps/desktop/src/lib/terminal-fonts.test.ts
index 08f5816..51459c5 100644
--- a/apps/desktop/src/lib/terminal-fonts.test.ts
+++ b/apps/desktop/src/lib/terminal-fonts.test.ts
@@ -44,6 +44,21 @@ describe("terminal fonts", () => {
     }
   });
 
+  it("falls back to the default stack for an inherited property name", () => {
+    // "constructor" and "__proto__" are properties every object has, so a
+    // lookup that does not check for an OWN property would hand the
+    // terminal something that is not a font.
+    expect(resolveTerminalFontStack("constructor")).toBe(
+      resolveTerminalFontStack(DEFAULT_TERMINAL_FONT)
+    );
+    expect(resolveTerminalFontStack("__proto__")).toBe(
+      resolveTerminalFontStack(DEFAULT_TERMINAL_FONT)
+    );
+    expect(resolveTerminalFontStack("toString")).toBe(
+      resolveTerminalFontStack(DEFAULT_TERMINAL_FONT)
+    );
+  });
+
   it("falls back to the default stack for a font it does not know", () => {
     expect(resolveTerminalFontStack("not-a-font")).toBe(
       resolveTerminalFontStack(DEFAULT_TERMINAL_FONT)
diff --git a/apps/desktop/src/lib/terminal-fonts.ts b/apps/desktop/src/lib/terminal-fonts.ts
index 94d23a7..202eb2a 100644
--- a/apps/desktop/src/lib/terminal-fonts.ts
+++ b/apps/desktop/src/lib/terminal-fonts.ts
@@ -118,7 +118,10 @@ export function listTerminalFontOptions(): TerminalFontOption[] {
  * font at all.
  */
 export function resolveTerminalFontStack(name: unknown): string {
-  if (typeof name === "string" && name in fonts) {
+  // An OWN property only: `name in fonts` would also find the inherited
+  // ones, so "constructor" or "__proto__" would resolve to something that is
+  // not a font at all.
+  if (typeof name === "string" && Object.prototype.hasOwnProperty.call(fonts, name)) {
     return fonts[name as TerminalFontName].stack;
   }
   return fonts[DEFAULT_TERMINAL_FONT].stack;
diff --git a/apps/desktop/src/store/broadcast-store.test.ts b/apps/desktop/src/store/broadcast-store.test.ts
index b6c1ee2..ea327ff 100644
--- a/apps/desktop/src/store/broadcast-store.test.ts
+++ b/apps/desktop/src/store/broadcast-store.test.ts
@@ -2,7 +2,10 @@ import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
 
 import {
   broadcastInput,
+  countBroadcastSenders,
+  hasBroadcastSender,
   registerBroadcastSender,
+  subscribeBroadcastSenders,
   useBroadcastStore,
 } from "./broadcast-store";
 
@@ -26,8 +29,8 @@ describe("broadcast input", () => {
   });
 
   it("sends the input to every pane taking part", () => {
-    const first = vi.fn();
-    const second = vi.fn();
+    const first = vi.fn(() => true);
+    const second = vi.fn(() => true);
     const unregisterFirst = registerBroadcastSender("pane-1", first);
     const unregisterSecond = registerBroadcastSender("pane-2", second);
 
@@ -40,7 +43,7 @@ describe("broadcast input", () => {
   });
 
   it("skips a pane that is not there", () => {
-    const present = vi.fn();
+    const present = vi.fn(() => true);
     const unregister = registerBroadcastSender("pane-1", present);
 
     expect(broadcastInput(["pane-1", "pane-gone"], "ls\r")).toBe(1);
@@ -50,8 +53,20 @@ describe("broadcast input", () => {
     expect(broadcastInput(["pane-1"], "ls\r")).toBe(0);
   });
 
+  it("does not count a pane whose session dropped", () => {
+    // The sender says whether it actually sent: a pane whose socket is
+    // closed is skipped, and it is not counted as a participant.
+    const dropped = vi.fn(() => false);
+    const unregister = registerBroadcastSender("pane-1", dropped);
+
+    expect(broadcastInput(["pane-1"], "ls\r")).toBe(0);
+    expect(dropped).toHaveBeenCalledWith("ls\r");
+
+    unregister();
+  });
+
   it("stops sending to a pane that unregistered", () => {
-    const send = vi.fn();
+    const send = vi.fn(() => true);
     const unregister = registerBroadcastSender("pane-1", send);
 
     unregister();
@@ -85,4 +100,34 @@ describe("broadcast input", () => {
     useBroadcastStore.getState().setAllPanes(["pane-1", "pane-1", "pane-2"]);
     expect(useBroadcastStore.getState().paneIds).toEqual(["pane-1", "pane-2"]);
   });
+
+  it("says which panes have a terminal that can receive a broadcast", () => {
+    expect(hasBroadcastSender("pane-1")).toBe(false);
+    expect(countBroadcastSenders()).toBe(0);
+
+    const unregister = registerBroadcastSender("pane-1", vi.fn(() => true));
+
+    expect(hasBroadcastSender("pane-1")).toBe(true);
+    expect(countBroadcastSenders()).toBe(1);
+
+    unregister();
+
+    expect(hasBroadcastSender("pane-1")).toBe(false);
+    expect(countBroadcastSenders()).toBe(0);
+  });
+
+  it("tells the surfaces that show the participants when a pane joins or leaves", () => {
+    const listener = vi.fn();
+    const unsubscribe = subscribeBroadcastSenders(listener);
+
+    const unregister = registerBroadcastSender("pane-1", vi.fn(() => true));
+    expect(listener).toHaveBeenCalledTimes(1);
+
+    unregister();
+    expect(listener).toHaveBeenCalledTimes(2);
+
+    unsubscribe();
+    registerBroadcastSender("pane-2", vi.fn(() => true));
+    expect(listener).toHaveBeenCalledTimes(2);
+  });
 });
diff --git a/apps/desktop/src/store/broadcast-store.ts b/apps/desktop/src/store/broadcast-store.ts
index 372848f..fcbb761 100644
--- a/apps/desktop/src/store/broadcast-store.ts
+++ b/apps/desktop/src/store/broadcast-store.ts
@@ -14,8 +14,14 @@
 
 import { create } from "zustand";
 
-/** Sends input to one pane. */
-export type PaneInputSender = (data: string) => void;
+/**
+ * Sends input to one pane.
+ *
+ * It reports whether the input was actually delivered: a pane whose session
+ * has dropped is skipped rather than counted, so a broadcast never queues
+ * input for a session that is not there.
+ */
+export type PaneInputSender = (data: string) => boolean;
 
 interface BroadcastState {
   /** Whether input is broadcast at all. */
@@ -50,7 +56,42 @@ export const useBroadcastStore = create<BroadcastState>()((set) => ({
 
 // The senders, beside the store rather than in it: they are functions, and
 // the persisted half of the state must stay serialisable.
+//
+// A pane registers when its terminal exists and unregisters when it goes, so
+// a closed pane never receives a broadcast. The registry is also what says
+// which panes are LIVE: a pane with no terminal cannot take part, whatever
+// the store's pane list says.
 const senders = new Map<string, PaneInputSender>();
+const senderListeners = new Set<() => void>();
+
+function notifySendersChanged() {
+  for (const listener of senderListeners) {
+    listener();
+  }
+}
+
+/**
+ * Subscribe to the registry changing.
+ *
+ * A pane joins and leaves the broadcast as its terminal is created and
+ * destroyed, and the surfaces that show the participants have to follow.
+ */
+export function subscribeBroadcastSenders(listener: () => void): () => void {
+  senderListeners.add(listener);
+  return () => {
+    senderListeners.delete(listener);
+  };
+}
+
+/** How many panes have a terminal that can receive a broadcast. */
+export function countBroadcastSenders(): number {
+  return senders.size;
+}
+
+/** Whether a pane has a terminal that can receive a broadcast. */
+export function hasBroadcastSender(paneId: string): boolean {
+  return senders.has(paneId);
+}
 
 /**
  * Register a pane's input sender, and get a function that removes it.
@@ -60,15 +101,18 @@ const senders = new Map<string, PaneInputSender>();
  */
 export function registerBroadcastSender(paneId: string, send: PaneInputSender): () => void {
   senders.set(paneId, send);
+  notifySendersChanged();
   return () => {
-    senders.delete(paneId);
+    if (senders.delete(paneId)) {
+      notifySendersChanged();
+    }
   };
 }
 
 /**
  * Send input to the given panes.
  *
- * A pane whose session is not open is skipped: the sender checks, so a
+ * A pane whose session is not open is skipped: the sender says so, so a
  * broadcast never queues input for a session that is not there.
  */
 export function broadcastInput(paneIds: string[], data: string): number {
@@ -78,8 +122,9 @@ export function broadcastInput(paneIds: string[], data: string): number {
     if (!send) {
       continue;
     }
-    send(data);
-    delivered += 1;
+    if (send(data)) {
+      delivered += 1;
+    }
   }
   return delivered;
 }
diff --git a/apps/desktop/src/store/hosts-store.test.ts b/apps/desktop/src/store/hosts-store.test.ts
index 4df7d0e..036c97c 100644
--- a/apps/desktop/src/store/hosts-store.test.ts
+++ b/apps/desktop/src/store/hosts-store.test.ts
@@ -1,4 +1,5 @@
 import { afterEach, describe, expect, it } from "vitest";
+import { useGroupSettingsStore } from "./group-settings-store";
 import { defaultHostKeyPolicy, defaultHostProtocol, emptyHostFormValues, sampleHosts } from "../types/host";
 import {
   applyHostFilters,
@@ -46,6 +47,40 @@ describe("hosts store helpers", () => {
     expect(updatedHosts.find((host) => host.id === sampleHosts[1].id)?.label).toBe("Docs Box");
   });
 
+  it("leaves the SFTP root empty when the group supplies one", () => {
+    // The group's root is a default, so the host inherits it at connect
+    // time instead of carrying a root it never chose. Without a group the
+    // host keeps the old default.
+    useGroupSettingsStore.getState().setGroupSettings("Acme / Production", {
+      sftpRoot: "/srv/app",
+    });
+
+    const created = createHostRecord({
+      ...emptyHostFormValues,
+      label: "Grouped host",
+      hostname: "box.internal",
+      username: "ops",
+      group: "Acme / Production",
+      sftpRoot: "",
+    });
+
+    expect(created.sftpRoot).toBe("");
+
+    useGroupSettingsStore.getState().clearGroupSettings("Acme / Production");
+  });
+
+  it("keeps the default SFTP root when no group supplies one", () => {
+    const created = createHostRecord({
+      ...emptyHostFormValues,
+      label: "Ungrouped host",
+      hostname: "box.internal",
+      username: "ops",
+      sftpRoot: "",
+    });
+
+    expect(created.sftpRoot).toBe("/home");
+  });
+
   it("propagates form-supplied identityId onto the host record (P2-DM1)", () => {
     const draft = {
       ...emptyHostFormValues,
diff --git a/apps/desktop/src/store/hosts-store.ts b/apps/desktop/src/store/hosts-store.ts
index 48a0281..64df485 100644
--- a/apps/desktop/src/store/hosts-store.ts
+++ b/apps/desktop/src/store/hosts-store.ts
@@ -1,6 +1,7 @@
 import { create } from "zustand";
 import { createJSONStorage, persist } from "zustand/middleware";
 import { createTermsnipStorage } from "../lib/persistence";
+import { useGroupSettingsStore } from "./group-settings-store";
 import { buildHostSearchText, parseEnvironmentVariables, splitCommaList } from "../lib/utils";
 import {
   createLocalShellHostRecord,
@@ -71,6 +72,25 @@ function normalizeHostRecord(host: HostRecord): HostRecord {
   };
 }
 
+/**
+ * The SFTP root a host record carries.
+ *
+ * A host that names a root keeps it. A host that leaves it empty takes the
+ * group's root when the group has one — the group's root is a default, so it
+ * is left empty here and applied when the connection is built. A host with
+ * no group to inherit from keeps the old default.
+ */
+function resolveSftpRoot(value: string, group: string): string {
+  const trimmed = value.trim();
+  if (trimmed) {
+    return trimmed;
+  }
+  const groupSftpRoot = useGroupSettingsStore
+    .getState()
+    .groupSettings[group]?.sftpRoot?.trim();
+  return groupSftpRoot ? "" : "/home";
+}
+
 export function createHostRecord(values: HostFormValues, currentHost?: HostRecord): HostRecord {
   const now = new Date().toISOString();
   const protocol = values.protocol;
@@ -102,7 +122,7 @@ export function createHostRecord(values: HostFormValues, currentHost?: HostRecor
     agentForwarding: supportsCredentials ? values.agentForwarding : false,
     environment: parseEnvironmentVariables(values.environment),
     jumpHostId: supportsJumpHosts ? values.jumpHostId || undefined : undefined,
-    sftpRoot: supportsSftp ? values.sftpRoot.trim() || "/home" : "",
+    sftpRoot: supportsSftp ? resolveSftpRoot(values.sftpRoot, values.group) : "",
     snippetCount: currentHost?.snippetCount ?? 0,
     forwardingCount: currentHost?.forwardingCount ?? 0,
     createdAt: currentHost?.createdAt ?? now,
diff --git a/apps/desktop/src/store/sessions-store.redaction.test.ts b/apps/desktop/src/store/sessions-store.redaction.test.ts
index d722450..e6cbaea 100644
--- a/apps/desktop/src/store/sessions-store.redaction.test.ts
+++ b/apps/desktop/src/store/sessions-store.redaction.test.ts
@@ -17,6 +17,10 @@ import { useSessionsStore } from "./sessions-store";
 //
 // The command itself is NOT redacted: the history replays it into a session,
 // and a redacted command would run as something else.
+//
+// The output arrives from the terminal in PIECES, so the redaction has to see
+// the whole output before it keeps any of it: a secret split across two
+// pieces is only a secret once the pieces are joined.
 
 describe("the session history and secrets", () => {
   beforeEach(() => {
@@ -24,7 +28,7 @@ describe("the session history and secrets", () => {
     useSessionsStore.setState({ commandHistory: [] });
   });
 
-  function recordOutput(output: string) {
+  function openPane() {
     const tabId = useSessionsStore.getState().openSession(sampleHosts[0]);
     const state = useSessionsStore.getState();
     const paneId = state.tabs.find((tab) => tab.id === tabId)?.paneIds[0];
@@ -35,10 +39,23 @@ describe("the session history and secrets", () => {
     if (!entryId) {
       throw new Error("no history entry");
     }
+    return entryId;
+  }
+
+  function recordOutput(output: string) {
+    const entryId = openPane();
     useSessionsStore.getState().appendCommandOutput(entryId, output);
     return useSessionsStore.getState().commandHistory[0];
   }
 
+  function recordOutputInChunks(chunks: string[]) {
+    const entryId = openPane();
+    for (const chunk of chunks) {
+      useSessionsStore.getState().appendCommandOutput(entryId, chunk);
+    }
+    return useSessionsStore.getState().commandHistory[0];
+  }
+
   it("keeps a secret out of the preview", () => {
     const entry = recordOutput("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY");
 
@@ -47,6 +64,32 @@ describe("the session history and secrets", () => {
     expect(entry.outputPreview).toContain("[redacted]");
   });
 
+  it("keeps a secret that straddles two pieces out of the preview", () => {
+    // The terminal streams the output in pieces, and a password printed
+    // across a piece boundary is still a password.
+    const entry = recordOutputInChunks(["password=", "synthetic-value"]);
+
+    expect(entry.outputPreview).toBeDefined();
+    expect(entry.outputPreview).not.toContain("synthetic-value");
+    expect(entry.outputPreview).toContain("[redacted]");
+  });
+
+  it("keeps a secret that straddles two pieces and a colour code out of the preview", () => {
+    // The escape codes are stripped before the redaction, so a coloured
+    // name is still a name.
+    const entry = recordOutputInChunks(["[32mpassword[0m=", "synthetic-value"]);
+
+    expect(entry.outputPreview).not.toContain("synthetic-value");
+    expect(entry.outputPreview).toContain("[redacted]");
+  });
+
+  it("keeps a token that straddles two pieces out of the preview", () => {
+    const entry = recordOutputInChunks(["ghp_abcdefghijklmnop", "qrstuvwxyz012345"]);
+
+    expect(entry.outputPreview).not.toContain("ghp_abcdefghijklmnop");
+    expect(entry.outputPreview).toContain("[redacted]");
+  });
+
   it("keeps ordinary output readable", () => {
     const entry = recordOutput("total 24\nrelease.tar.gz  1024");
 
diff --git a/apps/desktop/src/store/sessions-store.test.ts b/apps/desktop/src/store/sessions-store.test.ts
index 6321eef..c803ce8 100644
--- a/apps/desktop/src/store/sessions-store.test.ts
+++ b/apps/desktop/src/store/sessions-store.test.ts
@@ -11,7 +11,7 @@ vi.mock("../lib/backend-runtime", async (importOriginal) => ({
 import { closeSession } from "../lib/backend-runtime";
 
 import {
-  appendPaneCommandHistoryOutput,
+  setPaneCommandHistoryOutput,
   closeBackendSessionsForPanes,
   cycleSessionTab,
   closeSessionTab,
@@ -248,7 +248,7 @@ describe("sessions store helpers", () => {
     );
     const entryId = recorded.commandHistory[0]!.id;
 
-    const updated = appendPaneCommandHistoryOutput(
+    const updated = setPaneCommandHistoryOutput(
       recorded,
       entryId,
       "\u001b[32mload average: 1.00\r\nusers: 2\u001b[0m"
@@ -276,7 +276,7 @@ describe("sessions store helpers", () => {
       "queued"
     );
     const entryId = recorded.commandHistory[0]!.id;
-    const updated = appendPaneCommandHistoryOutput(recorded, entryId, "load average: 1.00");
+    const updated = setPaneCommandHistoryOutput(recorded, entryId, "load average: 1.00");
     const optedOut = updatePanePreviewPersistence(updated, paneId, false);
     const persisted = sanitizePersistedCommandHistory(optedOut.commandHistory, optedOut.panes);
 
@@ -308,7 +308,7 @@ describe("sessions store helpers", () => {
       "queued"
     );
     const entryId = recorded.commandHistory[0]!.id;
-    const updated = appendPaneCommandHistoryOutput(recorded, entryId, "load average: 1.00");
+    const updated = setPaneCommandHistoryOutput(recorded, entryId, "load average: 1.00");
     const optedOut = updatePanePreviewPersistence(updated, paneId, false);
     const closed = closeSessionTab(optedOut, tabId);
     const persisted = sanitizePersistedCommandHistory(
@@ -342,7 +342,7 @@ describe("sessions store helpers", () => {
       "queued"
     );
     const entryId = recorded.commandHistory[0]!.id;
-    const updated = appendPaneCommandHistoryOutput(recorded, entryId, "load average: 1.00");
+    const updated = setPaneCommandHistoryOutput(recorded, entryId, "load average: 1.00");
     const closed = closeSessionTab(updated, tabId);
     const persisted = sanitizePersistedCommandHistory(updated.commandHistory, closed.panes);
 
diff --git a/apps/desktop/src/store/sessions-store.ts b/apps/desktop/src/store/sessions-store.ts
index 8248326..fa231fd 100644
--- a/apps/desktop/src/store/sessions-store.ts
+++ b/apps/desktop/src/store/sessions-store.ts
@@ -59,6 +59,38 @@ function limitCommandHistory(commandHistory: SessionCommandHistoryEntry[]) {
   return commandHistory.slice(0, SESSION_HISTORY_LIMIT);
 }
 
+// The raw output of each history entry, kept in memory only.
+//
+// The redaction has to see a command's output as a WHOLE: the terminal
+// streams it in pieces, and a secret split across two pieces — "password="
+// in one, the value in the next — is only a secret once the pieces are
+// joined. So the raw text is kept here, in memory, and the preview that
+// goes into the store (and into the local storage the store is written to)
+// is always the redacted form of the whole output.
+//
+// The raw text never enters the store state, so it cannot be persisted.
+const rawCommandOutput = new Map<string, string>();
+
+// How much raw output to keep per entry. The preview keeps the last 600
+// characters, so this is generous; it bounds what a long-running command can
+// hold in memory. The tail is kept, because the preview is the tail.
+const RAW_COMMAND_OUTPUT_LIMIT = 64 * 1024;
+
+/**
+ * Forget the raw output of entries the history no longer holds.
+ *
+ * The raw buffer is keyed by history entry, so an entry the history drops
+ * would otherwise leave its output behind for the rest of the session.
+ */
+function forgetDroppedCommandOutput(commandHistory: SessionCommandHistoryEntry[]) {
+  const held = new Set(commandHistory.map((entry) => entry.id));
+  for (const entryId of rawCommandOutput.keys()) {
+    if (!held.has(entryId)) {
+      rawCommandOutput.delete(entryId);
+    }
+  }
+}
+
 function normalizePersistedPane(pane: SessionPane): SessionPane {
   return {
     ...pane,
@@ -621,7 +653,16 @@ export function recordPaneCommandHistory(
   };
 }
 
-export function appendPaneCommandHistoryOutput(
+/**
+ * Set the output preview of a history entry.
+ *
+ * The preview is SET, not appended: the caller hands over the whole output
+ * of the command, because the redaction has to see the whole output before
+ * any of it can be kept. Appending a redacted piece at a time would let a
+ * secret that straddles two pieces through — "password=" in one piece and
+ * the value in the next is not a secret to either piece on its own.
+ */
+export function setPaneCommandHistoryOutput(
   state: SessionWorkspaceState & { commandHistory: SessionCommandHistoryEntry[] },
   entryId: string,
   output: string
@@ -636,9 +677,7 @@ export function appendPaneCommandHistoryOutput(
       return entry;
     }
 
-    const outputPreview = `${entry.outputPreview ? `${entry.outputPreview}\n` : ""}${normalizedOutput}`
-      .slice(-SESSION_HISTORY_OUTPUT_LIMIT)
-      .trim();
+    const outputPreview = normalizedOutput.slice(-SESSION_HISTORY_OUTPUT_LIMIT).trim();
     return {
       ...entry,
       outputPreview,
@@ -779,6 +818,7 @@ export const useSessionsStore = create<SessionsState>()(
         set((state) => consumePaneCommand(state, paneId, commandId)),
       recordPaneCommand: (paneId, command, source = "queued") => {
         const nextState = recordPaneCommandHistory(get(), paneId, command, source);
+        forgetDroppedCommandOutput(nextState.commandHistory);
         set(nextState);
         return nextState.commandHistory[0]?.id;
       },
@@ -788,15 +828,30 @@ export const useSessionsStore = create<SessionsState>()(
         // The command itself is NOT redacted: the history replays it into a
         // session, and a redacted command would run as something else.
         const redact = useAppStore.getState().redactCommandOutput;
-        set((state) =>
-          appendPaneCommandHistoryOutput(
+        set((state) => {
+          // The output arrives in pieces. The pieces are joined first and
+          // redacted as a whole, so a secret that straddles two pieces is
+          // still caught — and the ANSI codes are stripped before the
+          // redaction, so a coloured "password=" is still a "password=".
+          const raw = `${rawCommandOutput.get(entryId) ?? ""}${output}`;
+          const kept =
+            raw.length > RAW_COMMAND_OUTPUT_LIMIT
+              ? raw.slice(-RAW_COMMAND_OUTPUT_LIMIT)
+              : raw;
+          rawCommandOutput.set(entryId, kept);
+
+          const normalized = normalizeCommandHistoryOutput(kept);
+          return setPaneCommandHistoryOutput(
             state,
             entryId,
-            redact ? redactSecrets(output) : output
-          )
-        );
+            redact ? redactSecrets(normalized) : normalized
+          );
+        });
+      },
+      clearCommandHistory: () => {
+        rawCommandOutput.clear();
+        set(() => ({ commandHistory: [] }));
       },
-      clearCommandHistory: () => set(() => ({ commandHistory: [] })),
       queueCommandForHosts: (hosts, command, label) => {
         const paneIds: string[] = [];
 
```
