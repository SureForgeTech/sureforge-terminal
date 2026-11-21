// A release must be built from a commit contained in main. The tag/commit
// binding proves which commit was built, not that it was merged: a dispatch
// can name another ref and a local publish can name any checkout. These tests
// pin the compare-status rules and the publish script's refusal before any
// release mutation.
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertBuiltCommitOnDefaultBranch } from "../../scripts/verify-release-provenance.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REPOSITORY = "SureForgeTech/sureforge-terminal";
const BUILT = "1".repeat(40);
const VERSION = "0.2.2";
const UPDATER_KEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEE3QTU5QjAxRjAyMUREM0QKUldROTNTSHdBWnVscDl5MTBQdEhNRVBMcG9MOEp1amdyU3RSVnFtT2hpQkgyaUU4SEpVcXVMcysK";

const FAKE_GH = `#!/usr/bin/env bash
if [[ "$1" == "release" && "$2" == "view" ]]; then
  echo "VIEW $*" >> "$FAKE_LOG"
  [[ "\${FAKE_RELEASE_EXISTS:-0}" == "1" ]] && exit 0
  exit 1
fi
if [[ "$1" == "release" && "$2" == "create" ]]; then
  echo "CREATE $*" >> "$FAKE_LOG"
  exit 0
fi
if [[ "$1" == "release" && "$2" == "upload" ]]; then
  echo "UPLOAD $*" >> "$FAKE_LOG"
  exit 0
fi
if [[ "$1" == "api" ]]; then
  case "$2" in
    */compare/*)
      echo "COMPARE $2" >> "$FAKE_LOG"
      if [[ "\${FAKE_COMPARE_STATE:-ok}" == "broken" ]]; then
        echo "Get https://api.github.com/x: dial tcp: lookup api.github.com: no such host" >&2
        exit 1
      fi
      printf '%s\n' "\${FAKE_COMPARE_STATUS:-ahead}"
      exit 0;;
    *git/ref/tags/*)
      echo "TAG $2" >> "$FAKE_LOG"
      if [[ "\${FAKE_TAG_STATE:-missing}" == "missing" ]]; then
        echo "gh: Not Found (HTTP 404)" >&2
        exit 1
      fi
      printf '%s\\t%s\\n' "\${FAKE_TAG_COMMIT}" "commit"
      exit 0;;
  esac
fi
echo "fake gh: unhandled: $*" >&2
exit 1
`;

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "release-provenance-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "bin"), { recursive: true });
  mkdirSync(join(dir, "src-tauri"), { recursive: true });
  mkdirSync(join(dir, "artifacts/release/promoted/stable"), { recursive: true });
  mkdirSync(join(dir, "promotion"), { recursive: true });

  for (const file of [
    "native-publish-release.sh",
    "load-env.sh",
    "verify-release-tag-commit.mjs",
    "verify-updater-key-match.mjs",
    "verify-release-provenance.mjs",
  ]) {
    copyFileSync(join(ROOT, "scripts", file), join(dir, "scripts", file));
  }
  copyFileSync(join(ROOT, ".env.shared"), join(dir, ".env.shared"));
  writeFileSync(join(dir, "bin", "gh"), FAKE_GH, { mode: 0o755 });
  writeFileSync(join(dir, "promotion", `terminal-workspace-macos-v${VERSION}.zip`), "asset\n");
  writeFileSync(
    join(dir, "src-tauri/tauri.conf.json"),
    `${JSON.stringify({ version: VERSION, plugins: { updater: { pubkey: UPDATER_KEY } } }, null, 2)}\n`,
  );
  writeFileSync(
    join(dir, "artifacts/release/promoted/stable/latest-macos-release.json"),
    `${JSON.stringify(
      {
        version: VERSION,
        commit: BUILT,
        updater: { pubkey: UPDATER_KEY },
        promotion: { directory: join(dir, "promotion"), releaseNotesPath: "" },
      },
      null,
      2,
    )}\n`,
  );
  return dir;
}

function publish(dir: string, env: Record<string, string> = {}) {
  const logPath = join(dir, "gh.log");
  try {
    execFileSync("bash", [join(dir, "scripts/native-publish-release.sh")], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(dir, "bin")}:${process.env.PATH}`,
        GITHUB_REPOSITORY: "owner/repository",
        FAKE_LOG: logPath,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stderr: "", log: readFileSync(logPath, "utf8") };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    let log: string;
    try {
      log = readFileSync(logPath, "utf8");
    } catch {
      log = "";
    }
    return { status: failure.status ?? 1, stderr: failure.stderr ?? "", log };
  }
}

describe("release provenance", () => {
  it("accepts the commit currently on main", () => {
    expect(
      assertBuiltCommitOnDefaultBranch({ builtCommit: BUILT, repository: REPOSITORY, gh: () => "identical\n" }),
    ).toEqual({ builtCommit: BUILT, baseBranch: "main", status: "identical" });
  });

  it("accepts an older commit contained in main and compares it with main", () => {
    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      return "ahead\n";
    };
    expect(
      assertBuiltCommitOnDefaultBranch({ builtCommit: BUILT, repository: REPOSITORY, gh }),
    ).toEqual({ builtCommit: BUILT, baseBranch: "main", status: "ahead" });
    expect(calls[0][1]).toBe(`repos/${REPOSITORY}/compare/${BUILT}...main`);
  });

  it.each(["behind", "diverged", "unexpected"])("refuses compare status %s", (status) => {
    expect(() =>
      assertBuiltCommitOnDefaultBranch({ builtCommit: BUILT, repository: REPOSITORY, gh: () => status }),
    ).toThrow(/not contained in main/);
  });

  it("refuses an empty compare status", () => {
    expect(() =>
      assertBuiltCommitOnDefaultBranch({ builtCommit: BUILT, repository: REPOSITORY, gh: () => "\n" }),
    ).toThrow(/returned no status/);
  });

  it("does not treat an API failure as proof of provenance", () => {
    const gh = () => {
      throw new Error("dial tcp: lookup api.github.com: no such host");
    };
    expect(() =>
      assertBuiltCommitOnDefaultBranch({ builtCommit: BUILT, repository: REPOSITORY, gh }),
    ).toThrow(/no such host/);
  });

  it("refuses when the build commit is unknown", () => {
    expect(() =>
      assertBuiltCommitOnDefaultBranch({ builtCommit: "", repository: REPOSITORY, gh: () => "ahead" }),
    ).toThrow(/names no build commit/);
  });
});

describe("publishing requires a build contained in main", () => {
  it.each(["behind", "diverged"])("refuses a %s build before any release mutation", (status) => {
    const dir = fixture();
    const result = publish(dir, { FAKE_COMPARE_STATUS: status });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not contained in main");
    expect(result.log).toContain("COMPARE");
    expect(result.log).not.toContain("CREATE");
    expect(result.log).not.toContain("UPLOAD");
  });

  it("refuses when provenance cannot be checked", () => {
    const dir = fixture();
    const result = publish(dir, { FAKE_COMPARE_STATE: "broken" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no such host");
    expect(result.log).toContain("COMPARE");
    expect(result.log).not.toContain("CREATE");
    expect(result.log).not.toContain("UPLOAD");
  });

  it("creates the first release for a build contained in main", () => {
    const dir = fixture();
    const result = publish(dir, { FAKE_COMPARE_STATUS: "ahead" });
    expect(result.status).toBe(0);
    expect(result.log).toContain("COMPARE");
    expect(result.log).toContain(`CREATE release create v${VERSION}`);
    expect(result.log).toContain(`--target ${BUILT}`);
    expect(result.log).toContain("UPLOAD release upload");
  });
});
