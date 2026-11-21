# Operator-local run record — sureforge-terminal

Session: "sureforge-terminal - backend failure hardening" (`ses_e141f12e8ffeEs367ehETr7TyP`)
Repository: `SureForgeTech/sureforge-terminal` (public, Apache-2.0)
Checkout: `/workspace/sureforge-terminal` (branch `main`, one writer)
Worktrees: `/workspace/sureforge-terminal-wt-hostkey` (branch `fix/host-key-mismatch-reports-why` @ `490812f`), `/workspace/sureforge-terminal-wt-sftp` (branch `fix/remote-operation-failures` @ `55c03bc`)

## Heads

| Slice | Base | Head | State |
| --- | --- | --- | --- |
| Reliability (browser backend) | `675042814c913f5874da7171a01d98715d10f723` | `4d24bdb0055cfecb1e8d013a2155663768e25700` | committed, independently approved, **not pushed** |
| Five features + the review fixes | `4d24bdb` | `1d9a61cf5955e5b428eb0029db7dbd024d0b3301` | committed, validated, **independently APPROVED (0 P0, 0 P1)**, **not pushed** |

`1d9a61c` is 22 commits on top of `6750428`; `git diff 6750428..1d9a61c` = 76 files, +6885 / −288.

`origin/main` moved during the session: `6750428` → `88c5e52` ("fix(dco): accept sign-offs in commits with Windows line endings (#618)", `.github/workflows/dco.yml` only). Merge-base of our head and `origin/main` is `6750428`; `git merge-tree --write-tree HEAD origin/main` is clean. Our commits are unaffected by the DCO change — they carry an LF `Signed-off-by:` line.

## Validation

| Revision | Command | Result |
| --- | --- | --- |
| `4d24bdb` | `npm run validate` | 196 files / 1098 passed, 1 skipped; exit 1 — **only** the Docker-gated Semgrep step (no Docker here; the same step fails on the base commit) |
| `1d9a61c` | `npm run validate` | 206 files / 1204 passed, 1 skipped; exit 1 — **only** the Docker-gated Semgrep step, same as baseline |
| `1d9a61c` | `node ./scripts/pnpmw.mjs --filter desktop typecheck` (`tsc -b`) | exit 0 |
| `1d9a61c` | `./node_modules/.bin/eslint .` | exit 0 |

Not run locally (skipped by the environment, run in CI): Rust build/tests and clippy (no Rust toolchain; the crate is macOS-only), native trust tooling, the localhost `sshd` transport fixture, the real backend transport fixture, browser e2e, the rust advisory audit, Semgrep (no Docker).

## Reviews

All reviews were fresh-context (a context that did not exist when the change was written), read the exact head, and were given the base/head pair, the complete git-generated diff, the acceptance criteria and the real validation output.

| Slice | Session | Model | Verdict |
| --- | --- | --- | --- |
| Reliability | `ses_e13aa2821ffer5xCXSK3nKcq6U` | Kimi / OpenCode (3 rounds) | APPROVE, no P0/P1 |
| Reliability | `ses_e13a46efcffejYAknEE3NQcovM` | OpenCode go (2 rounds) | APPROVE, no P0/P1 |
| Reliability | `ses_e138c14f9ffeBYXfUdIm40kWaB` | OpenCode free (3 rounds) | APPROVE, no P0/P1 |
| Reliability (final) | `ses_e123fd6beffej4kQFqr33mqoHg` / `ses_e123fc476ffesaUXstPJEEvzwh` | Kimi + OpenCode go | BLOCK → fix → **APPROVE** |
| Reliability (final) | `ses_e12266537ffefnwogju25mJAjC` / `ses_e1226556affeoOC0WNtMbSO5Ls` | OpenCode go + free | **APPROVE** |
| Five features | `ses_e0edbd3b5ffeX2Bjt13s0JfuBo` | `kimi-code-plan-cn/k3.1-pro` (rounds 1–13) | BLOCK each round; every finding fixed |
| Five features | `ses_e0edbd3b5ffeX2Bjt13s0JfuBo` | `kimi-code-plan-cn/k3.1-pro` (round 16, head `1d9a61c`) | **APPROVE — 0 P0, 0 P1, 2 P2/P3** |

The sixteen rounds were all on the redaction, which was rewritten three times (a per-chunk mask → a whole-text mask over a bounded buffer → a lexer over the output pieces). The four other features (font picker, group inheritance, broadcast input, actionable connect errors) were confirmed fixed in the first rounds and stayed clean. The reviewer's own words at the end: "no secret leak or new divergence beyond the already accepted conservative transient preview for unterminated quotes".

## Delivery blocker (verified live, 2026-11-19)

The sandbox's GitHub App installation token covers 11 repositories; `SureForgeTech/sureforge-terminal` is **not** one of them.

- `GET /installation/repositories` → 11 repos, `sureforge-terminal` absent (`/tmp/opencode/installation-repos.txt`).
- `GET /repos/SureForgeTech/sureforge-terminal` → permissions `{"admin":false,"maintain":false,"pull":false,"push":false,"triage":false}`.
- `git push --dry-run origin HEAD:refs/heads/feat/reliability-and-five-features` → `remote: Permission to SureForgeTech/sureforge-terminal.git denied to abd-oss-lane[bot].` → 403.

`abd-oss-lane-reviewer[bot]` has no token in this sandbox and is not installed here, so the review app could not act as the reviewer either; the independent review was run as a fresh-context agent instead.

Per the operating rules, no attempt was made to find another credential or another way around the protection. The merge is handed to the owner.

## Prepared artefacts for the owner

- `/tmp/opencode/pr-body-combined.md` — **the** pull-request body: both slices, one squash-merged pull request, with the maintainer notes (squash only, resolve threads, do not push after the review lands).
- `/tmp/opencode/pr-body-reliability.md`, `/tmp/opencode/pr-body-features.md` — per-slice bodies, kept in case the owner prefers two pull requests.
- `/tmp/opencode/review-packet-features-fix15.md` — the review packet for the approved head.
- `/tmp/opencode/validate-features-fixed17.log` — the full `npm run validate` output for `1d9a61c`.

Suggested delivery (owner side, from `/workspace/sureforge-terminal`):

```
git push origin 1d9a61c:refs/heads/feat/reliability-and-five-features
gh pr create --base main --head feat/reliability-and-five-features \
  --title "feat: five features, and the browser-backend failures they build on" \
  --body-file /tmp/opencode/pr-body-combined.md
```

Then, after `validate`, `rust-validate` and `CodeQL` are green on that head and any review threads are resolved: **Squash and merge** (the rulesets allow squash only).

## Known, accepted, non-blocking

- The preview of an output that ends in an unterminated quoted value is conservative (`password=[redacted]` rather than `password="[redacted]" with spaces`) until the output is finished; the persisted value of a finished command is exact.
- The `changelog.d/` fragments carry no `(#N)` suffix: the number is the pull request's, and it does not exist until the pull request is opened; the roll script accepts the fragments as they are.

## Deliberately deferred follow-ups

- SFTP-subsystem-absent and `EADDRINUSE` still say "Internal server error."
- The DSA refusal wording reads "Host key has changed."
- `known_hosts` ignores the key algorithm.
- A symlinked directory is listed as an unopenable file.
