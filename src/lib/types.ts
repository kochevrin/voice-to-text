// TS mirrors of the Rust types in docs/contracts.md. Field names must stay
// snake_case to match the serde-serialized payloads exactly.

import type { Lang } from "./i18n";

export type HotkeyMode = "push_to_talk" | "toggle";

export interface PostprocSettings {
  enabled: boolean;
  ollama_url: string;
  model: string;
  prompt: string;
}

export interface CloudSettings {
  enabled: boolean;
  base_url: string;
  api_key: string;
  model: string;
  fallback_to_local: boolean;
}

export interface LicenseSettings {
  key: string;
  server_url: string;
}

export interface Settings {
  hotkey: string;
  hotkey_mode: HotkeyMode;
  input_device: string | null;
  model: string;
  language: string;
  silence_timeout_ms: number;
  vad_enabled: boolean;
  pill_enabled: boolean;
  /** Launch the app at login. */
  autostart: boolean;
  postproc: PostprocSettings;
  cloud: CloudSettings;
  history_enabled: boolean;
  /** Interface language. Independent of `language`, which is what Whisper
   * transcribes. */
  ui_language: Lang;
  license: LicenseSettings;
  onboarding_done: boolean;
  paused: boolean;
}

export type LicenseState =
  | "disabled"
  | "trial"
  | "active"
  | "inactive"
  | "unverified";

export interface LicenseStatus {
  state: LicenseState;
  trial_days_left: number | null;
  expires: string | null;
  last_checked_ms: number | null;
  /** What the license server last said about the key: true = accepted,
   * false = rejected, null = never verified. */
  server_active: boolean | null;
  /** Subscription days remaining, independent of trial_days_left. */
  days_left: number | null;
  /** Why the server rejected the key ("device_limit"); null otherwise. */
  reason: string | null;
}

export interface UpdateStatus {
  current: string;
  /** Latest published version ("0.4.0"); null when the tag doesn't parse. */
  latest: string | null;
  update_available: boolean;
  /** Where the Download button should send the user. */
  url: string;
}

export interface UpdateAvailableEvent {
  current: string;
  latest: string;
  url: string;
}

export interface ModelInfo {
  id: string;
  size_bytes: number;
  downloaded: boolean;
}

export interface HistoryEntry {
  text: string;
  ts_ms: number;
}

export type AppState = "idle" | "recording" | "transcribing" | "error";

export interface AppStateEvent {
  state: AppState;
  message?: string;
}

export interface TranscriptionEvent {
  text: string;
  injected: boolean;
}

export interface ModelDownloadProgress {
  id: string;
  downloaded: number;
  total: number;
}

export interface DiskUsage {
  models_bytes: number;
}

export const MODEL_IDS = [
  "tiny",
  "tiny.en",
  "base",
  "base.en",
  "small",
  "small.en",
  "medium",
  "medium.en",
] as const;
