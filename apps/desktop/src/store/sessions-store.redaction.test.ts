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
//
// The output arrives from the terminal in PIECES, so the redaction has to see
// the whole output before it keeps any of it: a secret split across two
// pieces is only a secret once the pieces are joined.

describe("the session history and secrets", () => {
  beforeEach(() => {
    useAppStore.setState({ redactCommandOutput: true });
    useSessionsStore.setState({ commandHistory: [] });
  });

  function openPane() {
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
    return entryId;
  }

  function recordOutput(output: string) {
    const entryId = openPane();
    useSessionsStore.getState().appendCommandOutput(entryId, output);
    return useSessionsStore.getState().commandHistory[0];
  }

  function recordOutputInChunks(chunks: string[]) {
    const entryId = openPane();
    for (const chunk of chunks) {
      useSessionsStore.getState().appendCommandOutput(entryId, chunk);
    }
    return useSessionsStore.getState().commandHistory[0];
  }

  it("keeps a secret out of the preview", () => {
    const entry = recordOutput("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY");

    expect(entry.outputPreview).toBeDefined();
    expect(entry.outputPreview).not.toContain("wJalrXUtnFEMIK7MDENGbPxRfiCY");
    expect(entry.outputPreview).toContain("[redacted]");
  });

  it("keeps a secret that straddles two pieces out of the preview", () => {
    // The terminal streams the output in pieces, and a password printed
    // across a piece boundary is still a password.
    const entry = recordOutputInChunks(["password=", "synthetic-value"]);

    expect(entry.outputPreview).toBeDefined();
    expect(entry.outputPreview).not.toContain("synthetic-value");
    expect(entry.outputPreview).toContain("[redacted]");
  });

  it("keeps a secret that straddles two pieces and a colour code out of the preview", () => {
    // The escape codes are stripped before the redaction, so a coloured
    // name is still a name.
    const entry = recordOutputInChunks(["[32mpassword[0m=", "synthetic-value"]);

    expect(entry.outputPreview).not.toContain("synthetic-value");
    expect(entry.outputPreview).toContain("[redacted]");
  });

  it("keeps a token that straddles two pieces out of the preview", () => {
    const entry = recordOutputInChunks(["ghp_abcdefghijklmnop", "qrstuvwxyz012345"]);

    expect(entry.outputPreview).not.toContain("ghp_abcdefghijklmnop");
    // The tail of the token must be gone too: the preview may keep the
    // placeholder, but not the rest of the token.
    expect(entry.outputPreview).not.toContain("qrstuvwxyz012345");
    expect(entry.outputPreview).toContain("[redacted]");
  });

  it("keeps a private key block out of the preview however long it is", () => {
    // The output is cut where the preview is cut, and the cut is made where
    // no construct spans it — so a key block that is longer than any buffer
    // is still recognised as a block and not as a wall of base64.
    const body = "A".repeat(70_000);
    const entry = recordOutputInChunks([
      `-----BEGIN RSA PRIVATE KEY-----\n${body.slice(0, 35_000)}`,
      `${body.slice(35_000)}\n-----END RSA PRIVATE KEY-----`,
    ]);

    expect(entry.outputPreview).not.toMatch(/A{100}/);
    expect(entry.outputPreview).toContain("[redacted]");
  });

  it("keeps a secret out of the preview when the output around it is long", () => {
    // The same boundary, with a credential on a line of its own that the
    // output around it pushes to the end of the preview: the name and the
    // value are held together until the value arrives, so the credential is
    // still masked.
    const filler = "log line\n".repeat(20_000);
    const entry = recordOutputInChunks([
      `${filler}password=`,
      "synthetic-value\n",
    ]);

    expect(entry.outputPreview).not.toContain("synthetic-value");
    expect(entry.outputPreview).toContain("[redacted]");
  });

  it("keeps a secret out of the preview when a colour code splits its name", () => {
    // The escape sequence arrives in two pieces, so the name is split too:
    // "pass" + colour + "word". A name that is split cannot be recognised,
    // so the unfinished sequence is carried into the next piece.
    const entry = recordOutputInChunks(["pass\u001b[", "32mword=synthetic-value"]);

    expect(entry.outputPreview).not.toContain("synthetic-value");
    expect(entry.outputPreview).toContain("[redacted]");
  });

  it("keeps a secret out of the preview when the value is on the next line", () => {
    // The value follows the name across a blank line. The name is what
    // makes the value a secret, so the two are held together until the
    // value arrives.
    const entry = recordOutputInChunks(["password=\n\n", "synthetic-value\n"]);

    expect(entry.outputPreview).not.toContain("synthetic-value");
    expect(entry.outputPreview).toContain("[redacted]");
  });

  it("keeps up with a long stream of small writes", () => {
    // The cost of a piece of output must not grow with the output seen so
    // far: a command that writes a little, very often, must not freeze the
    // app.
    const started = Date.now();
    const entry = recordOutputInChunks(
      Array.from({ length: 4_000 }, (_unused, index) => `line ${index} of output\n`)
    );
    const elapsed = Date.now() - started;

    expect(entry.outputPreview).toContain("line 3999 of output");
    expect(elapsed).toBeLessThan(5_000);
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
