## Summary

Five product features the repository's own parity and roadmap documents name as gaps: the session history now masks the secrets in the output it keeps, the terminal's font family and size are pickable, a group can carry the settings its hosts share, what you type can be broadcast to every open session, and a connect failure that can only be fixed on the host offers an "Open host" action.

## Linked issue

None — these five were chosen from the repository's own gap list and verified against the tree before they were built:

| Feature | Source |
| --- | --- |
| History output redaction | `docs/roadmap/roadmap.md:42-43` — "persisted output previews … can still retain sensitive command results until explicit redaction and sensitivity controls exist" |
| Terminal font picker | `FEATURE_PARITY.md:42` — "the remaining gap is the **font picker** (font family + size)" |
| Group-inherited host settings | `FEATURE_PARITY.md:64` — groups are "Implemented … no inherited protocol settings yet" |
| Broadcast input to every open session | `FEATURE_PARITY.md:53` — the competitor's daily-use list has "Broadcast input across multiple terminals"; this app could only broadcast a *snippet* across hosts |
| Actionable connect failures | `FEATURE_PARITY.md:59` — the remaining gaps included "keychain-prompt UX polish" |

## Changes

- **History output redaction** (`apps/desktop/src/lib/redact-secrets.ts`, `apps/desktop/src/store/sessions-store.ts`, `apps/desktop/src/store/app-store.ts`, `apps/desktop/src/routes/SettingsPreferencesSection.tsx`) — the output preview the session history keeps is masked before it is persisted, so a password, a token, an AWS key id, a GitHub/GitLab/Slack token, a JSON web token or a PEM private key block does not sit in local storage. The masking is narrow on purpose — `authorisation: granted`, `tokenizer=fast` and `secretary=alice` are not secrets and stay readable. The **command** is not masked: the history replays it into a session, and a masked command would run as something else. A `redactCommandOutput` preference (on by default) turns it off.
- **Terminal font picker** (`apps/desktop/src/lib/terminal-fonts.ts`, `apps/desktop/src/components/terminal/TerminalPane.tsx`, `use-terminal-pane-session.ts`, `use-terminal-pane-lifecycle.ts`, `apps/desktop/src/routes/SettingsPreferencesSection.tsx`) — ten font families, each with fallbacks behind it so a font that is not installed still renders as a monospace face, and a size that is clamped to a readable range. The default family and size are exactly what the terminal already used. A terminal that is already open follows the preference through the xterm options, the way the theme already did, so the scrollback and the SSH session survive the change.
- **Group-inherited host settings** (`apps/desktop/src/store/group-settings-store.ts`, `apps/desktop/src/lib/connections.ts`, `apps/desktop/src/routes/SettingsGroupSettingsSection.tsx`) — a group can carry the sign-in name, the bastion, the SFTP root and the environment its hosts share. They are **defaults**: a host that sets one of them itself keeps its own value, and the environment is merged per key so a host can override one variable and inherit the rest. The inheritance is applied where the connection is actually built, so it covers the real connect path.
- **Broadcast input to every open session** (`apps/desktop/src/store/broadcast-store.ts`, `apps/desktop/src/components/terminal/terminal-pane-input-wiring.ts`, `use-terminal-pane-lifecycle.ts`, `TerminalWorkspace.tsx`) — what you type in a live session is sent to every other pane taking part, so the same command can be run on several hosts from one terminal. It is **off by default** and a banner says so on screen while it is on; turning it off empties the set, so a later broadcast never reaches a session that has been closed. The pane being typed in always sends to its own session directly, so its input never depends on the broadcast reaching it and is never delivered twice.
- **Actionable connect failures** (`apps/desktop/src/store/connect-error-store.ts`, `apps/desktop/src/components/common/ConnectErrorBanner.tsx`, `apps/desktop/src/lib/launch-host-session.ts`) — the banner carries an action beside the message: "Open host" takes the user to that host's editor. The action is declarative (a route to go to), so the store holds no callbacks and the banner owns the navigation, and the action is cleared with the message so it cannot outlive the problem it belonged to.

## Acceptance criteria mirror

- [x] A secret in the captured command output is masked before the preview is persisted; ordinary output is untouched.
- [x] The command itself is never masked, because the history replays it into a session.
- [x] The terminal's font family and size are pickable; the default is what the terminal already used, and an open terminal follows the change without losing its scrollback or its SSH session.
- [x] A group's settings are defaults: a host that sets a value itself keeps it, the environment merges per key, and a host with no group inherits nothing.
- [x] Broadcast input is off by default, is visible on screen while it is on, never reaches a session that is not taking part, and never delivers the pane being typed in twice.
- [x] A connect failure that can only be fixed on the host offers an "Open host" action; a failure with no action still shows the message and Dismiss.

## Test plan

```
$ npm run validate
  Test Files  202 passed (202)
       Tests  1133 passed | 1 skipped (1134)
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

Not run, and why: no Rust, no `apps/desktop/server/backend.mjs`, no dependency and no CI-configuration file is touched by this range, so the Rust gate, the backend fixture and the advisory audit are not in scope for it. They are skipped by the environment (no Rust toolchain, macOS-only crate) and CI runs them on the pull request.

## Changelog entry

- [FEATURE] The session history masks the secrets in the output it keeps — a password, a token, an API key — before the preview is saved, with a setting to turn it off.
- [FEATURE] Settings can now pick the terminal's font family and size, and the change applies live to terminals that are already open.
- [FEATURE] A group can carry the settings its hosts share — the user name, the bastion, the SFTP root and the environment — and a host keeps its own value wherever it has one.
- [FEATURE] Input can be broadcast to every open session at once, so the same command can be run on several hosts from one terminal.
- [FEATURE] A connection failure that can only be fixed on the host now offers an "Open host" action beside the message, taking the user straight to the host's editor.
