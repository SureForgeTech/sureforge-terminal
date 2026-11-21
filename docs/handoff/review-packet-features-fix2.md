# Follow-up review packet, round 3 — the second round of findings

## What you are reviewing

- Repository: `SureForgeTech/sureforge-terminal`
- Read-only checkout: `/workspace/sureforge-terminal` (now at the head below; do not modify it)
- Head you reviewed last: `7fdcc1be49341aa801821d169925ae6a481dd166` (your verdict: BLOCK, 1 P0 / 2 P1 / 5 P2-P3)
- Head under review now: `494fae610a892c81c03560433be1f22b4c3b19b6`
- Base of the whole feature range (unchanged): `4d24bdb0055cfecb1e8d013a2155663768e25700`

One commit was added on top of the head you reviewed: `494fae6 fix(features): the second round of review findings`. Nothing below it changed.

## How to verify

Work from the checkout at `494fae6`. For each finding you raised, decide whether it is actually fixed, by reading the code and running the tests. Re-derive the answer; do not take the description below as evidence that a fix works.

The complete diff of the new commit is at the end of this packet, and is also in `/tmp/opencode/features-fix2-7fdcc1b..494fae6.diff`.

## The findings, and where each was addressed

**P0 — truncating the raw buffer before redaction leaked a streamed secret.** `apps/desktop/src/lib/redact-secrets.ts` now has an `OutputRedactor`: it keeps a FINALIZED part (already redacted, cut where no construct spans the cut) and a PENDING part (the raw tail a construct may still span, redacted as a whole every time it grows). The cut is a line boundary that is not the end of an assignment and is not inside a private key block. A private key block that has NOT ended yet is masked as well, so its body never sits in the preview while the block is open. `apps/desktop/src/store/sessions-store.ts` keeps one redactor per history entry.

**P1.1 — the rewrite had dropped `pass` as a credential name.** `SECRET_WORDS` has `pass` again.

**P1.2 — changing a host's group cleared an SFTP root the host had been given.** `apps/desktop/src/components/hosts/HostEditor.tsx`: only a NEW host may take the group's root; an existing host keeps its own.

**P2/P3.** The token test now asserts the tail of the token is gone as well (`sessions-store.redaction.test.ts`). The fresh-connect path has its own test (`terminal-pane-native-session.test.ts` — the connection builder's tests pass a group directly, so they could not catch a reverted caller). The broadcast's membership and the button's rule moved into `broadcast-membership.ts` with tests. The group is trimmed where its settings are looked up (`hosts-store.ts`).

## One thing that was not a finding but had to be fixed

The name in an assignment pattern was unbounded, which is quadratic on a long line: redacting a 70 kB blob took 7.2 seconds, and now takes 15 ms. The name is bounded to 64 characters.

## Validation on the new head

```
$ npm run validate
  Test Files  204 passed (204)
       Tests  1161 passed | 1 skipped (1162)
  ✓ built in ...
  [validate] Docker is unavailable, so semgrep could not run.
exit status: 1
```

Exit 1 is the Docker-gated Semgrep step alone, exactly as on the base commit. `tsc -b` and ESLint are clean.

## What to check

- Whether each finding is genuinely fixed — reproduce the way you reproduced it.
- Whether the fixes are COMPLETE. The P0 in particular: the redaction must hold on the real streaming path, for a secret that straddles a piece boundary, for a key block of any length, and for output with no line breaks at all. Please try to break it.
- Whether the fixes BROKE anything else. The redaction is now a streaming redactor with a finalized part and a pending part; the preview is now set rather than appended; the host editor's validation changed again; the broadcast's membership moved into a hook.
- Whether the new tests would still pass if the fix were reverted.
- Whether the redactor's memory and time behaviour is acceptable: a long-running command must not grow the process without bound, and a single very long line must not freeze the app.

The bar is unchanged: zero unresolved P0 or P1 findings.

## Complete diff of the new commit

```diff
diff --git a/apps/desktop/src/components/hosts/HostEditor.tsx b/apps/desktop/src/components/hosts/HostEditor.tsx
index 351398f..3532155 100644
--- a/apps/desktop/src/components/hosts/HostEditor.tsx
+++ b/apps/desktop/src/components/hosts/HostEditor.tsx
@@ -689,11 +689,15 @@ function HostEditorContent({
               const group = event.target.value;
               setValues((current) => {
                 const groupSftpRoot = groupSettingsFor(groupSettings, group.trim())?.sftpRoot?.trim();
-                // The form starts with the default SFTP root. A group that
-                // supplies one takes it over, so the host inherits instead
-                // of carrying a root it never chose.
+                // The form starts with the default SFTP root, and a group
+                // that supplies one takes it over — so a NEW host inherits
+                // instead of carrying a root it never chose. An existing
+                // host keeps its own value: a root it was given is not the
+                // form's default, and only the host itself may change it.
                 const sftpRoot =
-                  groupSftpRoot && current.sftpRoot === "/home" ? "" : current.sftpRoot;
+                  !host && groupSftpRoot && current.sftpRoot === "/home"
+                    ? ""
+                    : current.sftpRoot;
                 return { ...current, group, sftpRoot };
               });
             }}
diff --git a/apps/desktop/src/components/terminal/TerminalWorkspace.tsx b/apps/desktop/src/components/terminal/TerminalWorkspace.tsx
index 2781093..0d96a33 100644
--- a/apps/desktop/src/components/terminal/TerminalWorkspace.tsx
+++ b/apps/desktop/src/components/terminal/TerminalWorkspace.tsx
@@ -16,6 +16,7 @@ import { hostSupportsPortForwarding, type HostRecord } from "../../types/host";
 import { ErrorBoundary, ScopedErrorFallback } from "../ErrorBoundary";
 import { EmptyState } from "../common/EmptyState";
 import { PortForwardPanel } from "./PortForwardPanel";
+import { isBroadcastButtonDisabled, useBroadcastMembership } from "./broadcast-membership";
 import { selectLiveBroadcastPanes } from "./broadcast-participants";
 import { SplitLayout } from "./SplitLayout";
 import { TerminalPane } from "./TerminalPane";
@@ -37,10 +38,8 @@ export function TerminalWorkspace({ launchHost }: TerminalWorkspaceProps) {
   const duplicateSession = useSessionsStore((state) => state.duplicateSession);
   // Broadcast: what you type goes to every pane taking part, so the same
   // command can be run on several hosts at once. It is off by default.
-  const broadcastEnabled = useBroadcastStore((state) => state.enabled);
   const setBroadcastEnabled = useBroadcastStore((state) => state.setEnabled);
   const setBroadcastPanes = useBroadcastStore((state) => state.setAllPanes);
-  const broadcastPaneIds = useBroadcastStore((state) => state.paneIds);
   // The broadcast reaches the PANES that are actually live: a pane whose
   // session is connected and whose terminal is on screen. A restored tab
   // that is not open, a pane still waiting for a secret and a mock session
@@ -61,19 +60,10 @@ export function TerminalWorkspace({ launchHost }: TerminalWorkspaceProps) {
     },
     [sessionPanes, senderCount]
   );
-  const livePaneKey = livePaneIds.join(",");
   // The membership follows the live panes: a session that opens joins the
   // broadcast, and a session that closes leaves it. Without this the banner
   // would count a session the broadcast does not reach.
-  useEffect(() => {
-    if (!broadcastEnabled) {
-      return;
-    }
-    if (livePaneKey !== broadcastPaneIds.join(",")) {
-      setBroadcastPanes(livePaneIds);
-    }
-    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the stable value of the list
-  }, [broadcastEnabled, livePaneKey]);
+  const { broadcastEnabled, broadcastPaneIds } = useBroadcastMembership(livePaneIds);
   const selectTab = useSessionsStore((state) => state.selectTab);
   const splitTab = useSessionsStore((state) => state.splitTab);
   const closePane = useSessionsStore((state) => state.closePane);
@@ -204,7 +194,7 @@ export function TerminalWorkspace({ launchHost }: TerminalWorkspaceProps) {
                 // The two-session rule applies to turning the broadcast ON.
                 // While it is on, the button stays usable: a pane that
                 // closed must not leave the user unable to turn it off.
-                disabled={!broadcastEnabled && livePaneIds.length < 2}
+                disabled={isBroadcastButtonDisabled(broadcastEnabled, livePaneIds.length)}
                 onClick={() => {
                   const next = !broadcastEnabled;
                   // Turning it on sends to every live pane; turning it off
diff --git a/apps/desktop/src/components/terminal/broadcast-membership.test.ts b/apps/desktop/src/components/terminal/broadcast-membership.test.ts
new file mode 100644
index 0000000..15b70f6
--- /dev/null
+++ b/apps/desktop/src/components/terminal/broadcast-membership.test.ts
@@ -0,0 +1,74 @@
+// @vitest-environment happy-dom
+//
+// The broadcast's membership and the button that turns it on and off.
+//
+// The membership has to follow the live panes: a session that opens joins
+// the broadcast, a session that closes leaves it, and the banner counts the
+// sessions the broadcast really reaches. The two-session rule applies to
+// turning the broadcast ON — while it is on, the button stays usable, so a
+// pane that closed can never leave the user unable to turn it off.
+import { renderHook } from "@testing-library/react";
+import { afterEach, beforeEach, describe, expect, it } from "vitest";
+
+import { useBroadcastStore } from "../../store/broadcast-store";
+import { isBroadcastButtonDisabled, useBroadcastMembership } from "./broadcast-membership";
+
+describe("the broadcast membership", () => {
+  beforeEach(() => {
+    useBroadcastStore.setState({ enabled: false, paneIds: [] });
+  });
+
+  afterEach(() => {
+    useBroadcastStore.setState({ enabled: false, paneIds: [] });
+  });
+
+  it("does not take part while the broadcast is off", () => {
+    const { rerender } = renderHook(() => useBroadcastMembership(["pane-1", "pane-2"]));
+
+    rerender();
+
+    expect(useBroadcastStore.getState().paneIds).toEqual([]);
+  });
+
+  it("follows the live panes while the broadcast is on", () => {
+    useBroadcastStore.setState({ enabled: true, paneIds: ["pane-1"] });
+
+    let livePaneIds = ["pane-1", "pane-2"];
+    const { rerender } = renderHook(() => useBroadcastMembership(livePaneIds));
+
+    // A session opened: it joins the broadcast.
+    rerender();
+    expect(useBroadcastStore.getState().paneIds).toEqual(["pane-1", "pane-2"]);
+
+    // A session closed: it leaves the broadcast.
+    livePaneIds = ["pane-1"];
+    rerender();
+    expect(useBroadcastStore.getState().paneIds).toEqual(["pane-1"]);
+  });
+
+  it("empties the membership when the broadcast is turned off", () => {
+    useBroadcastStore.setState({ enabled: true, paneIds: ["pane-1", "pane-2"] });
+
+    renderHook(() => useBroadcastMembership(["pane-1", "pane-2"]));
+
+    expect(useBroadcastStore.getState().paneIds).toEqual(["pane-1", "pane-2"]);
+
+    useBroadcastStore.getState().setEnabled(false);
+
+    expect(useBroadcastStore.getState().paneIds).toEqual([]);
+  });
+
+  it("keeps the button usable while the broadcast is on", () => {
+    // A pane closed and only one is left: the button must still be usable,
+    // or the user cannot turn the broadcast off.
+    expect(isBroadcastButtonDisabled(true, 1)).toBe(false);
+    expect(isBroadcastButtonDisabled(true, 0)).toBe(false);
+  });
+
+  it("needs two live sessions to turn the broadcast on", () => {
+    expect(isBroadcastButtonDisabled(false, 0)).toBe(true);
+    expect(isBroadcastButtonDisabled(false, 1)).toBe(true);
+    expect(isBroadcastButtonDisabled(false, 2)).toBe(false);
+    expect(isBroadcastButtonDisabled(false, 5)).toBe(false);
+  });
+});
diff --git a/apps/desktop/src/components/terminal/broadcast-membership.ts b/apps/desktop/src/components/terminal/broadcast-membership.ts
new file mode 100644
index 0000000..f8fa17b
--- /dev/null
+++ b/apps/desktop/src/components/terminal/broadcast-membership.ts
@@ -0,0 +1,46 @@
+import { useEffect } from "react";
+
+import { useBroadcastStore } from "../../store/broadcast-store";
+
+/**
+ * Keeps the broadcast's membership on the live panes.
+ *
+ * A session that opens joins the broadcast and a session that closes leaves
+ * it. Without this the membership is what it was when the broadcast was
+ * turned on, so the banner counts sessions the broadcast does not reach and
+ * a closed session keeps receiving input.
+ */
+export function useBroadcastMembership(livePaneIds: string[]) {
+  const broadcastEnabled = useBroadcastStore((state) => state.enabled);
+  const broadcastPaneIds = useBroadcastStore((state) => state.paneIds);
+  const setBroadcastPanes = useBroadcastStore((state) => state.setAllPanes);
+
+  // The key is the stable value of the list: the list itself is a new array
+  // on every render, and an effect that depends on it would run forever.
+  const livePaneKey = livePaneIds.join(",");
+  useEffect(() => {
+    if (!broadcastEnabled) {
+      return;
+    }
+    if (livePaneKey !== broadcastPaneIds.join(",")) {
+      setBroadcastPanes(livePaneIds);
+    }
+    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the stable value of the list
+  }, [broadcastEnabled, livePaneKey]);
+
+  return { broadcastEnabled, broadcastPaneIds };
+}
+
+/**
+ * Whether the broadcast button is disabled.
+ *
+ * The two-session rule applies to turning the broadcast ON. While it is on,
+ * the button stays usable: a pane that closed must not leave the user
+ * unable to turn the broadcast off.
+ */
+export function isBroadcastButtonDisabled(
+  broadcastEnabled: boolean,
+  livePaneCount: number
+): boolean {
+  return !broadcastEnabled && livePaneCount < 2;
+}
diff --git a/apps/desktop/src/components/terminal/terminal-pane-native-session.test.ts b/apps/desktop/src/components/terminal/terminal-pane-native-session.test.ts
index c4dea1f..18c2b79 100644
--- a/apps/desktop/src/components/terminal/terminal-pane-native-session.test.ts
+++ b/apps/desktop/src/components/terminal/terminal-pane-native-session.test.ts
@@ -1,4 +1,5 @@
 import { beforeEach, describe, expect, it, vi } from "vitest";
+import { useGroupSettingsStore } from "../../store/group-settings-store";
 import { useHostsStore } from "../../store/hosts-store";
 import { useKnownHostsStore } from "../../store/known-hosts-store";
 import type { HostRecord } from "../../types/host";
@@ -112,6 +113,43 @@ describe("createTerminalPaneNativeSessionController", () => {
     openBackendSessionSocket.mockReset();
   });
 
+  it("carries the host's group into the connection", async () => {
+    // The group's settings hang off the group, so a connection built without
+    // it silently loses the group's user name, bastion, environment and SFTP
+    // root — on every fresh session.
+    useGroupSettingsStore
+      .getState()
+      .setGroupSettings("Acme / Production", {
+        username: "ops-from-group",
+        sftpRoot: "/srv/app",
+        environment: { REGION: "eu-west-1" },
+      });
+    createBackendSession.mockResolvedValueOnce({ sessionId: "session-1" });
+    openBackendSessionSocket.mockResolvedValue(new FakeSocket());
+
+    const controller = makeController(vi.fn(), {
+      readLatestHost: () =>
+        ({
+          id: "host-1",
+          group: "Acme / Production",
+          jumpHostId: undefined,
+        }) as never,
+      sftpRoot: "",
+      username: "",
+    });
+
+    await controller.connectNativeSession();
+
+    const connection = createBackendSession.mock.calls[0]?.[0] as
+      | { username?: string; sftpRoot?: string; environment?: Record<string, string> }
+      | undefined;
+    expect(connection?.username).toBe("ops-from-group");
+    expect(connection?.sftpRoot).toBe("/srv/app");
+    expect(connection?.environment).toEqual({ REGION: "eu-west-1" });
+
+    useGroupSettingsStore.getState().clearGroupSettings("Acme / Production");
+  });
+
   it("schedules a reconnect end to end when a connected socket closes", async () => {
     const sockets: FakeSocket[] = [];
     createBackendSession
diff --git a/apps/desktop/src/lib/redact-secrets.test.ts b/apps/desktop/src/lib/redact-secrets.test.ts
index 1cd1da9..893b54e 100644
--- a/apps/desktop/src/lib/redact-secrets.test.ts
+++ b/apps/desktop/src/lib/redact-secrets.test.ts
@@ -44,6 +44,15 @@ describe("redacting secrets", () => {
     );
   });
 
+  it("masks a credential named after a password, however short the name", () => {
+    // "pass" is a credential name as much as "password" is.
+    expect(redactSecrets("pass=synthetic-value")).toBe(`pass=${REDACTION_PLACEHOLDER}`);
+    expect(redactSecrets("passwd=synthetic-value")).toBe(`passwd=${REDACTION_PLACEHOLDER}`);
+    expect(redactSecrets("passphrase=synthetic-value")).toBe(
+      `passphrase=${REDACTION_PLACEHOLDER}`
+    );
+  });
+
   it("masks the token shapes that are secrets by construction", () => {
     expect(redactSecrets("AKIAIOSFODNN7EXAMPLE")).toBe(REDACTION_PLACEHOLDER);
     expect(redactSecrets("ghp_abcdefghijklmnopqrstuvwxyz012345")).toBe(REDACTION_PLACEHOLDER);
diff --git a/apps/desktop/src/lib/redact-secrets.ts b/apps/desktop/src/lib/redact-secrets.ts
index 99f6d08..29358e8 100644
--- a/apps/desktop/src/lib/redact-secrets.ts
+++ b/apps/desktop/src/lib/redact-secrets.ts
@@ -28,6 +28,7 @@ export const REDACTION_PLACEHOLDER = "[redacted]";
 const SECRET_WORDS = new Set([
   "password",
   "passwd",
+  "pass",
   "passphrase",
   "secret",
   "token",
@@ -54,8 +55,11 @@ const SECRET_KEY_QUALIFIERS = new Set([
 // KEY=value, "key": "value", key: value — the name is captured on its own so
 // it can be checked word by word, and the separator is captured so the
 // replacement keeps the shape of the text.
+// The name is bounded: an unbounded one is QUADRATIC on a long line of
+// output (the engine tries every name length at every position), and a
+// 70 kB base64 blob would take seconds to redact.
 const ASSIGNMENT_PATTERN =
-  /(["']?)([A-Za-z0-9_][A-Za-z0-9_.-]*)\1(\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/g;
+  /(["']?)([A-Za-z0-9_][A-Za-z0-9_.-]{0,63})\1(\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/g;
 
 // Well-known token shapes. Each is long enough and specific enough that a
 // false positive is very unlikely.
@@ -74,6 +78,11 @@ const TOKEN_PATTERNS: RegExp[] = [
   /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
   // A private key block.
   /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
+  // A private key block that has NOT ended yet: the closed-block pattern
+  // cannot match it, so its body would sit in the preview unhidden until
+  // the block ends. It runs after the closed pattern, so a finished block
+  // is already gone by then.
+  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*$/g,
 ];
 
 /**
@@ -194,3 +203,149 @@ export function containsSecret(text: string): boolean {
   }
   return redactSecrets(text) !== text;
 }
+
+// The escape codes a terminal writes around its output, and the bell.
+const ANSI_ESCAPE_CHARACTER = String.fromCharCode(27);
+const TERMINAL_BELL_CHARACTER = String.fromCharCode(7);
+const ANSI_ESCAPE_SEQUENCE_REGEX = new RegExp(
+  `${ANSI_ESCAPE_CHARACTER}\\[[0-9;?]*[ -/]*[@-~]`,
+  "g"
+);
+const TERMINAL_BELL_REGEX = new RegExp(TERMINAL_BELL_CHARACTER, "g");
+
+/** How much of the redacted output the preview keeps. */
+export const REDACTED_PREVIEW_LIMIT = 600;
+
+// A private key block, open or closed.
+const PRIVATE_KEY_BEGIN = "-----BEGIN";
+const PRIVATE_KEY_END = "-----END";
+
+/**
+ * Whether a line ends in a way that says a value follows it.
+ *
+ * "password=" at the end of a line means the value is on the next one, so a
+ * cut there would hide the value from the name it belongs to.
+ */
+function endsWithAssignment(text: string): boolean {
+  return /[:=]\s*$/.test(text);
+}
+
+/**
+ * The place the text can be cut so that no construct spans the cut.
+ *
+ * The cut is a line boundary, because no construct spans a line: a value
+ * ends at the whitespace, and a token has no whitespace in it. Two things
+ * move it: a line that ends with an assignment separator (the value is on
+ * the next line) and a private key block, which spans lines — so the cut
+ * goes past a closed block, or is held back in front of an open one.
+ */
+function findSafeCut(text: string): number {
+  // The key block positions are found once: the walk below must not rescan
+  // the whole text for every candidate.
+  const begin = text.lastIndexOf(PRIVATE_KEY_BEGIN);
+  const end = text.lastIndexOf(PRIVATE_KEY_END);
+  const blockOpen = begin >= 0 && end < begin;
+
+  let cut = text.lastIndexOf("\n") + 1;
+  while (cut > 0) {
+    // The cut must not be the end of an assignment: the value follows it.
+    const lineStart = text.lastIndexOf("\n", cut - 2) + 1;
+    if (!endsWithAssignment(text.slice(lineStart, cut))) {
+      if (begin >= 0 && cut > begin) {
+        if (blockOpen) {
+          // The block is still open: it has to stay whole, so the cut goes
+          // in front of it.
+          cut = text.lastIndexOf("\n", begin - 1) + 1;
+          continue;
+        }
+        // The block is closed: the cut has to be after its END line, or the
+        // block would be split between the two halves.
+        const endOfBlock = text.indexOf("\n", end);
+        if (endOfBlock < 0) {
+          return 0;
+        }
+        if (cut <= endOfBlock) {
+          cut = endOfBlock + 1;
+          continue;
+        }
+      }
+      return cut;
+    }
+    cut = text.lastIndexOf("\n", cut - 2) + 1;
+  }
+  return 0;
+}
+
+/**
+ * Keeps the redacted preview of a stream of output.
+ *
+ * The output arrives in pieces and is unbounded, so it cannot simply be held
+ * whole; and a secret may straddle two pieces, so the redaction has to see
+ * enough context to recognise it. The stream therefore keeps two parts:
+ *
+ * - the FINALIZED part, already redacted, which cannot change any more
+ *   because it was cut where no construct spans it;
+ * - the PENDING part, the raw tail a construct may still span, which is
+ *   redacted as a whole every time it grows.
+ *
+ * The finalized part is trimmed to the size of the preview, and the pending
+ * part is bounded by a line (and by an open private key block), so what a
+ * long-running command holds in memory stays bounded.
+ */
+export class OutputRedactor {
+  private finalized = "";
+  private pending = "";
+  private redact: boolean;
+
+  constructor(redact: boolean = true) {
+    this.redact = redact;
+  }
+
+  /**
+   * Turn the redaction on or off.
+   *
+   * The setting is a preference the user can change while a command runs,
+   * so the next piece of output follows the new setting.
+   */
+  setRedactionEnabled(redact: boolean) {
+    this.redact = redact;
+  }
+
+  /**
+   * Add a piece of output, and return the redacted preview of everything
+   * seen so far.
+   */
+  append(chunk: string): string {
+    this.pending += stripTerminalCodes(chunk);
+
+    const cut = findSafeCut(this.pending);
+    if (cut > 0) {
+      this.finalized = `${this.finalized}${this.mask(this.pending.slice(0, cut))}`.slice(
+        -REDACTED_PREVIEW_LIMIT
+      );
+      this.pending = this.pending.slice(cut);
+    }
+
+    return `${this.finalized}${this.mask(this.pending)}`
+      .slice(-REDACTED_PREVIEW_LIMIT)
+      .trim();
+  }
+
+  private mask(text: string): string {
+    return this.redact ? redactSecrets(text) : text;
+  }
+}
+
+/**
+ * The terminal's own codes, stripped.
+ *
+ * The escape codes are stripped BEFORE the redaction, so a coloured
+ * "password=" is still a "password=" and a secret that a colour code split
+ * in half is still found.
+ */
+export function stripTerminalCodes(text: string): string {
+  return text
+    .replace(ANSI_ESCAPE_SEQUENCE_REGEX, "")
+    .replace(/\r/g, "")
+    .replace(TERMINAL_BELL_REGEX, "");
+}
diff --git a/apps/desktop/src/store/hosts-store.ts b/apps/desktop/src/store/hosts-store.ts
index 64df485..ae55000 100644
--- a/apps/desktop/src/store/hosts-store.ts
+++ b/apps/desktop/src/store/hosts-store.ts
@@ -87,7 +87,7 @@ function resolveSftpRoot(value: string, group: string): string {
   }
   const groupSftpRoot = useGroupSettingsStore
     .getState()
-    .groupSettings[group]?.sftpRoot?.trim();
+    .groupSettings[group.trim()]?.sftpRoot?.trim();
   return groupSftpRoot ? "" : "/home";
 }
 
diff --git a/apps/desktop/src/store/sessions-store.redaction.test.ts b/apps/desktop/src/store/sessions-store.redaction.test.ts
index e6cbaea..3867189 100644
--- a/apps/desktop/src/store/sessions-store.redaction.test.ts
+++ b/apps/desktop/src/store/sessions-store.redaction.test.ts
@@ -87,6 +87,37 @@ describe("the session history and secrets", () => {
     const entry = recordOutputInChunks(["ghp_abcdefghijklmnop", "qrstuvwxyz012345"]);
 
     expect(entry.outputPreview).not.toContain("ghp_abcdefghijklmnop");
+    // The tail of the token must be gone too: the preview may keep the
+    // placeholder, but not the rest of the token.
+    expect(entry.outputPreview).not.toContain("qrstuvwxyz012345");
+    expect(entry.outputPreview).toContain("[redacted]");
+  });
+
+  it("keeps a private key block out of the preview however long it is", () => {
+    // The output is cut where the preview is cut, and the cut is made where
+    // no construct spans it — so a key block that is longer than any buffer
+    // is still recognised as a block and not as a wall of base64.
+    const body = "A".repeat(70_000);
+    const entry = recordOutputInChunks([
+      `-----BEGIN RSA PRIVATE KEY-----\n${body.slice(0, 35_000)}`,
+      `${body.slice(35_000)}\n-----END RSA PRIVATE KEY-----`,
+    ]);
+
+    expect(entry.outputPreview).not.toMatch(/A{100}/);
+    expect(entry.outputPreview).toContain("[redacted]");
+  });
+
+  it("keeps a secret out of the preview when the output around it is long", () => {
+    // The same boundary, with a credential on a line of its own: the cut
+    // falls between the lines, so the name and the value stay together and
+    // the credential is still masked.
+    const filler = "log line\n".repeat(20_000);
+    const entry = recordOutputInChunks([
+      `${filler}password=synthetic-value\n`,
+      "tail\n",
+    ]);
+
+    expect(entry.outputPreview).not.toContain("synthetic-value");
     expect(entry.outputPreview).toContain("[redacted]");
   });
 
diff --git a/apps/desktop/src/store/sessions-store.ts b/apps/desktop/src/store/sessions-store.ts
index fa231fd..0e80f8d 100644
--- a/apps/desktop/src/store/sessions-store.ts
+++ b/apps/desktop/src/store/sessions-store.ts
@@ -16,7 +16,7 @@ import {
   type SplitDirection,
 } from "../types/session";
 import { closeSession } from "../lib/backend-runtime";
-import { redactSecrets } from "../lib/redact-secrets";
+import { OutputRedactor } from "../lib/redact-secrets";
 import { useAppStore } from "./app-store";
 
 /**
@@ -59,34 +59,29 @@ function limitCommandHistory(commandHistory: SessionCommandHistoryEntry[]) {
   return commandHistory.slice(0, SESSION_HISTORY_LIMIT);
 }
 
-// The raw output of each history entry, kept in memory only.
+// The redactor of each history entry, kept in memory only.
 //
 // The redaction has to see a command's output as a WHOLE: the terminal
 // streams it in pieces, and a secret split across two pieces — "password="
 // in one, the value in the next — is only a secret once the pieces are
-// joined. So the raw text is kept here, in memory, and the preview that
-// goes into the store (and into the local storage the store is written to)
-// is always the redacted form of the whole output.
+// joined. The redactor holds the pieces until it can recognise the secret,
+// and hands back the redacted preview of everything so far.
 //
-// The raw text never enters the store state, so it cannot be persisted.
-const rawCommandOutput = new Map<string, string>();
-
-// How much raw output to keep per entry. The preview keeps the last 600
-// characters, so this is generous; it bounds what a long-running command can
-// hold in memory. The tail is kept, because the preview is the tail.
-const RAW_COMMAND_OUTPUT_LIMIT = 64 * 1024;
+// The redactor never enters the store state, so what it holds cannot be
+// persisted.
+const outputRedactors = new Map<string, OutputRedactor>();
 
 /**
- * Forget the raw output of entries the history no longer holds.
+ * Forget the redactor of entries the history no longer holds.
  *
- * The raw buffer is keyed by history entry, so an entry the history drops
+ * The redactors are keyed by history entry, so an entry the history drops
  * would otherwise leave its output behind for the rest of the session.
  */
 function forgetDroppedCommandOutput(commandHistory: SessionCommandHistoryEntry[]) {
   const held = new Set(commandHistory.map((entry) => entry.id));
-  for (const entryId of rawCommandOutput.keys()) {
+  for (const entryId of outputRedactors.keys()) {
     if (!held.has(entryId)) {
-      rawCommandOutput.delete(entryId);
+      outputRedactors.delete(entryId);
     }
   }
 }
@@ -829,27 +824,19 @@ export const useSessionsStore = create<SessionsState>()(
         // session, and a redacted command would run as something else.
         const redact = useAppStore.getState().redactCommandOutput;
         set((state) => {
-          // The output arrives in pieces. The pieces are joined first and
-          // redacted as a whole, so a secret that straddles two pieces is
-          // still caught — and the ANSI codes are stripped before the
-          // redaction, so a coloured "password=" is still a "password=".
-          const raw = `${rawCommandOutput.get(entryId) ?? ""}${output}`;
-          const kept =
-            raw.length > RAW_COMMAND_OUTPUT_LIMIT
-              ? raw.slice(-RAW_COMMAND_OUTPUT_LIMIT)
-              : raw;
-          rawCommandOutput.set(entryId, kept);
-
-          const normalized = normalizeCommandHistoryOutput(kept);
-          return setPaneCommandHistoryOutput(
-            state,
-            entryId,
-            redact ? redactSecrets(normalized) : normalized
-          );
+          // The output arrives in pieces. The pieces are held by the
+          // redactor until it can recognise a secret that straddles them,
+          // and the preview is always the redacted form of everything seen
+          // so far.
+          const redactor = outputRedactors.get(entryId) ?? new OutputRedactor(redact);
+          redactor.setRedactionEnabled(redact);
+          outputRedactors.set(entryId, redactor);
+
+          return setPaneCommandHistoryOutput(state, entryId, redactor.append(output));
         });
       },
       clearCommandHistory: () => {
-        rawCommandOutput.clear();
+        outputRedactors.clear();
         set(() => ({ commandHistory: [] }));
       },
       queueCommandForHosts: (hosts, command, label) => {
```
