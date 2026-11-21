// @vitest-environment happy-dom
//
// A host and the group it is in.
//
// A group's settings are defaults for the hosts in it: a host that leaves
// the user name or the SFTP root empty takes the group's, and a host that
// has a value of its own keeps it. The editor is where that is decided, so
// these tests pin what the editor does with the two.
//
// Named HostEditor.group.test rather than HostEditor.test so it does not
// collide with the sibling HostEditor.test.ts: TypeScript deduplicates
// same-basename inputs differing only by extension, and the collision kept
// that file out of the type-check program.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useGroupSettingsStore } from "../../store/group-settings-store";
import type { HostRecord } from "../../types/host";
import { HostEditor } from "./HostEditor";

function makeHost(overrides: Partial<HostRecord>): HostRecord {
  return {
    id: "host-1",
    label: "Example",
    protocol: "ssh",
    hostname: "example.internal",
    username: "operator",
    port: 22,
    authMethod: "password",
    privateKeyPath: "",
    group: "",
    tags: [],
    note: "",
    favorite: false,
    keyLabel: "",
    hostKeyPolicy: "allowUnknown",
    agentForwarding: false,
    environment: {},
    jumpHostId: "",
    sftpRoot: "",
    snippetCount: 0,
    forwardingCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The advanced section, which holds the group and the SFTP root. */
function openAdvancedSettings() {
  const toggle = screen.queryByRole("button", { name: /Show advanced settings/ });
  if (toggle) {
    fireEvent.click(toggle);
  }
}

function groupInput(): HTMLInputElement {
  const label = screen.getByText("Group");
  const input = label.parentElement?.querySelector("input");
  if (!input) {
    throw new Error("no group input");
  }
  return input as HTMLInputElement;
}

function sftpRootInput(): HTMLInputElement | null {
  const label = screen.getByText("SFTP root");
  return (label.parentElement?.querySelector("input") ?? null) as HTMLInputElement | null;
}

beforeEach(() => {
  useGroupSettingsStore.getState().clearGroupSettings("Acme / Production");
});

afterEach(() => {
  cleanup();
  useGroupSettingsStore.getState().clearGroupSettings("Acme / Production");
});

describe("the host editor and the group's settings", () => {
  it("does not require a user name when the group has one", () => {
    useGroupSettingsStore.getState().setGroupSettings("Acme / Production", {
      username: "ops",
    });

    render(
      <HostEditor
        open
        host={makeHost({ group: "Acme / Production", username: "" })}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    expect(screen.queryByText("A username is required.")).toBeNull();
  });

  it("still requires a user name when neither the host nor the group has one", () => {
    render(
      <HostEditor
        open
        host={makeHost({ group: "Acme / Production", username: "" })}
        onClose={() => {}}
        onSave={() => {}}
      />
    );

    expect(screen.getByText("A username is required.")).toBeTruthy();
  });

  it("keeps the SFTP root of an existing host when its group changes", () => {
    // The host was given a root of its own: changing its group must not
    // take that away from it.
    useGroupSettingsStore.getState().setGroupSettings("Acme / Production", {
      sftpRoot: "/srv/app",
    });

    render(
      <HostEditor
        open
        host={makeHost({ group: "Other", sftpRoot: "/home" })}
        onClose={() => {}}
        onSave={() => {}}
      />
    );
    openAdvancedSettings();

    fireEvent.change(groupInput(), { target: { value: "Acme / Production" } });

    expect(sftpRootInput()?.value).toBe("/home");
  });

  it("takes the group's SFTP root for a new host", () => {
    useGroupSettingsStore.getState().setGroupSettings("Acme / Production", {
      sftpRoot: "/srv/app",
    });

    render(<HostEditor open onClose={() => {}} onSave={() => {}} />);
    openAdvancedSettings();

    fireEvent.change(groupInput(), { target: { value: "Acme / Production" } });

    // The root is left empty, so the host inherits the group's.
    expect(sftpRootInput()?.value).toBe("");
  });
});
