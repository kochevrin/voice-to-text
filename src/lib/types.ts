// TS mirrors of the Rust types in docs/contracts.md. Field names must stay
// snake_case to match the serde-serialized payloads exactly.

export type HotkeyMode = "push_to_talk" | "toggle";

export interface PostprocSettings {
  enabled: boolean;
  ollama_url: string;
  model: string;
  prompt: string;
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
  postproc: PostprocSettings;
  onboarding_done: boolean;
  paused: boolean;
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
