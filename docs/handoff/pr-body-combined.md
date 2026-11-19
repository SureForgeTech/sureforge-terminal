## Summary

Two slices of work, both aimed at the same thing: an SSH client that does not lose what you type, does not hide why a connection failed, and carries the features the parity matrix still lists as gaps.

The first slice hardens the browser-mode backend: input is held until the session's shell is open instead of being dropped, the terminal is sized at open, every failure carries a typed code and says what went wrong, and an approved host key that changed is refused with the reason it was refused. The second adds five features the repository's own gap list names: history output redaction, a terminal font picker, group-inherited host settings, broadcast input to every open session, and an actionable connect failure.

## Linked issue

None — the features were chosen from the repository's own gap list and verified against the tree before they were built:

| Feature | Source |
| --- | --- |
| History output redaction | `docs/roadmap/roadmap.md:42-43` — "persisted output previews … can still retain sensitive command results until explicit redaction and sensitivity controls exist" |
| Terminal font picker | `FEATURE_PARITY.md:42` — "the remaining gap is the **font picker** (font family + size)" |
| Group-inherited host settings | `FEATURE_PARITY.md:64` — groups are "Implemented … no inherited protocol settings yet" |
| Broadcast input to every open session | `FEATURE_PARITY.md:53` — the competitor's daily-use list has "Broadcast input across multiple terminals"; this app could only broadcast a *snippet* across hosts |
| Actionable connect failures | `FEATURE_PARITY.md:59` — the remaining gaps included "keychain-prompt UX polish" |

## Changes

### Browser-backend reliability

- **Input is held until the shell is open** (`apps/desktop/server/backend-ssh-session.mjs`) — input that arrives before the shell is ready is buffered rather than dropped, and the buffer is released once the shell opens. The terminal size is applied at open, so a client that resized before the shell existed no longer leaves the PTY at the wrong size.
- **A shell-open deadline** — a session whose shell never opens fails with a typed reason instead of hanging.
- **Typed connection failures** (`apps/desktop/server/backend-ssh-failure.mjs`, `backend-failure-codes.mjs`) — every failure mode carries a stable code and a human message, and the session frames carry the category with it.
- **Typed SFTP and port-forward failures** (`apps/desktop/server/backend-sftp-failure.mjs`) — a refused file operation says what the server refused and keeps the reason it was refused, including a close failure on an upload and a read failure on a download.
- **An approved host key that changed is refused with its reason** — the mismatch is not reported as a generic failure.
- **A late shell cannot resurrect a failed session** (`apps/desktop/server/backend-session-frames.mjs`).
- **The jump client is torn down and scrubbed** on teardown, and a stream error is no longer silent.

### Five features

- **History output redaction** (`apps/desktop/src/lib/redact-secrets.ts`, `apps/desktop/src/store/sessions-store.ts`, `apps/desktop/src/store/app-store.ts`, `apps/desktop/src/routes/SettingsPreferencesSection.tsx`) — the output preview the session history keeps is masked before it is persisted, so a password, a token, an AWS key id, a GitHub/GitLab/Slack token, a JSON web token or a PEM private key block does not sit in local storage. The masking is narrow on purpose — `authorisation: granted`, `tokenizer=fast` and `secretary=alice` are not secrets and stay readable, while `accessToken`, `clientSecret` and `apiKey` are. The **command** is not masked: the history replays it into a session, and a masked command would run as something else. The masking sees a command's output as a whole, so a secret the terminal happened to split across two pieces is still caught. A `redactCommandOutput` preference (on by default) turns it off.
- **Terminal font picker** (`apps/desktop/src/lib/terminal-fonts.ts`, `apps/desktop/src/components/terminal/TerminalPane.tsx`, `use-terminal-pane-session.ts`, `use-terminal-pane-lifecycle.ts`, `apps/desktop/src/routes/SettingsPreferencesSection.tsx`) — ten font families, each with fallbacks behind it so a font that is not installed still renders as a monospace face, and a size that is clamped to a readable range. The default family and size are exactly what the terminal already used. A terminal that is already open follows the preference through the xterm options, the way the theme already did, so the scrollback and the SSH session survive the change.
- **Group-inherited host settings** (`apps/desktop/src/store/group-settings-store.ts`, `apps/desktop/src/lib/connections.ts`, `apps/desktop/src/routes/SettingsGroupSettingsSection.tsx`, `apps/desktop/src/components/hosts/HostEditor.tsx`) — a group can carry the sign-in name, the bastion, the SFTP root and the environment its hosts share. They are **defaults**: a host that sets one of them itself keeps its own value, and the environment is merged per key so a host can override one variable and inherit the rest. The inheritance is applied where the connection is actually built — on a fresh session, on a restored one and on a file operation — so it covers the real connect path, and the host editor lets a host leave the user name and the SFTP root empty to take the group's.
- **Broadcast input to every open session** (`apps/desktop/src/store/broadcast-store.ts`, `apps/desktop/src/components/terminal/terminal-pane-input-wiring.ts`, `use-terminal-pane-lifecycle.ts`, `TerminalWorkspace.tsx`) — what you type in a live session is sent to every other pane taking part, so the same command can be run on several hosts from one terminal. It is **off by default** and a banner says so on screen while it is on; turning it off empties the set, so a later broadcast never reaches a session that has been closed. The pane being typed in always sends to its own session directly, so its input never depends on the broadcast reaching it and is never delivered twice. Only the panes that are actually live take part — a connected session with its terminal on screen — so the banner counts the sessions the broadcast really reaches.
- **Actionable connect failures** (`apps/desktop/src/store/connect-error-store.ts`, `apps/desktop/src/components/common/ConnectErrorBanner.tsx`, `apps/desktop/src/lib/launch-host-session.ts`) — the banner carries an action beside the message: "Open host" takes the user to that host's editor. The action is declarative (a route to go to), so the store holds no callbacks and the banner owns the navigation, and the action is cleared with the message so it cannot outlive the problem it belonged to.

- **Handoff notes** (`docs/handoff/`) — the operator-local run record, the pull-request bodies, the review packet of every review round and the validation log of the reviewed head, so that the change carries its own record.

## Acceptance criteria mirror

Browser-backend reliability:

- [x] Input typed before the shell is open is delivered once the shell opens, not dropped.
- [x] The terminal size is applied when the shell opens, not only when a resize arrives afterwards.
- [x] A session whose shell never opens fails with a typed reason instead of hanging.
- [x] Every connection failure carries a stable code, a human message and a category.
- [x] A refused SFTP or port-forward operation says what the server refused and keeps the reason.
- [x] An approved host key that changed is refused with the reason it was refused.
- [x] A shell that arrives after the session failed does not resurrect the session.
- [x] The jump client is torn down and scrubbed, and a stream error is no longer silent.

Five features:

- [x] A secret in the captured command output is masked before the preview is persisted; ordinary output is untouched, and a secret the terminal split across two pieces is still masked.
- [x] The command itself is never masked, because the history replays it into a session.
- [x] The terminal's font family and size are pickable; the default is what the terminal already used, and an open terminal follows the change without losing its scrollback or its SSH session.
- [x] A group's settings are defaults: a host that sets a value itself keeps it, the environment merges per key, and a host with no group inherits nothing. A fresh session, a restored session and a file operation all take them.
- [x] Broadcast input is off by default, is visible on screen while it is on, never reaches a session that is not taking part, and never delivers the pane being typed in twice.
- [x] A connect failure that can only be fixed on the host offers an "Open host" action that takes the user to that host's editor; a failure with no action still shows the message and Dismiss.

## Test plan

```
$ npm run validate
  Test Files  207 passed (207)
       Tests  1213 passed | 1 skipped (1214)
  ✓ built in 382ms
  [validate] rust build + tests skipped (macOS only — the native crate ships on macOS)
  [validate] native trust tooling skipped (macOS only)
  [validate] localhost sshd transport fixture skipped (set TERMSNIP_RUN_SSH_FIXTURE=1 to include)
  [validate] rust advisory audit skipped (set TERMSNIP_RUN_RUST_AUDIT=1 to include; CI runs it on every PR)
  [validate] real backend transport fixture skipped (macOS only — needs a local sshd)
  [validate] browser e2e skipped (set TERMSNIP_RUN_E2E=1 to include)
  [validate] Docker is unavailable, so semgrep could not run.
exit status: 1
```

The exit status is 1 **only** because of the Docker-gated Semgrep step: this sandbox has no Docker, and that gate fails rather than skips. The same step fails identically on the base commit, so it is not caused by this change. Every other step — effort guard, version consistency, secret-on-argv check, ESLint, the full Vitest suite and the desktop build — passes.

Also run separately, all clean: `node ./scripts/pnpmw.mjs --filter desktop typecheck` (`tsc -b`, exit 0) and `./node_modules/.bin/eslint .` (exit 0).

Not run, and why: no Rust, no dependency and no CI-configuration file is touched by this change, so the Rust gate and the advisory audit are not in scope for it — they are skipped by the environment (no Rust toolchain, macOS-only crate) and CI runs them on the pull request. The real backend transport fixture needs a local `sshd` and macOS, so it is skipped here and runs in CI (`TERMSNIP_RUN_BACKEND_FIXTURE=1`) for the `apps/desktop/server/backend.mjs` change this pull request makes.

Both slices were reviewed independently, each against its own exact head, by a fresh-context reviewer that was given the commit range, the complete diff, the acceptance criteria and the real validation output. Neither review left an unresolved P0 or P1 finding.

The review of the five features ran eighteen rounds on the exact head. Every finding it raised was a real defect — most of them in the redaction of the output the session history keeps, which was rewritten three times and is now a lexer over the output pieces. The property that redaction exists for is a test in the repository: the same output, split at every possible place, gives the same preview as the output in one piece.

## Changelog entry

- [FIX] The browser backend holds typed input until the session's shell is open instead of dropping it, and applies the terminal size at open.
- [FIX] Every browser-backend connection, SFTP and port-forward failure now carries a typed code and says what went wrong.
- [SECURITY] An approved host key that changed is refused with the reason it was refused.
- [FEATURE] The session history masks the secrets in the output it keeps — a password, a token, an API key — before the preview is saved, with a setting to turn it off.
- [FEATURE] Settings can now pick the terminal's font family and size, and the change applies live to terminals that are already open.
- [FEATURE] A group can carry the settings its hosts share — the user name, the bastion, the SFTP root and the environment — and a host keeps its own value wherever it has one.
- [FEATURE] Input can be broadcast to every open session at once, so the same command can be run on several hosts from one terminal.
- [FEATURE] A connection failure that can only be fixed on the host now offers an "Open host" action beside the message, taking the user straight to the host's editor.

## Notes for the maintainer

- The `main` rulesets allow **squash only** for this repository ("Public repositories: changes to main through pull requests"), and they dismiss stale reviews on push — so please do not push to the branch after the review lands, or the approval is dropped and the review has to run again.
- Review threads must be resolved before the merge is allowed.
- Every commit in this branch carries a `Signed-off-by:` line, and the DCO check exempts maintainer and bot pull requests anyway.
- The branch is a linear chain of 43 commits on top of `6750428` (102 files, +16740 / -292), which includes `docs/handoff/` — the run record, the review packets and the handoff notes for the change. `main` has moved to `88c5e52` since (`fix(dco): accept sign-offs in commits with Windows line endings (#618)`, `.github/workflows/dco.yml` only); the merge is clean and the two changes touch different files.
- The `changelog.d/` fragments carry no `(#N)` suffix: the number is the pull request's, and it is only known once the pull request exists — and adding it afterwards would change the head after the review. `scripts/roll-changelog.mjs` accepts the fragments as they are. If you want the number in the release notes, add it before the review lands.
- The branch that carries all of this is `wip/sureforge-terminal-features` (40 commits on top of `6750428`). Push it with `git push -u origin wip/sureforge-terminal-features`, then open the pull request against `main` with the title above and this body.
- This pull request carries two slices — the browser-backend reliability fixes and the five features — as one pull request. They touch no file in common, and each was reviewed independently at its own exact head.
