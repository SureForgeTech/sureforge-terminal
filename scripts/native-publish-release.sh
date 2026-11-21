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

# The bundle must trust the updater public key this checkout signs the update
# feed with. The promoted manifest records the key the bundle was built with,
# so a bundle built before a key rotation is caught here: the feed would be
# signed with the new key while the app inside it still trusts the old one,
# and every installed copy would reject that update — and every update after
# it — while the release page says the update is available.
if ! node "$SCRIPT_DIR/verify-updater-key-match.mjs" \
  --manifest "$PROMOTED_MANIFEST_PATH" \
  --tauri-conf "$SCRIPT_DIR/../src-tauri/tauri.conf.json"; then
  echo "ERROR: refusing to publish a bundle that does not trust the updater key this checkout signs with." >&2
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

# The tag must name the commit the assets were built from. A GitHub Release
# can be created for a tag that already exists, and then `target_commitish` is
# ignored, so the tag would keep its own commit while the assets come from
# another: the tag is resolved BEFORE the release is created or its assets
# replaced. RELEASE_TARGET is the commit the workflow built; the promoted
# manifest records the commit the bundle was built from, and the two must
# agree.
if [[ -n "$RELEASE_TARGET" && -n "$BUILT_COMMIT" && "$RELEASE_TARGET" != "$BUILT_COMMIT" ]]; then
  echo "ERROR: RELEASE_TARGET '$RELEASE_TARGET' is not the commit the assets were built from ('$BUILT_COMMIT')." >&2
  exit 1
fi

TAG_STATUS=0
TAG_COMMIT="$(node "$SCRIPT_DIR/verify-release-tag-commit.mjs" \
  --resolve --tag "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY")" || TAG_STATUS=$?

case "$TAG_STATUS" in
  0)
    if [[ -z "$BUILT_COMMIT" ]]; then
      echo "ERROR: the promoted manifest names no build commit, so the tag '$RELEASE_TAG' cannot be checked against it." >&2
      exit 1
    fi
    if [[ "$TAG_COMMIT" != "$BUILT_COMMIT" ]]; then
      echo "ERROR: tag '$RELEASE_TAG' names commit '$TAG_COMMIT', but the assets were built from '$BUILT_COMMIT'." >&2
      echo "       Refusing to publish assets that do not match the tag." >&2
      exit 1
    fi
    ;;
  3)
    # No tag yet: it is created below, at the commit the assets were built from.
    ;;
  *)
    echo "ERROR: could not resolve the release tag '$RELEASE_TAG'; refusing to publish." >&2
    exit 1
    ;;
esac

RELEASE_EXISTS=0
if gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  RELEASE_EXISTS=1
fi

if [[ "$RELEASE_EXISTS" == "0" ]]; then
  create_args=(
    gh release create "$RELEASE_TAG"
    --repo "$GITHUB_REPOSITORY"
    --title "$RELEASE_NAME"
  )

  # The tag is created at the commit the assets were built from, so the
  # release and its assets cannot name different commits.
  if [[ -z "$BUILT_COMMIT" ]]; then
    echo "ERROR: cannot determine the commit that was built; refusing to create a release whose tag would not name it." >&2
    exit 1
  fi
  create_args+=(--target "$BUILT_COMMIT")

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
