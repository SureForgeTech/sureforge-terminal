// A release must be built from a reviewed commit on main. The workflow can be
// dispatched from another ref, and a local publish can name any checkout, so
// the tag/commit binding alone does not prove that the assets came from main.
// GitHub's compare API answers that directly: for `<built commit>...main`,
// `identical` means the commit is main and `ahead` means main contains it.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ACCEPTED_COMPARE_STATUSES = new Set(["identical", "ahead"]);

function runGh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function assertBuiltCommitOnDefaultBranch({ builtCommit, repository, gh = runGh }) {
  if (!builtCommit) {
    throw new Error(
      "The promoted manifest names no build commit; cannot prove the release was built from main.",
    );
  }
  if (!repository) {
    throw new Error("Set GITHUB_REPOSITORY before publishing a release.");
  }

  const status = String(
    gh(["api", `repos/${repository}/compare/${builtCommit}...main`, "--jq", ".status"]),
  ).trim();
  if (!status) {
    throw new Error(`The GitHub compare API returned no status for ${builtCommit}...main.`);
  }
  if (!ACCEPTED_COMPARE_STATUSES.has(status)) {
    throw new Error(
      `Commit ${builtCommit} is not contained in main (compare status: ${status}). Refusing to publish an unmerged build.`,
    );
  }

  return { builtCommit, baseBranch: "main", status };
}

function parseArgs(argv) {
  const options = { commit: "", repo: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--commit") {
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
    if (!options.repo) {
      throw new Error("Usage: node verify-release-provenance.mjs --commit <sha> --repo <owner/name>");
    }
    const result = assertBuiltCommitOnDefaultBranch({
      builtCommit: options.commit,
      repository: options.repo,
    });
    console.log(`Build commit ${result.builtCommit} is contained in main (compare status: ${result.status}).`);
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

// Whether this file is the program that was started. Compare real paths so a
// symlink or /proc/self/cwd cannot make the guard exit without having run.
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
