// The Tauri event names are the contract between the native shell and the
// renderer: Rust emits them, TypeScript listens for them. Both sides spell
// them out, so the list lives in one file — src-tauri/tauri-events.txt — and
// each side is checked against it. A name that changes on one side only
// fails that side's test, and the crate's own test does the same for the
// native half.
//
// This test reads the renderer's constants as values, so it cannot be fooled
// by a renamed or malformed literal, and it reads the shared list as data,
// so a comment or a string elsewhere in the tree cannot satisfy it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MENU_EVENT_NAME,
  SESSION_STREAM_EVENT_NAME,
  UPDATE_INSTALL_PROGRESS_EVENT_NAME,
  WINDOW_CLOSE_REQUESTED_EVENT,
} from "../../apps/desktop/src/lib/tauri-events";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const EVENT_NAME = /^terminal_workspace:\/\/[a-z0-9]+(-[a-z0-9]+)*$/;

function sharedEventNames(): Set<string> {
  const contents = readFileSync(join(ROOT, "src-tauri/tauri-events.txt"), "utf8");
  const names = new Set<string>();
  for (const line of contents.split("\n")) {
    const name = line.trim();
    if (!name || name.startsWith("#")) {
      continue;
    }
    names.add(name);
  }
  return names;
}

describe("Tauri event names", () => {
  it("uses exactly the names the native shell and the renderer share", () => {
    const rendererNames = new Set([
      MENU_EVENT_NAME,
      SESSION_STREAM_EVENT_NAME,
      UPDATE_INSTALL_PROGRESS_EVENT_NAME,
      WINDOW_CLOSE_REQUESTED_EVENT,
    ]);
    expect(rendererNames).toEqual(sharedEventNames());
  });

  it("keeps every shared name in the namespace and in kebab-case", () => {
    for (const name of sharedEventNames()) {
      expect(name).toMatch(EVENT_NAME);
    }
  });

  it("covers the events both sides depend on, so an empty list cannot pass", () => {
    expect(sharedEventNames().size).toBeGreaterThan(0);
    for (const name of [
      "terminal_workspace://menu-event",
      "terminal_workspace://session-stream",
      "terminal_workspace://update-install-progress",
      "terminal_workspace://window-close-requested",
    ]) {
      expect(sharedEventNames().has(name)).toBe(true);
    }
  });
});
