## Summary

The browser-mode backend could lose typed input, hide a failure, or report a connection failure without saying why. This change makes the browser backend hold input until the shell is ready, size a terminal at open rather than at resize, carry a typed failure code and message for every failure mode, and refuse an approved host key that changed with the reason it was refused.

## Linked issue

None — this slice came out of an edge-case and failure-path review of `apps/desktop/server/backend.mjs` and the browser-mode session lifecycle.

## Changes

- **Input is held until the shell is open** (`apps/desktop/server/backend-ssh-session.mjs`) — input that arrives before the shell is ready is buffered rather than dropped, and the buffer is released once the shell opens. The terminal size is applied at open, so a client that resized before the shell existed no longer leaves the PTY at the wrong size.
- **A shell-open deadline** — a session whose shell never opens fails with a typed reason instead of hanging.
- **Typed connection failures** (`apps/desktop/server/backend-ssh-failure.mjs`, `backend-failure-codes.mjs`) — every failure mode carries a stable code and a human message, and the session frames carry the category with it.
- **Typed SFTP and port-forward failures** (`apps/desktop/server/backend-sftp-failure.mjs`) — a refused file operation says what the server refused and keeps the reason it was refused, including a close failure on an upload and a read failure on a download.
- **An approved host key that changed is refused with its reason** — the mismatch is not reported as a generic failure.
- **A late shell cannot resurrect a failed session** (`apps/desktop/server/backend-session-frames.mjs`) — a shell that arrives after the session already failed does not reopen it.
- **The jump client is torn down and scrubbed** on teardown, and a stream error is no longer silent.

## Acceptance criteria mirror

- [x] Input typed before the shell is open is delivered once the shell opens, not dropped.
- [x] The terminal size is applied when the shell opens, not only when a resize arrives afterwards.
- [x] A session whose shell never opens fails with a typed reason instead of hanging.
- [x] Every connection failure carries a stable code, a human message and a category.
- [x] A refused SFTP or port-forward operation says what the server refused and keeps the reason.
- [x] An approved host key that changed is refused with the reason it was refused.
- [x] A shell that arrives after the session failed does not resurrect the session.
- [x] The jump client is torn down and scrubbed, and a stream error is no longer silent.

## Test plan

```
$ npm run validate
  Test Files  196 passed (196)
       Tests  1098 passed | 1 skipped (1099)
  ✓ built in ...
  [validate] rust build + tests skipped (macOS only — the native crate ships on macOS)
  [validate] native trust tooling skipped (macOS only)
  [validate] localhost sshd transport fixture skipped (set TERMSNIP_RUN_SSH_FIXTURE=1 to include)
  [validate] rust advisory audit skipped (set TERMSNIP_RUN_RUST_AUDIT=1 to include; CI runs it on every PR)
  [validate] real backend transport fixture skipped (macOS only — needs a local sshd)
  [validate] browser e2e skipped (set TERMSNIP_RUN_E2E=1 to include)
  [validate] Docker is unavailable, so semgrep could not run.
exit status: 1
```

The exit status is 1 **only** because of the Docker-gated Semgrep step: this sandbox has no Docker, and that gate fails rather than skips. The same step fails identically on the base commit, so it is not caused by this change.

Not run, and why: the real backend transport fixture needs a local `sshd` and macOS, so it is skipped here and runs in CI (`TERMSNIP_RUN_BACKEND_FIXTURE=1`) for the `apps/desktop/server/backend.mjs` change this slice makes.

## Changelog entry

- [FIX] The browser backend holds typed input until the session's shell is open instead of dropping it, and applies the terminal size at open.
- [FIX] Every browser-backend connection, SFTP and port-forward failure now carries a typed code and says what went wrong.
- [SECURITY] An approved host key that changed is refused with the reason it was refused.
