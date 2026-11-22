// The Tauri event names are the contract between the native shell and the
// renderer: Rust emits them, TypeScript listens for them. Both sides spell
// them out, so a one-sided rename breaks the feature silently — and for the
// updater progress there is no live release to notice it until the updater
// feed is alive (#224). This gate reads both sides and fails when they drift
// apart, when a name leaves the `terminal_workspace://` namespace, or when a
// name stops being kebab-case.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const EVENT_TOKEN = /terminal_workspace:\/\/([A-Za-z0-9_-]+)/g;
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (/\.(ts|tsx|rs)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

function eventNames(directories: string[]): Map<string, string[]> {
  const names = new Map<string, string[]>();
  for (const directory of directories) {
    for (const file of sourceFiles(join(ROOT, directory))) {
      const contents = readFileSync(file, "utf8");
      for (const match of contents.matchAll(EVENT_TOKEN)) {
        const name = match[1];
        const owners = names.get(name) ?? [];
        owners.push(`${directory}/${file.slice(ROOT.length + 1)}`);
        names.set(name, owners);
      }
    }
  }
  return names;
}

const rustNames = eventNames(["src-tauri/src"]);
const typescriptNames = eventNames(["apps/desktop/src", "apps/desktop/server"]);

describe("Tauri event names", () => {
  it("names the same events on both sides of the native boundary", () => {
    expect([...typescriptNames.keys()].sort()).toEqual([...rustNames.keys()].sort());
  });

  it("keeps every event name in the namespace and in kebab-case", () => {
    for (const name of [...rustNames.keys(), ...typescriptNames.keys()]) {
      expect(name).toMatch(KEBAB_CASE);
    }
  });

  it("covers the events both sides depend on, so a gate that scanned nothing cannot pass", () => {
    expect(rustNames.size).toBeGreaterThan(0);
    for (const name of [
      "session-stream",
      "update-install-progress",
      "window-close-requested",
      "menu-event",
    ]) {
      expect(rustNames.has(name)).toBe(true);
      expect(typescriptNames.has(name)).toBe(true);
    }
  });
});
