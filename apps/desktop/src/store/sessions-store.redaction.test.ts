import { beforeEach, describe, expect, it, vi } from "vitest";

// The backend runtime is only partly mocked: the app store asks it whether
// the Tauri runtime is present.
vi.mock("../lib/backend-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/backend-runtime")>()),
  closeSession: vi.fn(() => Promise.resolve({ ok: true })),
}));

import { sampleHosts } from "../types/host";
import { useAppStore } from "./app-store";
import { useSessionsStore } from "./sessions-store";

// The session history persists a preview of what a command printed. A command
// that prints a secret would leave it in the local storage the history is
// written to, so the preview is redacted before it is kept.
//
// The command itself is NOT redacted: the history replays it into a session,
// and a redacted command would run as something else.

describe("the session history and secrets", () => {
  beforeEach(() => {
    useAppStore.setState({ redactCommandOutput: true });
    useSessionsStore.setState({ commandHistory: [] });
  });

  function recordOutput(output: string) {
    const tabId = useSessionsStore.getState().openSession(sampleHosts[0]);
    const state = useSessionsStore.getState();
    const paneId = state.tabs.find((tab) => tab.id === tabId)?.paneIds[0];
    if (!paneId) {
      throw new Error("no pane");
    }
    const entryId = useSessionsStore.getState().recordPaneCommand(paneId, "cat .env");
    if (!entryId) {
      throw new Error("no history entry");
    }
    useSessionsStore.getState().appendCommandOutput(entryId, output);
    return useSessionsStore.getState().commandHistory[0];
  }

  it("keeps a secret out of the preview", () => {
    const entry = recordOutput("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY");

    expect(entry.outputPreview).toBeDefined();
    expect(entry.outputPreview).not.toContain("wJalrXUtnFEMIK7MDENGbPxRfiCY");
    expect(entry.outputPreview).toContain("[redacted]");
  });

  it("keeps ordinary output readable", () => {
    const entry = recordOutput("total 24\nrelease.tar.gz  1024");

    expect(entry.outputPreview).toContain("release.tar.gz");
    expect(entry.outputPreview).not.toContain("[redacted]");
  });

  it("keeps the command itself, because the history replays it", () => {
    const entry = recordOutput("nothing secret here");

    expect(entry.command).toBe("cat .env");
  });

  it("leaves the output alone when the user turns redaction off", () => {
    useAppStore.setState({ redactCommandOutput: false });
    const entry = recordOutput("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY");

    expect(entry.outputPreview).toContain("wJalrXUtnFEMIK7MDENGbPxRfiCY");
  });
});
