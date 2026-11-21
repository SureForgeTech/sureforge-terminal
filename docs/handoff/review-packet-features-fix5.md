# Follow-up review packet, round 6 — the fifth round of findings

## What you are reviewing

- Repository: `SureForgeTech/sureforge-terminal`
- Read-only checkout: `/workspace/sureforge-terminal` (now at the head below; do not modify it)
- Head you reviewed last: `dd8a02da6128978f981e8646d381a979b9409796` (your verdict: BLOCK, 2 P0 / 2 P1 / 4 P2-P3)
- Head under review now: `d94e2559ace0e8d2ee95ad0035e5188566b07f3d`
- Base of the whole feature range (unchanged): `4d24bdb0055cfecb1e8d013a2155663768e25700`

Two commits were added on top of the head you reviewed: `dd8a02d` (the findings) and `d94e255` (the regression tests you asked for). Nothing below `dd8a02d` changed.

## How to verify

Work from the checkout at `d94e255`. For each finding you raised, decide whether it is actually fixed, by reading the code and running the tests. Re-derive the answer; do not take the description below as evidence that a fix works.

The complete diff of the two commits is at the end of this packet, and is also in `/tmp/opencode/features-fix5-dd8a02d..d94e255.diff`.

## The findings, and where each was addressed

**P0.1 — a token inside an ordinary assignment was released in unredacted fragments.** An ordinary assignment's value is now held until it ends and released as one thing (`plain-value` / `plain-quoted-value`), so a token split across two pieces inside it is masked as a whole.

**P0.2 — a private key header longer than 128 characters was not recognised.** `privateKeyHeaderState` now uses the whole-text pattern for the complete header — the "[A-Z ]*" part may be of any length — and only the "may still become one" case is bounded.

**P1.1 — an unbalanced quote discarded text the whole-text redaction leaves alone.** The value now falls back to the bare value the way the whole-text redaction falls back to it, and the masked value is produced by `maskedValue`, the same shape the whole-text redaction produces: the quotes around the placeholder included, an empty value left alone.

**P1.2 — a growing token was held in full and found again for every piece.** The start of the run is remembered (`runStartCache`) instead of found again, and the text that is held is given up on when it grows past `MAX_HELD_TEXT`: the preview then says less than it could, never more.

## The two non-blocking findings you asked for tests for

- `apps/desktop/src/components/hosts/HostEditor.group.test.tsx` — an existing host keeps the SFTP root it was given when its group changes, a new host takes the group's root, and the user name is only required when neither the host nor the group has one.
- `apps/desktop/src/store/hosts-store.test.ts` — the group's settings are looked up with the trimmed group name.
- `apps/desktop/src/store/sessions-store.redaction.test.ts` — the long output around a credential now splits the credential itself.

The changelog `(#N)` suffix is unchanged: the number is the pull request's, and it does not exist until the pull request is opened. The release script accepts the fragments as they are.

## Validation on the new head

```
$ npm run validate
  Test Files  206 passed (206)
       Tests  1179 passed | 1 skipped (1180)
  ✓ built in ...
  [validate] Docker is unavailable, so semgrep could not run.
exit status: 1
```

Exit 1 is the Docker-gated Semgrep step alone, exactly as on the base commit. `tsc -b` and ESLint are clean.

## What to check

- Whether each finding is genuinely fixed — reproduce the way you reproduced it.
- Whether the redaction still holds. The reference is `redactSecrets(stripTerminalCodes(text))`, truncated to the preview limit; the streaming test in `apps/desktop/src/lib/redact-secrets.streaming.test.ts` pins that property over twenty-nine fixtures, split at every position and at every pair of positions. Please run your own sweep over your own fixtures.
- Whether the redaction is still bounded and still fast: `heldLength` stays small, the time per piece does not grow with the output seen so far, and the safety valve (`MAX_HELD_TEXT`) does not drop ordinary output.
- Whether the value handling now matches the whole-text redaction exactly, including the empty value, the value that is already the placeholder, the quoted value and the value that falls back to the bare form.
- Whether anything else broke: the preview is still set rather than appended; the redaction can be turned off mid-stream; the store keeps one redactor per history entry and forgets it when the entry goes; the whole-text `redactSecrets` is unchanged and still used elsewhere.

The bar is unchanged: zero unresolved P0 or P1 findings.

## Complete diff of the two commits

```diff
diff --git a/apps/desktop/src/components/hosts/HostEditor.group.test.tsx b/apps/desktop/src/components/hosts/HostEditor.group.test.tsx
new file mode 100644
index 0000000..2f2617a
--- /dev/null
+++ b/apps/desktop/src/components/hosts/HostEditor.group.test.tsx
@@ -0,0 +1,146 @@
+// @vitest-environment happy-dom
+//
+// A host and the group it is in.
+//
+// A group's settings are defaults for the hosts in it: a host that leaves
+// the user name or the SFTP root empty takes the group's, and a host that
+// has a value of its own keeps it. The editor is where that is decided, so
+// these tests pin what the editor does with the two.
+//
+// Named HostEditor.group.test rather than HostEditor.test so it does not
+// collide with the sibling HostEditor.test.ts: TypeScript deduplicates
+// same-basename inputs differing only by extension, and the collision kept
+// that file out of the type-check program.
+import { cleanup, fireEvent, render, screen } from "@testing-library/react";
+import { afterEach, beforeEach, describe, expect, it } from "vitest";
+
+import { useGroupSettingsStore } from "../../store/group-settings-store";
+import type { HostRecord } from "../../types/host";
+import { HostEditor } from "./HostEditor";
+
+function makeHost(overrides: Partial<HostRecord>): HostRecord {
+  return {
+    id: "host-1",
+    label: "Example",
+    protocol: "ssh",
+    hostname: "example.internal",
+    username: "operator",
+    port: 22,
+    authMethod: "password",
+    privateKeyPath: "",
+    group: "",
+    tags: [],
+    note: "",
+    favorite: false,
+    keyLabel: "",
+    hostKeyPolicy: "allowUnknown",
+    agentForwarding: false,
+    environment: {},
+    jumpHostId: "",
+    sftpRoot: "",
+    snippetCount: 0,
+    forwardingCount: 0,
+    createdAt: "2026-01-01T00:00:00.000Z",
+    updatedAt: "2026-01-01T00:00:00.000Z",
+    ...overrides,
+  };
+}
+
+/** The advanced section, which holds the group and the SFTP root. */
+function openAdvancedSettings() {
+  const toggle = screen.queryByRole("button", { name: /Show advanced settings/ });
+  if (toggle) {
+    fireEvent.click(toggle);
+  }
+}
+
+function groupInput(): HTMLInputElement {
+  const label = screen.getByText("Group");
+  const input = label.parentElement?.querySelector("input");
+  if (!input) {
+    throw new Error("no group input");
+  }
+  return input as HTMLInputElement;
+}
+
+function sftpRootInput(): HTMLInputElement | null {
+  const label = screen.getByText("SFTP root");
+  return (label.parentElement?.querySelector("input") ?? null) as HTMLInputElement | null;
+}
+
+beforeEach(() => {
+  useGroupSettingsStore.getState().clearGroupSettings("Acme / Production");
+});
+
+afterEach(() => {
+  cleanup();
+  useGroupSettingsStore.getState().clearGroupSettings("Acme / Production");
+});
+
+describe("the host editor and the group's settings", () => {
+  it("does not require a user name when the group has one", () => {
+    useGroupSettingsStore.getState().setGroupSettings("Acme / Production", {
+      username: "ops",
+    });
+
+    render(
+      <HostEditor
+        open
+        host={makeHost({ group: "Acme / Production", username: "" })}
+        onClose={() => {}}
+        onSave={() => {}}
+      />
+    );
+
+    expect(screen.queryByText("A username is required.")).toBeNull();
+  });
+
+  it("still requires a user name when neither the host nor the group has one", () => {
+    render(
+      <HostEditor
+        open
+        host={makeHost({ group: "Acme / Production", username: "" })}
+        onClose={() => {}}
+        onSave={() => {}}
+      />
+    );
+
+    expect(screen.getByText("A username is required.")).toBeTruthy();
+  });
+
+  it("keeps the SFTP root of an existing host when its group changes", () => {
+    // The host was given a root of its own: changing its group must not
+    // take that away from it.
+    useGroupSettingsStore.getState().setGroupSettings("Acme / Production", {
+      sftpRoot: "/srv/app",
+    });
+
+    render(
+      <HostEditor
+        open
+        host={makeHost({ group: "Other", sftpRoot: "/home" })}
+        onClose={() => {}}
+        onSave={() => {}}
+      />
+    );
+    openAdvancedSettings();
+
+    fireEvent.change(groupInput(), { target: { value: "Acme / Production" } });
+
+    expect(sftpRootInput()?.value).toBe("/home");
+  });
+
+  it("takes the group's SFTP root for a new host", () => {
+    useGroupSettingsStore.getState().setGroupSettings("Acme / Production", {
+      sftpRoot: "/srv/app",
+    });
+
+    render(<HostEditor open onClose={() => {}} onSave={() => {}} />);
+    openAdvancedSettings();
+
+    fireEvent.change(groupInput(), { target: { value: "Acme / Production" } });
+
+    // The root is left empty, so the host inherits the group's.
+    expect(sftpRootInput()?.value).toBe("");
+  });
+});
diff --git a/apps/desktop/src/store/hosts-store.test.ts b/apps/desktop/src/store/hosts-store.test.ts
index 036c97c..7f7629a 100644
--- a/apps/desktop/src/store/hosts-store.test.ts
+++ b/apps/desktop/src/store/hosts-store.test.ts
@@ -69,6 +69,28 @@ describe("hosts store helpers", () => {
     useGroupSettingsStore.getState().clearGroupSettings("Acme / Production");
   });
 
+  it("finds the group's root when the group is written with spaces around it", () => {
+    // The group is trimmed when the host is saved, so the settings are
+    // looked up with the trimmed name.
+    useGroupSettingsStore.getState().setGroupSettings("Acme / Production", {
+      sftpRoot: "/srv/app",
+    });
+
+    const created = createHostRecord({
+      ...emptyHostFormValues,
+      label: "Grouped host",
+      hostname: "box.internal",
+      username: "ops",
+      group: "  Acme / Production  ",
+      sftpRoot: "",
+    });
+
+    expect(created.group).toBe("Acme / Production");
+    expect(created.sftpRoot).toBe("");
+
+    useGroupSettingsStore.getState().clearGroupSettings("Acme / Production");
+  });
+
   it("keeps the default SFTP root when no group supplies one", () => {
     const created = createHostRecord({
       ...emptyHostFormValues,
diff --git a/apps/desktop/src/store/sessions-store.redaction.test.ts b/apps/desktop/src/store/sessions-store.redaction.test.ts
index cae6a0a..2fe6e43 100644
--- a/apps/desktop/src/store/sessions-store.redaction.test.ts
+++ b/apps/desktop/src/store/sessions-store.redaction.test.ts
@@ -108,13 +108,14 @@ describe("the session history and secrets", () => {
   });
 
   it("keeps a secret out of the preview when the output around it is long", () => {
-    // The same boundary, with a credential on a line of its own: the cut
-    // falls between the lines, so the name and the value stay together and
-    // the credential is still masked.
+    // The same boundary, with a credential on a line of its own that the
+    // output around it pushes to the end of the preview: the name and the
+    // value are held together until the value arrives, so the credential is
+    // still masked.
     const filler = "log line\n".repeat(20_000);
     const entry = recordOutputInChunks([
-      `${filler}password=synthetic-value\n`,
-      "tail\n",
+      `${filler}password=`,
+      "synthetic-value\n",
     ]);
 
     expect(entry.outputPreview).not.toContain("synthetic-value");
```
