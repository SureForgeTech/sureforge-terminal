import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

function runAudit(scenario: string, auditStatus = 0, activeTarget = "") {
  const root = mkdtempSync(join(tmpdir(), "tw-audit-exceptions-"));
  const bin = join(root, "bin");
  const callsPath = join(root, "calls");
  for (const directory of [bin, join(root, "scripts"), join(root, "src-tauri")]) {
    mkdirSync(directory);
  }
  writeFileSync(join(root, "scripts/native-audit.sh"), readFileSync("scripts/native-audit.sh"));
  writeFileSync(join(root, "src-tauri/audit.toml"), readFileSync("src-tauri/audit.toml"));
  writeFileSync(join(bin, "cargo-audit"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(bin, "cargo"), `#!/bin/sh
printf '%s\\n' "$*" >> "$AUDIT_TEST_CALLS"
if [ "$1" = audit ]; then exit "$AUDIT_TEST_STATUS"; fi
if [ "$1" != tree ]; then exit 90; fi
if [ "$AUDIT_TEST_SCENARIO" = graph-failure ]; then exit 42; fi
target=
while [ "$#" -gt 0 ]; do
  if [ "$1" = --target ]; then shift; target="$1"; fi
  shift
done
printf 'terminal-workspace v0.2.1\\n'
if [ "$AUDIT_TEST_TARGET" = "$target" ]; then
  printf '%s v0.1.0\\n' "$AUDIT_TEST_SCENARIO"
fi
exit 0
`, { mode: 0o755 });
  try {
    const result = spawnSync("/bin/bash", [join(root, "scripts/native-audit.sh")], {
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        AUDIT_TEST_CALLS: callsPath,
        AUDIT_TEST_SCENARIO: scenario,
        AUDIT_TEST_STATUS: String(auditStatus),
        AUDIT_TEST_TARGET: activeTarget,
      },
      encoding: "utf8",
      timeout: 20_000,
    });
    return { ...result, calls: readFileSync(callsPath, "utf8").trim().split("\n") };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it("applies exceptions only after checking both macOS dependency graphs", () => {
  const result = runAudit("absent");
  expect(result.status).toBe(0);
  expect(result.calls).toEqual([
    "tree --locked --edges normal,build --target aarch64-apple-darwin --prefix none --format {p}",
    "tree --locked --edges normal,build --target x86_64-apple-darwin --prefix none --format {p}",
    "audit --ignore RUSTSEC-2023-0071 --ignore RUSTSEC-2026-0235",
  ]);
}, 30_000);

it.each([
  ["rsa", "aarch64-apple-darwin"],
  ["rkyv", "x86_64-apple-darwin"],
  ["chrono", "x86_64-apple-darwin"],
])("refuses to audit when %s enters the %s build", (name, target) => {
  const result = runAudit(name, 0, target);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`${name} is in the ${target} dependency graph`);
  expect(result.calls.some((call) => call.startsWith("audit "))).toBe(false);
}, 30_000);

it("fails closed when the dependency graph cannot be read", () => {
  const result = runAudit("graph-failure");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Could not verify");
  expect(result.calls.some((call) => call.startsWith("audit "))).toBe(false);
}, 30_000);

it("preserves an advisory scan failure after the graph checks pass", () => {
  expect(runAudit("absent", 7).status).toBe(7);
}, 30_000);
