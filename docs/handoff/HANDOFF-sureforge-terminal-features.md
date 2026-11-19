# HANDOFF — sureforge-terminal: five features + browser-backend reliability

## Goal

Make `SureForgeTech/sureforge-terminal` (a local-first macOS SSH client, Apache-2.0) as reliable, user-friendly, safe and fast as a Termius replacement: build the five highest-value missing features, harden the browser-mode backend, have every change independently reviewed, and deliver it through the ordinary branch → push → pull request → merge route.

## What is done, and whether it is tested

**Everything in the repository is committed on `main` and tested.** The last commit `1d9a61c` was independently reviewed and **APPROVED with 0 P0 and 0 P1 findings** on that exact head.

Two slices, 22 commits on top of `6750428` (`git diff 6750428..1d9a61c` = 76 files, +6885 / −288):

1. **Browser-backend reliability** (`6750428` → `4d24bdb`, 14 commits) — input is held until the session's shell is open instead of being dropped, the terminal is sized at open, a shell-open deadline replaces a hang, every failure carries a typed code and message, an approved host key that changed is refused with the reason, a late shell cannot resurrect a failed session, the jump client is torn down and scrubbed. Independently approved (no P0/P1).
2. **Five features + the review fixes** (`4d24bdb` → `1d9a61c`, 22 commits) — history output redaction, terminal font picker, group-inherited host settings, broadcast input to every open session, actionable connect failures.

**Validation on `1d9a61c`:** `npm run validate` → 206 test files, 1204 passed, 1 skipped; `tsc -b` clean; ESLint clean. The command exits 1 **only** on the Docker-gated Semgrep step (no Docker in this sandbox; the same step fails identically on the base commit).

**Review:** a fresh-context reviewer (given the base/head pair, the complete git-generated diff, the acceptance criteria and the real validation output) ran sixteen rounds on the feature slice. Every finding was a real defect; nearly all were in the output redaction, which was rewritten three times and is now a lexer over the output pieces. The property the redaction exists for is a repository test: the same output, split at every possible place, gives the same preview as the output in one piece (`apps/desktop/src/lib/redact-secrets.streaming.test.ts`, 49 fixtures at every split and every pair of splits).

**Nothing is half-done in the repository.** The tree is clean; there are no stashes and no uncommitted edits.

## What is unfinished

Only the **delivery**, which needs the repository owner's credentials:

- The branch has never been pushed.
- No pull request exists.
- The review app (`abd-oss-lane-reviewer[bot]`) is not installed in this sandbox, so the independent review was run as a fresh-context agent instead.

## The exact next step

From `/workspace/sureforge-terminal`, on the owner's side (with credentials that can write to the repo):

```
git push origin 1d9a61c:refs/heads/feat/reliability-and-five-features
gh pr create --base main --head feat/reliability-and-five-features \
  --title "feat: five features, and the browser-backend failures they build on" \
  --body-file /tmp/opencode/pr-body-combined.md
```

Then wait for `validate`, `rust-validate` and `CodeQL` to go green on that head, resolve any review threads, and **squash-merge**.

Two constraints the owner must respect:

- The `main` rulesets allow **squash only** ("Public repositories: changes to main through pull requests"), and they **dismiss stale reviews on push**. Do not touch the branch after the review lands, or the approval drops and the review must run again.
- `origin/main` moved to `88c5e52` during the session (`fix(dco): accept sign-offs in commits with Windows line endings (#618)`, `.github/workflows/dco.yml` only). The merge is clean — `git merge-tree --write-tree HEAD origin/main` reports no conflicting paths — and the two changes touch different files.

## Branch, commit, pull request

- Branch: `main` (local), head `1d9a61cf5955e5b428eb0029db7dbd024d0b3301` — *"fix(features): the fifteenth round of review finding, and the plain value that grew"*.
- Preservation branch created for this handoff: `wip/sureforge-terminal-features` (same tree as `main`; the working tree was clean, so the branch carries the work as it stands).
- Open pull request: **none**. No PR was opened and none can be opened from this sandbox (see the blocker).

## Decisions made, and why

- **One pull request, not two.** The `main` rulesets allow squash only, and they dismiss stale reviews on push. Stacked pull requests would have forced a rebase after the first merge (new commit SHAs → the independent review would no longer bind to the merged head) or a second review round. One PR keeps the reviewed head frozen. The two slices touch **no file in common**, so the merge is clean and each slice was reviewed independently at its own exact head.
- **The redaction is a lexer over the output pieces, not a per-chunk mask.** A secret can straddle two pieces (the name in one, the value in the next; a colour code in between; a key block arriving in fifty), so masking each chunk on its own leaks. The lexer releases text only where no construct can span the cut, and the whole-output property is a test.
- **The redaction is deliberately conservative where a stream cannot know the future.** An output that ends mid-quoted-value keeps `password=[redacted]` until it is finished; the persisted value of a *finished* command is exact (`flush()` masks an open value the way the whole-text redaction does, and the store calls it when the next command in the same pane starts, when the pane closes, and when the output goes quiet for 1.5 s). Falling back earlier would have leaked the words of a secret such as `password="secret password"`.
- **The changelog fragments carry no `(#N)` suffix.** The number is the pull request's, and it does not exist until the pull request is opened; adding it afterwards would change the head and dismiss the review. `scripts/roll-changelog.mjs` accepts the fragments as they are.
- **Rust was not touched.** There is no Rust toolchain in this sandbox and the native crate is macOS-only, so the Rust gate is CI's; all work is JS/TS.

## Blocker (exact error text)

The sandbox's GitHub App installation token has no write access to this repository.

```
$ git push --dry-run origin HEAD:refs/heads/feat/reliability-and-five-features
remote: Permission to SureForgeTech/sureforge-terminal.git denied to abd-oss-lane[bot].
fatal: unable to access 'https://github.com/SureForgeTech/sureforge-terminal.git/': The requested URL returned error: 403
```

Supporting evidence, read live from the API:

- `GET /repos/SureForgeTech/sureforge-terminal` → `{"admin":false,"maintain":false,"pull":false,"push":false,"triage":false}`.
- `GET /installation/repositories` → 11 repositories; `SureForgeTech/sureforge-terminal` is **not** among them (list saved at `/tmp/opencode/installation-repos.txt`).
- `abd-oss-lane-reviewer[bot]` has no token in this sandbox and is not installed on the repo, so it could not act as the reviewer either.

No other credential was sought and no settings were changed.

## Ignored / untracked files that matter

From `git status --ignored --short` — all build output, none of it is work:

```
!! apps/desktop/dist/                  (the desktop build; rebuilt by `npm run validate`)
!! apps/desktop/node_modules/          (installed dependencies)
!! apps/desktop/tsconfig.tsbuildinfo   (TypeScript build info)
!! artifacts/validation/                (validation artefacts)
!! node_modules/                        (installed dependencies)
```

No untracked source files exist (`git status` reports a clean tree).

## Where everything else lives

Outside the repository (a sandbox rebuild outside `/workspace` would lose these):

- `/tmp/opencode/session-record.md` — the operator-local run record: every head, every review verdict, the validation results, the blocker evidence, the artefacts and the accepted non-blocking items.
- `/tmp/opencode/pr-body-combined.md` — the pull-request body to use (both slices, one PR, with the maintainer notes).
- `/tmp/opencode/pr-body-reliability.md`, `/tmp/opencode/pr-body-features.md` — per-slice bodies, in case two pull requests are preferred.
- `/tmp/opencode/review-packet-features-fix15.md` — the review packet for the approved head.
- `/tmp/opencode/validate-features-fixed17.log` — the full `npm run validate` output for `1d9a61c`.
- `/tmp/opencode/installation-repos.txt` — the App installation's repository list.

## Known, accepted, non-blocking

- The preview of an output that ends in an unterminated quoted value is conservative until the output is finished (the persisted value of a finished command is exact).
- SFTP-subsystem-absent and `EADDRINUSE` still say "Internal server error."; the DSA refusal wording reads "Host key has changed."; `known_hosts` ignores the key algorithm; a symlinked directory is listed as an unopenable file. All predate this work and are untouched.
