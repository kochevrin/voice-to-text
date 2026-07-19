# whispr-open — Internal Contracts (IPC + core API)

This document is the single source of truth for interfaces between the Rust core,
the `whispr-core` crate, and the React UI. All sides MUST match it exactly.

## Settings schema

Persisted as JSON at `<app_data_dir>/settings.json` (Rust owns persistence).
Rust struct: `whispr_core::settings::Settings` (serde, `#[serde(default)]` per field).
TS mirror: `src/lib/types.ts` → `Settings`.

```jsonc
{
  "hotkey": "Alt+Space",            // normalized combo string (see Hotkey normalization)
  "hotkey_mode": "push_to_talk",    // "push_to_talk" | "toggle"
  "input_device": null,             // string device name | null = system default
  "model": "base.en",               // "tiny" | "tiny.en" | "base" | "base.en" | "small" | "small.en" | "medium" | "medium.en"
  "language": "auto",               // "auto" | ISO 639-1 code ("en", "ru", ...)
  "silence_timeout_ms": 800,
  "vad_enabled": true,
  "pill_enabled": true,
  "postproc": {
    "enabled": false,
    "ollama_url": "http://localhost:11434",
    "model": "llama3.2:3b",
    "prompt": "Fix grammar and punctuation. Preserve meaning. Output ONLY the corrected text."
  },
  "cloud": {
    "enabled": false,
    "base_url": "https://api.groq.com/openai/v1",
    "api_key": "",
    "model": "whisper-large-v3-turbo",
    "fallback_to_local": true
  },
  "history_enabled": true,
  "ui_language": "en",              // "en" | "uk" — interface language
  "autostart": false,               // launch the app at login
  "license": { "key": "", "server_url": "https://license.kk-lab.net" },
  "onboarding_done": false,
  "paused": false
}
```

### Autostart (`autostart`)

Launch-at-login, via `tauri-plugin-autostart` (Windows registry `Run` key,
macOS LaunchAgent, Linux `~/.config/autostart`). Applied Rust-side only:
`set_settings` enables/disables the OS entry when the flag changes BEFORE
persisting, and rejects the whole save (string error, localized) if the OS
call fails. On startup, when `autostart` is true the entry is re-enabled
best-effort so a moved binary path heals itself. The General tab exposes the
switch.

### Licensing (`license`)

Honor-system subscription gate. Rust struct `whispr_core::LicenseSettings`
(per-field serde defaults). `server_url` defaults to the author's server,
`https://license.kk-lab.net` (`whispr_core::license::DEFAULT_LICENSE_SERVER_URL`).
**When `server_url` is empty the whole licensing system is OFF** (state
`disabled`, app fully functional) — clearing the field is the open-source
escape hatch. Distributors deploy the bundled Cloudflare Worker
(`licensing/worker/`) and bake in their own URL as the default.

Server API: `GET {server_url}/check?key=<key>&device=<device_id>` →
`{"active": bool, "expires": "YYYY-MM-DD" | null, "reason"?: "device_limit"}`
(HTTP 200 also for unknown keys, with `active: false`). `device_id` is a
random per-install token (32 hex chars) persisted at `<app_data>/device_id` —
NOT a hardware fingerprint. The server allows at most 3 devices per key; a
device unseen for 30 days frees its slot. A 4th device gets `active: false`
with `reason: "device_limit"`, which the app caches like any other negative
verdict (`CachedCheck.reason`, surfaced as `LicenseStatus.reason`).

Verdict logic (pure, `whispr_core::license::evaluate`):
- `server_url` empty → `disabled`.
- Cached **active** verdict → `active` — a real subscription wins over the
  trial, so entering a valid key flips the status to Active even during the
  trial window (works; stale cache OK indefinitely — offline keeps working).
- Otherwise within the 7-day trial from first launch (`installed_at_ms`,
  stored in `<app_data>/license.json`) → `trial` (works; this also masks a
  cached *negative* verdict during the trial).
- Trial over, cached `active: false` → `inactive` (**dictation blocked**:
  hotkey + test recording refuse with a notification; UI/settings/history stay
  usable).
- No cache, trial over → `unverified` (works — honor system).
Checks run at startup and hourly (tokio interval), plus on license settings
change; cache persisted in `license.json` `{installed_at_ms, last: {active,
expires, reason, checked_at_ms}}` (`reason` is `null`/absent except on a
`device_limit` rejection).

Commands:
| `get_license_status` | – | `LicenseStatus` | `{ state: "disabled"\|"trial"\|"active"\|"inactive"\|"unverified", trial_days_left: number\|null, server_active: boolean\|null, days_left: number\|null, expires: string\|null, last_checked_ms: number\|null, reason: string\|null }` |
| `check_license_now` | – | `LicenseStatus` | Forces a server fetch, updates the cache, returns the fresh status. Errors (unreachable) still return a status (from cache/trial) — never a hard error; the failure only logs at warn and the cached fields stand. |

`state` is the *effective* verdict: an active key shows `"active"` even during
the trial, but a not-yet-active key inside the trial window shows `"trial"`
(masking a cached *negative* verdict until the trial ends). `server_active` is
the cached server verdict itself (`null` until a check first succeeds), and
`days_left` is the subscription remainder computed from `expires` vs today
(UTC calendar days, rounded up, floored at 0, `null` without a usable date).
`days_left` is about the key and is independent of `trial_days_left`.

UI: Settings gains a "License" tab — key input, server URL input, status line,
"Check now" button. Mock: state `trial` with 5 days left; `check_license_now`
returns `active` when the mock key is non-empty, else `inactive`.

Worker KV record (server side, `licensing/worker/`): the KV key is the license
key; the value is either a legacy bare date `"YYYY-MM-DD"` or a JSON record
`{expires, tier: "standard"|"premium", note, activated: "YYYY-MM-DD"|null,
devices: [{id, first_seen, last_seen}]}`. `/check` upgrades legacy values in
place, stamps `activated` on first sight of a key, tracks at most 3 devices
(day-granularity `last_seen`, so at most ~1 KV write per device per day), and
prunes devices unseen for 30 days. `tier` and `note` are admin-only fields
(`note` is a free-text comment, max 500 chars).

`history_enabled`: when false, new transcriptions are NOT added to the in-app
history (memory or disk); existing entries stay until "Clear history". The
Privacy tab exposes the switch.

### Cloud transcription (`cloud`)

Optional OpenAI-compatible remote transcription (Groq, OpenAI, any compatible
server). Rust struct `whispr_core::CloudSettings`, per-field serde defaults as
above so pre-cloud settings files still deserialize.

Behavior (Rust side, in the transcription step): when `cloud.enabled` and
`api_key` is non-empty, POST `{base_url}/audio/transcriptions` as
`multipart/form-data` — `file` (the recorded WAV, filename `audio.wav`),
`model`, `response_format=json`, plus `language` unless it is `"auto"` — with
header `Authorization: Bearer {api_key}` and a 30 s timeout; parse `{"text"}`.
On ANY failure: if `fallback_to_local` → `tracing::warn!` and run the local
whisper path (silent fallback, same pattern as postproc); else the error
surfaces as the usual error state/notification. Post-processing (Ollama) still
applies to cloud results. The API key is stored in plain text in
`settings.json` — the UI must say so.

UI: Transcription tab gets a "Cloud transcription" section (enable switch,
provider preset select Groq/OpenAI/Custom that fills `base_url` + default
`model`, api-key password input, model input, fallback switch). The Privacy
tab's local-only indicator turns amber with "audio is sent to {base_url}" when
cloud is enabled.

Rules:
- If `language` is a concrete non-English code (not `"en"` and not `"auto"`) and
  the selected `model` ends with `.en`, the Rust side transparently uses the
  multilingual variant of the same size (strip `.en`). With `"auto"` the chosen
  model is kept as-is (an `.en` model then effectively pins English).
- Model files are named `ggml-<model>.bin`, stored in `<app_data_dir>/models/`,
  downloaded from `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-<model>.bin`.

## Tauri commands (UI → Rust, all via `invoke`)

| Command | Args | Returns | Notes |
|---|---|---|---|
| `get_settings` | – | `Settings` | |
| `set_settings` | `{ settings: Settings }` | `Settings` | Validates + normalizes hotkey, re-registers shortcut, persists. Returns the stored value. |
| `list_input_devices` | – | `string[]` | cpal device names. |
| `list_models` | – | `ModelInfo[]` | `{ id: string, size_bytes: number, downloaded: boolean }` — `size_bytes` is expected download size; for downloaded models the actual file size. |
| `download_model` | `{ id: string }` | `null` | Async; emits `model-download-progress`. Errors as string. |
| `delete_model` | `{ id: string }` | `null` | |
| `start_test_recording` | – | `null` | Onboarding/scratch: records mic until `stop_test_recording` or VAD stop; emits `app-state`, then `transcription` with the result. Does NOT inject. |
| `stop_test_recording` | – | `null` | |
| `transcribe_wav` | `{ path: string }` | `string` | Test harness: runs an arbitrary 16-kHz mono WAV through whisper (+ optional post-processing). Used by self-test. |
| `get_history` | – | `HistoryEntry[]` | `{ text: string, ts_ms: number }`, newest first, max 20. |
| `clear_history` | – | `null` | |
| `copy_text` | `{ text: string }` | `null` | Puts text on the system clipboard. |
| `get_disk_usage` | – | `{ models_bytes: number }` | |
| `set_paused` | `{ paused: boolean }` | `null` | Pause/resume global hotkey. |
| `open_permission_settings` | – | `null` | macOS: deep-link to Accessibility pane; Windows: microphone privacy settings; Linux: no-op. |
| `open_url` | `{ url: string }` | `null` | Opens an external `https://` URL in the default browser (author profile, Groq console, docs). Rejects anything that is not `https://`. Mock: `window.open`. Replaces the former `open_repo`. |
| `check_updates` | – | `UpdateStatus` | `{ current: string, latest: string\|null, update_available: boolean, url: string }` — GETs the GitHub `releases/latest` API, compares `tag_name` against the app version (numeric triple; a tag that does not parse yields `latest: null`, never an update). Unlike license checks this DOES hard-error (string) on network failure — the manual button surfaces it. |

Command errors are strings (Tauri default `Result<T, String>`).

## Events (Rust → UI, via `emit`)

| Event | Payload |
|---|---|
| `app-state` | `{ state: "idle" \| "recording" \| "transcribing" \| "error", message?: string }` |
| `transcription` | `{ text: string, injected: boolean }` |
| `model-download-progress` | `{ id: string, downloaded: number, total: number }` |
| `update-available` | `{ current: string, latest: string, url: string }` — emitted by the daily background update check (24 h tokio interval, first tick at startup) when a newer published release exists. Failures only log at warn. |

## whispr-core public API (pure Rust, no system deps)

```rust
// vad.rs — silence-triggered stop, operates on per-frame voice decisions
pub struct VadConfig { pub frame_ms: u32, pub silence_timeout_ms: u32, pub min_speech_ms: u32 }
impl Default for VadConfig // 30 / 800 / 200
pub enum VadDecision { WaitingForSpeech, Speech, Stop }
pub struct VadTrigger { /* state machine */ }
impl VadTrigger {
    pub fn new(cfg: VadConfig) -> Self;
    /// Feed one frame's classification; returns the trigger state.
    /// Stop fires only after speech was detected (>= min_speech_ms of voiced
    /// frames) followed by >= silence_timeout_ms of continuous silence.
    pub fn push_frame(&mut self, is_voice: bool) -> VadDecision;
    pub fn reset(&mut self);
}

// hotkey.rs
pub enum HotkeyError { Empty, NoKey, UnknownToken(String), NoModifier }
/// Parse a user-typed / captured combo into canonical form understood by
/// tauri-plugin-global-shortcut: modifiers sorted (Ctrl, Alt, Shift, Super),
/// "+"-joined, key capitalized. Accepts aliases: option/opt→Alt, cmd/command/win/meta→Super,
/// control→Ctrl, return→Enter, esc→Escape, spacebar/space→Space. Case/whitespace-insensitive.
pub fn normalize_hotkey(input: &str) -> Result<String, HotkeyError>;
/// Human display form: macOS → "⌥Space", others → "Alt+Space".
pub fn display_hotkey(normalized: &str, macos: bool) -> String;

// inject.rs
pub enum InjectMethod { UnicodeKeystrokes, ClipboardPaste }
pub struct PlatformCaps { pub keystroke_injection: bool, pub max_chunk_chars: usize }
pub struct InjectPlan { pub method: InjectMethod, pub chunks: Vec<String> }
/// Sanitizes text (strips control chars except \n and \t, normalizes \r\n→\n),
/// chooses method (ClipboardPaste when keystroke_injection == false or text is empty
/// after sanitization → empty plan), splits into chunks of at most max_chunk_chars
/// chars, never splitting inside a grapheme-ish char boundary (split on char boundaries).
pub fn build_inject_plan(text: &str, caps: &PlatformCaps) -> InjectPlan;

// settings.rs — the Settings/PostprocSettings structs (serde) exactly as in the schema above,
// with Default impls producing the documented defaults, plus:
pub fn effective_model_id(model: &str, language: &str) -> String; // ".en"-stripping rule
pub const MODEL_IDS: &[&str]; // the 8 ids
pub fn model_download_url(id: &str) -> String;
pub fn model_size_bytes(id: &str) -> u64; // approx known sizes
```

`src-tauri` depends on `whispr-core` and must not duplicate this logic.

## Frontend Tauri wrapper

All `invoke`/`listen` calls go through `src/lib/tauri.ts`, which exports typed
functions and, when `import.meta.env.VITE_MOCK_TAURI === "1"` or Tauri is not
present (`!("__TAURI_INTERNALS__" in window)`), substitutes an in-browser mock
backed by `localStorage` (key `whispr-mock-settings`). The mock enables browser
dev, vitest, and Playwright runs without a Rust backend.

## Whisper sidecar

Binary name: `whisper-cli` (from whisper.cpp v1.7.4), bundled as Tauri sidecar
(`externalBin: ["binaries/whisper-cli"]` → files `src-tauri/binaries/whisper-cli-<target-triple>[.exe]`).
Invocation: `whisper-cli -m <model.bin> -f <wav> -l <lang|auto> -nt --no-prints -t <threads>`
→ transcript on stdout. In dev (`tauri dev`) the resolved sidecar path may not
exist until `sidecar/whisper/build-<os>.sh` has been run; surface a friendly
error state if missing.
