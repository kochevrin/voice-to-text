# Testing

## Automated

| Layer | Command | Where |
|---|---|---|
| Frontend unit (vitest) | `pnpm test` | host |
| Typecheck + prod build | `pnpm build` | host |
| Rust unit (`whispr-core` only, pure Rust) | `cargo test -p whispr-core` | host |
| Rust full workspace (needs ALSA/GTK headers) | `docker run --rm -v "$PWD":/app -w /app whispr-dev cargo test --workspace` | Docker |
| E2E (Playwright, mocked Tauri) | `pnpm test:e2e` | host |

CI (`.github/workflows/release.yml`, job `test`) runs all of the above on
ubuntu-22.04 on every `v*` tag and manual dispatch.

## Manual injection checklist (per OS)

Text injection cannot be verified in CI — it needs a real desktop session.
Before each release, run this checklist by hand on every OS you ship.

### Test matrix

For **each target application** listed per OS below, verify all of:

1. **Push-to-talk** — hold the hotkey, speak, release: transcript appears in
   the focused field.
2. **Toggle mode** — switch `hotkey_mode` to `toggle`; press once to start,
   once to stop; transcript appears.
3. **Cyrillic** — dictate a Russian sentence (language `auto` or `ru`,
   multilingual model): "привет, это тестовая диктовка" injects intact.
4. **Emoji** — text containing emoji (e.g. via post-processing or history
   re-injection) injects without mojibake or dropped characters.
5. **2000-char text** — inject a long transcript (use `transcribe_wav` on a
   long recording or re-inject from history): no truncation, correct order of
   chunks, no interleaving.
6. **Rapid double-press** — press the hotkey twice quickly: no stuck recording
   state, no double injection, app returns to `idle`.
7. **Hotkey while paused** — enable Pause; hotkey does nothing; resume;
   hotkey works again.

### Linux — X11

Targets:

- `xterm`
- `gedit` (or any GTK text editor)
- Browser text field (Firefox or Chromium, e.g. a `<textarea>`)

Expectation: keystroke injection via XTEST works in all three; no clipboard
fallback toast.

### Linux — Wayland

Targets:

- `gnome-terminal` with a working ydotool setup (`ydotoold` running,
  `/dev/uinput` accessible — see `docs/permissions.md`)
- Any target **with ydotool stopped**: verify the **clipboard fallback** — a
  toast reports the text was copied, `Ctrl+V` pastes the full transcript.

### macOS

Targets:

- TextEdit
- Slack (Electron apps use a different input path — worth covering)
- Browser text field (Safari or Chrome)

Also verify:

- Accessibility permission flow: with the grant missing, the app surfaces the
  error/fallback and "Open Settings" deep-links to the Accessibility pane.
- **Secure-input caveat**: while a password field (or Terminal with Secure
  Keyboard Entry) holds secure input, keystroke injection is blocked
  system-wide — the app should fall back to clipboard rather than hang.

### Windows

Targets:

- Notepad
- Browser text field (Edge or Chrome)

Also verify injection is refused into an elevated (Run as Administrator)
window when whispr-open runs unelevated — expected OS behavior, the app should
fall back to clipboard, not crash.
