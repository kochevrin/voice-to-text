# Deviations from the original spec

Deliberate, documented deviations with rationale. Newest at the bottom.

## Test fixture: jfk.wav instead of synthesized hello-world.wav

The spec's primary fixture was a synthesized "hello world" WAV. The host has no
ffmpeg/say/espeak to synthesize one, and the spec sanctions falling back to a
known-good sample. We use whisper.cpp's canonical sample (`jfk.wav`, 16-kHz
mono) at `test/fixtures/jfk.wav`; tests assert on its well-known transcript.

## Primary dev/test OS: Linux (WSL2), not macOS

Per the autonomy rule ("trust `uname`"), development and verification target
the actual host — WSL2 Linux x64 — rather than the macOS-first flow the spec
sketches. macOS/Windows paths are exercised in CI and via the manual checklist
(`docs/testing.md`).

## Full-workspace Rust verification runs in Docker

The host lacks a C toolchain and ALSA headers. Even pure-Rust test binaries
need `cc` for linking, so **all** cargo builds/tests run in the `whispr-dev`
image (built from `docker/dev.Dockerfile`):

```sh
docker run --rm -v "$PWD":/app -w /app whispr-dev cargo test --workspace
```

## Icons are programmatic placeholders

No design asset exists; `scripts/gen-icon.mjs` generates a 1024×1024 waveform
tile PNG with zero native dependencies, and `pnpm tauri icon` derives the
platform icon set from it. Replace with real branding before a public release.

## shadcn/ui components are vendored, not CLI-generated

The shadcn CLI would write files and fetch registries at generation time; to
keep the tree reproducible and offline-friendly, the needed components are
vendored directly under `src/components/ui/` (same code, pinned as source).

## Integration notes

Contract clarifications settled during integration (see `docs/contracts.md`):

- `effective_model_id`: `language: "auto"` keeps the chosen model as-is; only a
  concrete non-English language strips the `.en` suffix.
- `Settings.hotkey_mode` is a plain string (`"push_to_talk" | "toggle"`) for
  forgiving deserialization of old/partial settings files; values are validated
  in `set_settings`.
- `VadTrigger` latches `Stop` until `reset()`; `build_inject_plan` returns
  `ClipboardPaste` with zero chunks for text that is empty after sanitization.

Behavioral choices beyond the spec letter:

- The floating pill is shown for hotkey dictation sessions only, not for the
  onboarding/scratch test flow (the main window provides feedback there).
- Tray state tints: idle = green, recording = red, transcribing = amber,
  error = gray.
- Recordings shorter than 0.15 s are dropped without invoking whisper; whisper
  markers like `[BLANK_AUDIO]` are cleaned to empty output and kept out of
  history.
- Pausing the hotkey also aborts an in-flight recording; closing the main
  window hides the app to the tray (Quit lives in the tray menu).
- `macOSPrivateApi: true` is set in `tauri.conf.json` so the pill window can be
  truly transparent on macOS.
- The pipeline self-test (`src-tauri/tests/pipeline.rs`) runs only when
  `WHISPR_TEST_MODEL` points at a downloaded ggml model; otherwise it skips so
  `cargo test --workspace` stays green on fresh machines.
