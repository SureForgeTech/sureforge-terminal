// The release tag must name the commit the published assets were built from.
// The workflow used to start on a pushed `v*` tag, which made that binding
// true by construction; the dispatch path takes the tag as free text, and a
// GitHub Release can be created for a tag that already exists (GitHub then
// ignores `target_commitish`), so the publish step proves the binding
// instead of trusting it. These tests pin the tag resolution rules and the
// publish script's create, re-publish and refusal paths.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTagCommit } from "../../scripts/verify-release-tag-commit.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REPOSITORY = "SureForgeTech/sureforge-terminal";
const BUILT = "1".repeat(40);
const OTHER = "2".repeat(40);
const ANNOTATED = "3".repeat(40);
const VERSION = "0.2.2";
const UPDATER_KEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEE3QTU5QjAxRjAyMUREM0QKUldROTNTSHdBWnVscDl5MTBQdEhNRVBMcG9MOEp1amdyU3RSVnFtT2hpQkgyaUU4SEpVcXVMcysK";

const FAKE_GH = `#!/usr/bin/env bash
if [[ "$1" == "release" && "$2" == "view" ]]; then
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
  echo "API $*" >> "$FAKE_LOG"
  case "\${FAKE_TAG_STATE:-present}" in
    missing) echo "gh: Not Found (HTTP 404)" >&2; exit 1;;
    broken) echo "Get https://api.github.com/x: dial tcp: lookup api.github.com: no such host" >&2; exit 1;;
    present) printf '%s\\t%s\\n' "\${FAKE_TAG_COMMIT}" "commit"; exit 0;;
  esac
fi
echo "fake gh: unhandled: $*" >&2
exit 1
`;

function fakeGh(responses: Record<string, string>) {
  return (args: string[]) => {
    const apiPath = args[1] ?? "";
    const response = responses[apiPath];
    if (response === undefined) {
      throw new Error(`unexpected gh api path: ${apiPath}`);
    }
    return response;
  };
}

function ghNotFound() {
  const error = new Error("gh: Not Found (HTTP 404)") as Error & { stderr?: string };
  error.stderr = "gh: Not Found (HTTP 404)";
  return error;
}

function ghBroken() {
  const error = new Error("dial tcp: lookup api.github.com: no such host") as Error & { stderr?: string };
  error.stderr = "dial tcp: lookup api.github.com: no such host";
  return error;
}

function fixture(manifest: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "release-tag-commit-"));
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
        ...manifest,
      },
      null,
      2,
    )}\n`,
  );
  return dir;
}

function publish(dir: string, env: Record<string, string> = {}) {
  const log = join(dir, "gh.log");
  try {
    const stdout = execFileSync("bash", [join(dir, "scripts/native-publish-release.sh")], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(dir, "bin")}:${process.env.PATH}`,
        GITHUB_REPOSITORY: "owner/repository",
        FAKE_LOG: log,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "", log: readFileSync(log, "utf8") };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      log: existsSafe(log) ? readFileSync(log, "utf8") : "",
    };
  }
}

function existsSafe(path: string) {
  try {
    readFileSync(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

describe("release tag to build commit binding", () => {
  it("resolves a lightweight tag to the commit it names", () => {
    const gh = fakeGh({ [`repos/${REPOSITORY}/git/ref/tags/v${VERSION}`]: `${BUILT}\tcommit` });
    expect(resolveTagCommit("v" + VERSION, REPOSITORY, gh)).toBe(BUILT);
  });

  it("dereferences an annotated tag to the commit it wraps", () => {
    const gh = fakeGh({
      [`repos/${REPOSITORY}/git/ref/tags/v${VERSION}`]: `${ANNOTATED}\ttag`,
      [`repos/${REPOSITORY}/git/tags/${ANNOTATED}`]: BUILT,
    });
    expect(resolveTagCommit("v" + VERSION, REPOSITORY, gh)).toBe(BUILT);
  });

  it("resolves nothing when the tag does not exist", () => {
    const gh = () => {
      throw ghNotFound();
    };
    expect(resolveTagCommit("v" + VERSION, REPOSITORY, gh)).toBeNull();
  });

  it("refuses to guess when the lookup itself failed", () => {
    const gh = () => {
      throw ghBroken();
    };
    expect(() => resolveTagCommit("v" + VERSION, REPOSITORY, gh)).toThrow(/no such host/);
  });
});

describe("publishing a release keeps the tag and the assets on one commit", () => {
  it("creates the first release at the commit the assets were built from", () => {
    const dir = fixture();
    const result = publish(dir, { FAKE_TAG_STATE: "missing" });
    expect(result.status).toBe(0);
    expect(result.log).toContain(`CREATE release create v${VERSION}`);
    expect(result.log).toContain(`--target ${BUILT}`);
    expect(result.log).toContain("UPLOAD release upload");
    rmSync(dir, { force: true, recursive: true });
  });

  it("refuses a first release whose tag already names another commit", () => {
    const dir = fixture();
    const result = publish(dir, { FAKE_TAG_STATE: "present", FAKE_TAG_COMMIT: OTHER });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`tag 'v${VERSION}' names commit '${OTHER}'`);
    expect(result.log).toContain("API");
    expect(result.log).not.toContain("UPLOAD");
    rmSync(dir, { force: true, recursive: true });
  });

  it("creates the release when the existing tag names the built commit", () => {
    const dir = fixture();
    const result = publish(dir, { FAKE_TAG_STATE: "present", FAKE_TAG_COMMIT: BUILT });
    expect(result.status).toBe(0);
    expect(result.log).toContain(`CREATE release create v${VERSION}`);
    expect(result.log).toContain("UPLOAD release upload");
    rmSync(dir, { force: true, recursive: true });
  });

  it("refuses to replace the assets of a release whose tag names another commit", () => {
    const dir = fixture();
    const result = publish(dir, {
      FAKE_RELEASE_EXISTS: "1",
      FAKE_TAG_STATE: "present",
      FAKE_TAG_COMMIT: OTHER,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`tag 'v${VERSION}' names commit '${OTHER}'`);
    expect(result.log).toContain("API");
    expect(result.log).not.toContain("UPLOAD");
    rmSync(dir, { force: true, recursive: true });
  });

  it("replaces the assets of a release whose tag names the built commit", () => {
    const dir = fixture();
    const result = publish(dir, {
      FAKE_RELEASE_EXISTS: "1",
      FAKE_TAG_STATE: "present",
      FAKE_TAG_COMMIT: BUILT,
    });
    expect(result.status).toBe(0);
    expect(result.log).not.toContain("CREATE");
    expect(result.log).toContain("UPLOAD release upload");
    expect(result.log).toContain("--clobber");
    rmSync(dir, { force: true, recursive: true });
  });

  it("refuses a release target that is not the commit the assets were built from", () => {
    const dir = fixture();
    const result = publish(dir, { FAKE_TAG_STATE: "missing", RELEASE_TARGET: OTHER });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("RELEASE_TARGET");
    expect(result.log).not.toContain("CREATE");
    rmSync(dir, { force: true, recursive: true });
  });

  it("refuses to publish when the tag cannot be resolved", () => {
    const dir = fixture();
    const result = publish(dir, { FAKE_TAG_STATE: "broken" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("could not resolve the release tag");
    expect(result.log).not.toContain("CREATE");
    rmSync(dir, { force: true, recursive: true });
  });

  it("refuses to publish when the promoted manifest names no build commit", () => {
    const dir = fixture({ commit: null });
    const result = publish(dir, { FAKE_TAG_STATE: "present", FAKE_TAG_COMMIT: BUILT });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("names no build commit");
    expect(result.log).not.toContain("CREATE");
    rmSync(dir, { force: true, recursive: true });
  });
});
