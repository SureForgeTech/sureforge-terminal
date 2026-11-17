# Contributing to Terminal Workspace

## How to contribute

Issues are welcome: bug reports, questions and ideas. Pull requests from
outside contributors are not accepted for now, so that the project keeps a
single copyright holder; a pull request from outside may be closed without
review. Open an issue describing the change instead.

- For how to write a good issue, see the
  [SureForgeTech contributing guide](https://github.com/SureForgeTech/.github/blob/main/CONTRIBUTING.md).
- For **security vulnerabilities**, do **not** open a public issue — follow
  [SECURITY.md](SECURITY.md) instead.

The rest of this document is for maintainers: setup, checks and conventions
for landing a change.

## For maintainers: getting started

1. `npm run setup` — installs workspace dependencies through the pinned `pnpm`
   toolchain (no global `pnpm` required).
2. `npm run dev` — starts the browser review surface at
   [http://127.0.0.1:5173/](http://127.0.0.1:5173/). Demo mode is on by default
   in the browser, so you can explore the seeded workspace without real SSH
   keys or reachable hosts.

For native (Tauri) development and the macOS release pipeline, see
[docs/development.md](docs/development.md) and [docs/release.md](docs/release.md).

## For maintainers: before opening a pull request

Run the local gate that mirrors CI as closely as practical:

- `npm run validate` — fast local gate: lint, unit/integration tests, desktop
  build, and changed-file Semgrep (required — without Docker the gate fails rather than skips).
- `npm run validate:ci` — the CI-equivalent gate (adds browser e2e).
- `npm run test` — unit + integration coverage (Vitest).

If you touched the Rust crate, also run:

- `npm run native:check` — `cargo check` for `src-tauri`.
- `cargo test --manifest-path src-tauri/Cargo.toml` — Rust unit + fixture tests.

CI runs the same checks (`validate`, `rust-validate`, CodeQL). A pull request
should be green before review.

## For maintainers: pull request guidelines

- Keep changes scoped to a single concern; avoid drive-by formatting, import
  reordering, or unrelated renames.
- Match the style of the file you're editing.
- Add or update tests for behavior changes.
- Write a clear description of **what** changed and **why**.
- Don't commit generated artifacts, scratch scripts, or editor/IDE dotfiles.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) prefixes
(`feat:`, `fix:`, `chore:`, `ci:`, `docs:`, …). Keep the subject imperative and
under ~72 characters; put detail in the body.

## License

By contributing, you agree that your contributions will be licensed under the
[Apache License 2.0](LICENSE) that covers this project.
