#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/load-env.sh"

CHANNEL="${MACOS_RELEASE_CHANNEL:-stable}"
PROMOTED_MANIFEST_PATH="$ROOT_DIR/artifacts/release/promoted/$CHANNEL/latest-macos-release.json"
DRY_RUN="${RELEASE_DRY_RUN:-0}"
RELEASE_TARGET="${RELEASE_TARGET:-}"
SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"

if [[ ! -f "$PROMOTED_MANIFEST_PATH" ]]; then
  echo "Promoted release manifest not found at $PROMOTED_MANIFEST_PATH" >&2
  exit 1
fi

mapfile -t PUBLISH_INFO < <(MANIFEST_PATH="$PROMOTED_MANIFEST_PATH" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH, "utf8"));
const promotionDirectory = manifest.promotion?.directory;

if (!promotionDirectory || !fs.existsSync(promotionDirectory)) {
  throw new Error(`Promotion directory missing: ${promotionDirectory ?? "unknown"}`);
}

const version = manifest.version;
const tag = process.env.RELEASE_TAG || `v${version}`;
const releaseName = process.env.RELEASE_NAME || `Terminal Workspace ${tag}`;
const releaseNotesPath = manifest.promotion?.releaseNotesPath || "";
const latestManifestPath = manifest.promotion?.latestManifestPath || process.env.MANIFEST_PATH;
const assetPaths = fs.readdirSync(promotionDirectory)
  .sort((left, right) => left.localeCompare(right))
  .map((entry) => path.join(promotionDirectory, entry));

if (!assetPaths.includes(latestManifestPath) && fs.existsSync(latestManifestPath)) {
  assetPaths.push(latestManifestPath);
}

console.log(version);
console.log(tag);
console.log(releaseName);
console.log(promotionDirectory);
console.log(releaseNotesPath);
console.log(JSON.stringify(assetPaths));
console.log(manifest.commit || "");
NODE
)

VERSION="${PUBLISH_INFO[0]}"
RELEASE_TAG="${PUBLISH_INFO[1]}"
RELEASE_NAME="${PUBLISH_INFO[2]}"
PROMOTION_DIRECTORY="${PUBLISH_INFO[3]}"
RELEASE_NOTES_PATH="${PUBLISH_INFO[4]}"
ASSET_PATHS_JSON="${PUBLISH_INFO[5]}"
# The commit the promoted bundle was built from. The release tag must name
# this commit: the tag trigger the workflow used to have made that true by
# construction, and the dispatch path does not.
BUILT_COMMIT="${PUBLISH_INFO[6]}"

mapfile -t ASSET_PATHS < <(ASSET_PATHS_JSON="$ASSET_PATHS_JSON" node <<'NODE'
const assets = JSON.parse(process.env.ASSET_PATHS_JSON);
for (const asset of assets) {
  console.log(asset);
}
NODE
)

# #379: a release tag that disagrees with the promoted manifest publishes a
# mislabelled release (and latest.json would advertise a different version than
# the tag it lives under). Refuse rather than trust the caller.
if [[ "$RELEASE_TAG" != "v$VERSION" ]]; then
  echo "ERROR: RELEASE_TAG '$RELEASE_TAG' does not match the promoted version 'v$VERSION'." >&2
  exit 1
fi

# #241 / #379: every content gate runs BEFORE the GitHub release exists, so a
# failure cannot leave an empty or half-populated release behind under the tag.
# Promotion emits latest.json, a signed .app.tar.gz and its .sig only when the
# signing key is present; this script uploads whatever it is handed. Between the
# two, a release could publish successfully with a dead update feed — which is
# exactly what happened to v0.1.0 (#224). Checked here as well as in promotion
# because the two run as separate steps: promotion can be re-run, skipped, or its
# output staged from elsewhere, so publish is the last point where the release
# contents are known.
if [[ "${REQUIRE_UPDATER_ARTIFACTS:-0}" == "1" ]]; then
  bash "$SCRIPT_DIR/verify-updater-artifacts.sh" "${ASSET_PATHS[@]}"
  UPDATER_TARBALL=""
  for asset in "${ASSET_PATHS[@]}"; do
    [[ "$asset" == *.app.tar.gz ]] && UPDATER_TARBALL="$asset"
  done
  UPDATER_LATEST=""
  for asset in "${ASSET_PATHS[@]}"; do
    [[ "$(basename "$asset")" == "latest.json" ]] && UPDATER_LATEST="$asset"
  done
  node "$SCRIPT_DIR/verify-updater-signature.mjs" \
    --tarball "$UPDATER_TARBALL" --sig "$UPDATER_TARBALL.sig" \
    --tauri-conf "$SCRIPT_DIR/../src-tauri/tauri.conf.json" \
    --latest-json "$UPDATER_LATEST" --version "$VERSION"
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "Dry-run GitHub release publish"
  echo "  version: $VERSION"
  echo "  tag: $RELEASE_TAG"
  echo "  name: $RELEASE_NAME"
  echo "  channel: $CHANNEL"
  if [[ -n "$RELEASE_TARGET" ]]; then
    echo "  target: $RELEASE_TARGET"
  fi
  echo "  promotion directory: $PROMOTION_DIRECTORY"
  if [[ -n "$RELEASE_NOTES_PATH" ]]; then
    echo "  release notes: $RELEASE_NOTES_PATH"
  fi
  printf '  assets:\n'
  printf '    %s\n' "${ASSET_PATHS[@]}"
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI is required to publish promoted releases." >&2
  exit 1
fi

: "${GITHUB_REPOSITORY:?Set GITHUB_REPOSITORY before publishing a release.}"

RELEASE_EXISTS=0
if gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  RELEASE_EXISTS=1
fi

if [[ "$RELEASE_EXISTS" == "1" ]]; then
  # The release exists, so the tag does too, and it may name an older commit:
  # `gh release upload --clobber` would replace the assets under a tag that
  # points somewhere else. The tag trigger this workflow used to have made
  # that binding hold by construction; the dispatch path does not, so it is
  # proved here instead of trusted.
  if ! node "$SCRIPT_DIR/verify-release-tag-commit.mjs" \
    --tag "$RELEASE_TAG" --commit "$BUILT_COMMIT" --repo "$GITHUB_REPOSITORY"; then
    echo "ERROR: refusing to replace the assets of the existing release '$RELEASE_TAG'." >&2
    exit 1
  fi
fi

if [[ "$RELEASE_EXISTS" == "0" ]]; then
  create_args=(
    gh release create "$RELEASE_TAG"
    --repo "$GITHUB_REPOSITORY"
    --title "$RELEASE_NAME"
  )

  # The tag must name the commit the assets were built from. The workflow
  # dispatches with RELEASE_TARGET set to the commit it built; a local publish
  # has no dispatch target, so the bundle's own build commit is used.
  if [[ -n "$RELEASE_TARGET" ]]; then
    create_args+=(--target "$RELEASE_TARGET")
  elif [[ -n "$BUILT_COMMIT" ]]; then
    create_args+=(--target "$BUILT_COMMIT")
  else
    echo "ERROR: cannot determine the commit that was built; refusing to create a release whose tag would not name it." >&2
    exit 1
  fi

  if [[ "$CHANNEL" != "stable" ]]; then
    create_args+=(--prerelease)
  fi

  if [[ -n "$RELEASE_NOTES_PATH" && -f "$RELEASE_NOTES_PATH" ]]; then
    create_args+=(--notes-file "$RELEASE_NOTES_PATH")
  else
    create_args+=(--notes "Automated macOS release promotion for version $VERSION.")
  fi

  "${create_args[@]}"
fi

gh release upload "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --clobber "${ASSET_PATHS[@]}"

echo "Published GitHub release $RELEASE_TAG with ${#ASSET_PATHS[@]} assets."
