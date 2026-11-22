// The Tauri event names are the contract between the native shell and the
// renderer: Rust emits them, TypeScript listens for them. Both sides spell
// them out, so a one-sided rename breaks the feature silently — and for the
// updater progress there is no live release to notice it until the updater
// feed is alive (#224). This gate reads both sides and fails when they drift
// apart, when a name leaves the `terminal_workspace://` namespace, or when a
// name stops being kebab-case.
//
// Two things the gate must get right, because getting them wrong hides a real
// drift:
//   - Comments are not uses. A commented-out name neither satisfies the
//     coverage check nor makes the two sides differ; otherwise an unchanged
//     comment can conceal a renamed listener.
//   - A name is captured whole. "session-stream.invalid" is not the
//     "session-stream" event, so the token must not be cut at the first
//     character that is not allowed in a name.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const EVENT_NAME = /terminal_workspace:\/\/([^"'\s`]*)/g;
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Remove comments while keeping string literals intact, so a name inside a
// string is found and a name inside a comment is not. Rust has no backtick
// strings and its char literals never contain a comment marker, so only
// double quotes delimit a string there.
function stripComments(source: string, quoteCharacters: string): string {
  let output = "";
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];

    if (quoteCharacters.includes(character)) {
      const quote = character;
      output += character;
      index += 1;
      while (index < source.length) {
        const inner = source[index];
        output += inner;
        if (inner === "\\") {
          output += source[index + 1] ?? "";
          index += 2;
          continue;
        }
        index += 1;
        if (inner === quote) {
          break;
        }
      }
      continue;
    }

    if (character === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      continue;
    }

    if (character === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
      continue;
    }

    output += character;
    index += 1;
  }
  return output;
}

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
      const isRust = file.endsWith(".rs");
      const contents = stripComments(readFileSync(file, "utf8"), isRust ? '"' : '"\'`');
      for (const match of contents.matchAll(EVENT_NAME)) {
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
