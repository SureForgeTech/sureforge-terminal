#!/usr/bin/env bash
set -euo pipefail

# #226: the enforcing cargo-audit invocation.
#
# src-tauri/audit.toml has always DESCRIBED an "enforcing invocation" and claimed
# the tree was verified clean, but nothing ran it — no workflow, no script, no
# npm script. The claim rotted exactly as you would expect: when this script was
# written the tree had FOUR advisories, two of them 7.5 high, and nobody knew.
#
# This matters more here than in most repos because Cargo.toml builds ssh2 with
# vendored-openssl, so OpenSSL is statically linked into the shipped app. An
# advisory there needs a rebuild — the OS cannot patch it underneath the binary.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/src-tauri"

if ! command -v cargo-audit >/dev/null 2>&1 && ! cargo audit --version >/dev/null 2>&1; then
  echo "[native-audit] cargo-audit is not installed." >&2
  echo "[native-audit] Install it with: cargo install cargo-audit --locked" >&2
  exit 1
fi

# Advisories consciously accepted, mirroring src-tauri/audit.toml. The installed
# cargo-audit does NOT auto-load that file's ignore table — verified by control
# experiment: running with and without audit.toml present produces identical
# output, including the supposedly-ignored advisory. So the ignores are passed
# explicitly here, and the drift check below is what keeps the two in sync.
IGNORE_IDS=(
  RUSTSEC-2023-0071 # rsa — optional MySQL backend only; must remain unbuilt
  RUSTSEC-2026-0235 # rkyv — lockfile-only, never compiled into this app
)

# Two sources of truth for one list is how the previous claim went stale, so a
# disagreement is a hard failure rather than a warning nobody reads.
CONFIG_IDS="$(sed -nE 's/^[[:space:]]*"(RUSTSEC-[0-9]{4}-[0-9]{4})".*/\1/p' audit.toml | LC_ALL=C sort)"
CLI_IDS="$(printf '%s\n' "${IGNORE_IDS[@]}" | LC_ALL=C sort)"
if [[ "$CONFIG_IDS" != "$CLI_IDS" ]]; then
  echo "[native-audit] audit.toml and this script's ignore list disagree." >&2
  echo "[native-audit] audit.toml:" >&2
  printf '  %s\n' $CONFIG_IDS >&2
  echo "[native-audit] script:" >&2
  printf '  %s\n' $CLI_IDS >&2
  echo "[native-audit] Update both, and justify any new ignore in audit.toml." >&2
  exit 1
fi

# Scorecard can see optional and non-macOS packages in Cargo.lock. The audit
# exceptions and advisory triage are valid only while these crates stay outside
# the normal/build graph for both shipped targets.
LOCKFILE_ONLY_PACKAGES=(chrono glib proc-macro-error rkyv rsa zbus_names zvariant zvariant_derive)
for target in aarch64-apple-darwin x86_64-apple-darwin; do
  if ! dependency_tree="$(cargo tree --locked --edges normal,build --target "$target" --prefix none --format '{p}')"; then
    echo "[native-audit] Could not verify the dependency graph for $target." >&2
    exit 1
  fi
  for package in "${LOCKFILE_ONLY_PACKAGES[@]}"; do
    if grep -qE "^${package} v" <<<"$dependency_tree"; then
      echo "[native-audit] $package is in the $target dependency graph. Re-evaluate its advisory before continuing." >&2
      exit 1
    fi
  done
done

IGNORE_ARGS=()
for id in "${IGNORE_IDS[@]}"; do
  IGNORE_ARGS+=(--ignore "$id")
done

echo "[native-audit] cargo audit (${#IGNORE_IDS[@]} accepted advisories)"
# No --deny warnings: the gtk-rs GTK3 bindings report as unmaintained, and those
# are Linux-only deps Tauri links for a target this app does not ship. They stay
# visible and non-failing on purpose.
#
# A fetch failure of the advisory database is a FAILURE, not a skip. A scanner
# that silently checks nothing is the exact condition this script exists to end.
cargo audit "${IGNORE_ARGS[@]}"
