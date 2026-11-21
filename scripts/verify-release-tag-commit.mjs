// The release tag must name the commit the published assets were built from.
//
// The workflow used to start on a pushed `v*` tag, which made that binding
// true by construction: the tag named the commit the job built and published.
// The dispatch path takes the tag as free text, so nothing enforces it — and
// a re-publish of an existing version would `gh release upload --clobber` the
// assets of a release whose tag still points at an older commit. This
// resolves the tag to a commit and refuses the mismatch instead of trusting
// the caller.
import { execFileSync } from "node:child_process";
import path from "node:path";

function runGh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// Resolve a tag to the commit it names. A lightweight tag points straight at
// a commit; an annotated tag points at a tag object, which is dereferenced to
// the commit it wraps. A tag that does not exist (or a lookup that fails)
// resolves to null: the caller decides whether that is fatal.
export function resolveTagCommit(tag, repository, gh = runGh) {
  let reference;
  try {
    reference = gh([
      "api",
      `repos/${repository}/git/ref/tags/${tag}`,
      "--jq",
      ".object | [.sha, .type] | @tsv",
    ]);
  } catch {
    return null;
  }

  const [sha, type] = String(reference).trim().split("\t");
  if (!sha) {
    return null;
  }
  if (type !== "tag") {
    return sha;
  }

  let annotated;
  try {
    annotated = gh(["api", `repos/${repository}/git/tags/${sha}`, "--jq", ".object.sha"]);
  } catch {
    return null;
  }
  return String(annotated).trim() || null;
}

export function assertTagMatchesBuild({ tag, builtCommit, repository, gh = runGh }) {
  if (!builtCommit) {
    throw new Error(
      `Cannot verify the release tag '${tag}': the promoted manifest names no build commit.`,
    );
  }

  const tagCommit = resolveTagCommit(tag, repository, gh);
  if (!tagCommit) {
    throw new Error(`Cannot verify the release tag '${tag}': it did not resolve to a commit.`);
  }

  if (tagCommit !== builtCommit) {
    throw new Error(
      `Tag '${tag}' names commit ${tagCommit}, but the published assets were built from ${builtCommit}.`,
    );
  }

  return { tag, tagCommit, builtCommit };
}

function parseArgs(argv) {
  const options = { tag: "", commit: "", repo: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--tag") {
      options.tag = argv[index + 1] ?? "";
      index += 1;
    } else if (argument === "--commit") {
      options.commit = argv[index + 1] ?? "";
      index += 1;
    } else if (argument === "--repo") {
      options.repo = argv[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.tag || !options.commit || !options.repo) {
      throw new Error(
        "Usage: node verify-release-tag-commit.mjs --tag <tag> --commit <sha> --repo <owner/name>",
      );
    }
    const result = assertTagMatchesBuild({
      tag: options.tag,
      builtCommit: options.commit,
      repository: options.repo,
    });
    console.log(`Release tag '${result.tag}' names the built commit ${result.builtCommit}.`);
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === new URL(`file://${path.resolve(process.argv[1] || "")}`).href) {
  main();
}
