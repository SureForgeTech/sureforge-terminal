// The bundle being released must trust the same updater public key that the
// release is signed and verified with. The bundle records the key it was
// built with, so a bundle built before a key rotation cannot be released
// against the new key: the feed would be signed with the new key while the
// app inside it still trusts the old one. These tests pin that rule and the
// publish script's refusal.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertUpdaterKeyMatches,
  readUpdaterPubkey,
} from "../../scripts/verify-updater-key-match.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const VERSION = "0.2.2";
const BUILT = "1".repeat(40);
const OLD_KEY = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEI5RkNDNzA0OTAxQzA5N0EKUldSNkNSeVFCTWY4dWQxL0x5MkFtYy9tcUU2QnB6QWprUU9nRDdkRHFjdnRXeGZFL05UUHBCMjAK";
const NEW_KEY = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEE3QTU5QjAxRjAyMUREM0QKUldROTNTSHdBWnVscDl5MTBQdEhNRVBMcG9MOEp1amdyU3RSVnFtT2hpQkgyaUU4SEpVcXVMcysK";

const FAKE_GH = `#!/usr/bin/env bash
if [[ "$1" == "release" && "$2" == "view" ]]; then exit 0; fi
if [[ "$1" == "release" && "$2" == "create" ]]; then echo "CREATE $*" >> "$FAKE_LOG"; exit 0; fi
if [[ "$1" == "release" && "$2" == "upload" ]]; then echo "UPLOAD $*" >> "$FAKE_LOG"; exit 0; fi
if [[ "$1" == "api" ]]; then
  printf '%s\\t%s\\n' "\${FAKE_TAG_COMMIT}" "commit"
  exit 0
fi
echo "fake gh: unhandled: $*" >&2
exit 1
`;

function fixture(manifestUpdater: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "updater-key-match-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "bin"), { recursive: true });
  mkdirSync(join(dir, "src-tauri"), { recursive: true });
  mkdirSync(join(dir, "artifacts/release/promoted/stable"), { recursive: true });
  mkdirSync(join(dir, "promotion"), { recursive: true });

  for (const file of [
    "native-publish-release.sh",
    "load-env.sh",
    "verify-updater-key-match.mjs",
    "verify-release-tag-commit.mjs",
  ]) {
    copyFileSync(join(ROOT, "scripts", file), join(dir, "scripts", file));
  }
  copyFileSync(join(ROOT, ".env.shared"), join(dir, ".env.shared"));
  writeFileSync(join(dir, "bin", "gh"), FAKE_GH, { mode: 0o755 });
  writeFileSync(join(dir, "promotion", `terminal-workspace-macos-v${VERSION}.zip`), "asset\n");
  writeFileSync(
    join(dir, "src-tauri/tauri.conf.json"),
    `${JSON.stringify({ version: VERSION, plugins: { updater: { pubkey: NEW_KEY } } }, null, 2)}\n`,
  );
  writeFileSync(
    join(dir, "artifacts/release/promoted/stable/latest-macos-release.json"),
    `${JSON.stringify(
      {
        version: VERSION,
        commit: BUILT,
        updater: manifestUpdater,
        promotion: { directory: join(dir, "promotion"), releaseNotesPath: "" },
      },
      null,
      2,
    )}\n`,
  );
  return dir;
}

function publish(dir: string) {
  const log = join(dir, "gh.log");
  try {
    execFileSync("bash", [join(dir, "scripts/native-publish-release.sh")], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(dir, "bin")}:${process.env.PATH}`,
        GITHUB_REPOSITORY: "owner/repository",
        FAKE_LOG: log,
        FAKE_TAG_COMMIT: BUILT,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stderr: "", log: readFileSync(log, "utf8") };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    let log = "";
    try {
      log = readFileSync(log, "utf8");
    } catch {
      log = "";
    }
    return { status: failure.status ?? 1, stderr: failure.stderr ?? "", log };
  }
}

describe("updater key match", () => {
  it("reads the updater public key from the app config", () => {
    const dir = fixture({ pubkey: NEW_KEY });
    expect(readUpdaterPubkey(join(dir, "src-tauri/tauri.conf.json"))).toBe(NEW_KEY);
    rmSync(dir, { force: true, recursive: true });
  });

  it("accepts a bundle that trusts the key the checkout signs with", () => {
    const dir = fixture({ pubkey: NEW_KEY });
    const manifest = JSON.parse(
      readFileSync(join(dir, "artifacts/release/promoted/stable/latest-macos-release.json"), "utf8"),
    );
    expect(
      assertUpdaterKeyMatches({
        manifest,
        tauriConf: join(dir, "src-tauri/tauri.conf.json"),
      }),
    ).toEqual({ pubkey: NEW_KEY });
    rmSync(dir, { force: true, recursive: true });
  });

  it("refuses a bundle built with another key", () => {
    const dir = fixture({ pubkey: OLD_KEY });
    const manifest = JSON.parse(
      readFileSync(join(dir, "artifacts/release/promoted/stable/latest-macos-release.json"), "utf8"),
    );
    expect(() =>
      assertUpdaterKeyMatches({
        manifest,
        tauriConf: join(dir, "src-tauri/tauri.conf.json"),
      }),
    ).toThrow(/trusts updater key/);
    rmSync(dir, { force: true, recursive: true });
  });

  it("refuses a bundle that records no key", () => {
    const dir = fixture({});
    const manifest = JSON.parse(
      readFileSync(join(dir, "artifacts/release/promoted/stable/latest-macos-release.json"), "utf8"),
    );
    expect(() =>
      assertUpdaterKeyMatches({
        manifest,
        tauriConf: join(dir, "src-tauri/tauri.conf.json"),
      }),
    ).toThrow(/records no updater public key/);
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("publishing refuses a bundle that no longer trusts the signing key", () => {
  it("refuses a bundle built before the key rotation", () => {
    const dir = fixture({ pubkey: OLD_KEY });
    const result = publish(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("trusts updater key");
    expect(result.log).not.toContain("UPLOAD");
    rmSync(dir, { force: true, recursive: true });
  });

  it("refuses a bundle that records no key", () => {
    const dir = fixture({});
    const result = publish(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("records no updater public key");
    expect(result.log).not.toContain("UPLOAD");
    rmSync(dir, { force: true, recursive: true });
  });

  it("publishes a bundle that trusts the signing key", () => {
    const dir = fixture({ pubkey: NEW_KEY });
    const result = publish(dir);
    expect(result.status).toBe(0);
    expect(result.log).toContain("UPLOAD release upload");
    rmSync(dir, { force: true, recursive: true });
  });
});
