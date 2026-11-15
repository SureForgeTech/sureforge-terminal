import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Guard (#485): the pattern below turned typed IPC rejections into "[object Object]"
 * in sixteen places. It must not come back; use errorMessageFromUnknown (apps/desktop/src/lib/error-message.ts).
 */
describe("no hand-rolled error-to-text conversions", () => {
  const sourceRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../../apps/desktop/src");
  const pattern = /instanceof Error \? [\w.]+\.message : String\(/;

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name: string) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        return sourceFiles(path);
      }
      return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }

  it("finds none under apps/desktop/src", () => {
    const offenders: string[] = sourceFiles(sourceRoot)
      .filter((path) => pattern.test(readFileSync(path, "utf8")))
      .map((path) => relative(sourceRoot, path));
    expect(offenders).toEqual([]);
  });
});
