// The release tag must name the commit the published assets were built from.
//
// The workflow used to start on a pushed `v*` tag, which made that binding
// true by construction: the tag named the commit the job built and published.
// The dispatch path takes the tag as free text, so nothing enforces it — and
// a GitHub Release can be created for a tag that already exists, in which
// case `target_commitish` is ignored and the tag keeps its own commit while
// the assets come from another. This resolves the tag to a commit so the
// publish step can refuse that instead of trusting the caller.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The exit code that says "this tag does not exist", as opposed to "the
// lookup failed": the publish step creates the tag when it is absent, and
// must refuse when it cannot tell.
export const TAG_MISSING_EXIT = 3;

function runGh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function isNotFound(error) {
  const stderr = String(error?.stderr ?? "");
  const message = String(error?.message ?? "");
  return /HTTP 404|Not Found/i.test(`${stderr}\n${message}`);
}

// Resolve a tag to the commit it names, or null when the tag does not exist.
// A lookup that failed for any other reason (network, authentication, an API
// error) throws: "cannot tell" is not "no tag", and treating it as "no tag"
// would let the publish step create a release under a tag it never checked.
export function resolveTagCommit(tag, repository, gh = runGh) {
  let reference;
  try {
    reference = gh([
      "api",
      `repos/${repository}/git/ref/tags/${tag}`,
      "--jq",
      ".object | [.sha, .type] | @tsv",
    ]);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }

  const [sha, type] = String(reference).trim().split("\t");
  if (!sha) {
    throw new Error(`The tag '${tag}' resolved to no object.`);
  }
  if (type !== "tag") {
    return sha;
  }

  // An annotated tag points at a tag object, which wraps the commit.
  let annotated;
  try {
    annotated = gh(["api", `repos/${repository}/git/tags/${sha}`, "--jq", ".object.sha"]);
  } catch (error) {
    throw new Error(
      `The annotated tag '${tag}' did not resolve to a commit: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const commit = String(annotated).trim();
  if (!commit) {
    throw new Error(`The annotated tag '${tag}' resolved to no commit.`);
  }
  return commit;
}

function parseArgs(argv) {
  const options = { tag: "", repo: "", resolve: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--tag") {
      options.tag = argv[index + 1] ?? "";
      index += 1;
    } else if (argument === "--repo") {
      options.repo = argv[index + 1] ?? "";
      index += 1;
    } else if (argument === "--resolve") {
      options.resolve = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.tag || !options.repo) {
      throw new Error(
        "Usage: node verify-release-tag-commit.mjs --tag <tag> --repo <owner/name> [--resolve]",
      );
    }

    const commit = resolveTagCommit(options.tag, options.repo);
    if (!commit) {
      console.error(`The tag '${options.tag}' does not exist.`);
      process.exitCode = TAG_MISSING_EXIT;
      return;
    }
    console.log(commit);
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

// Whether this file is the program that was started. The comparison is on
// the real paths, so a script reached through a symlink, or through
// /proc/self/cwd, still matches: a URL comparison would not, and the guard
// would then exit successfully without having run — which is a silent pass
// for the release path this guard stands in.
function startedAsTheProgram() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (startedAsTheProgram()) {
  main();
}
