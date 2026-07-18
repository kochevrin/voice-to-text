// Typed wrapper around Tauri IPC per docs/contracts.md. When Tauri is not
// present (browser dev, vitest, Playwright) or VITE_MOCK_TAURI === "1", a
// faithful in-browser mock backed by localStorage is used instead.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppState,
  AppStateEvent,
  DiskUsage,
  HistoryEntry,
  ModelDownloadProgress,
  ModelInfo,
  Settings,
  TranscriptionEvent,
} from "./types";
import { MODEL_IDS } from "./types";

export type Unsubscribe = () => void;

const isMock =
  import.meta.env.VITE_MOCK_TAURI === "1" || !("__TAURI_INTERNALS__" in window);

export const DEFAULT_SETTINGS: Settings = {
  hotkey: "Alt+Space",
  hotkey_mode: "push_to_talk",
  input_device: null,
  model: "base.en",
  language: "auto",
  silence_timeout_ms: 800,
  vad_enabled: true,
  pill_enabled: true,
  postproc: {
    enabled: false,
    ollama_url: "http://localhost:11434",
    model: "llama3.2:3b",
    prompt:
      "Fix grammar and punctuation. Preserve meaning. Output ONLY the corrected text.",
  },
  onboarding_done: false,
  paused: false,
};

export const MODEL_SIZE_BYTES: Record<string, number> = {
  tiny: 77_700_000,
  "tiny.en": 77_700_000,
  base: 147_950_000,
  "base.en": 147_950_000,
  small: 487_600_000,
  "small.en": 487_600_000,
  medium: 1_533_000_000,
  "medium.en": 1_533_000_000,
};

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

const SETTINGS_KEY = "whispr-mock-settings";
const HISTORY_KEY = "whispr-mock-history";
const MOCK_TRANSCRIPT = "hello world from mock";

const mockListeners = new Map<string, Set<(payload: unknown) => void>>();

function mockOn(event: string, cb: (payload: unknown) => void): Unsubscribe {
  let set = mockListeners.get(event);
  if (!set) {
    set = new Set();
    mockListeners.set(event, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}

function mockEmit(event: string, payload: unknown): void {
  const set = mockListeners.get(event);
  if (!set) return;
  for (const cb of [...set]) cb(payload);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mockReadSettings(): Settings {
  const defaults = clone(DEFAULT_SETTINGS);
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...defaults,
      ...parsed,
      postproc: { ...defaults.postproc, ...(parsed.postproc ?? {}) },
    };
  } catch {
    return defaults;
  }
}

function mockWriteSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function mockReadHistory(): HistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]).slice(0, 20) : [];
  } catch {
    return [];
  }
}

function mockPushHistory(text: string): void {
  const next = [{ text, ts_ms: Date.now() }, ...mockReadHistory()].slice(0, 20);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}

const mockDownloaded = new Set<string>(["base.en"]);
let mockState: AppState = "idle";
let mockRecordingTimer: ReturnType<typeof setTimeout> | null = null;

function setMockState(state: AppState): void {
  mockState = state;
  mockEmit("app-state", { state } satisfies AppStateEvent);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mockDownloadModel(id: string): Promise<null> {
  const total = MODEL_SIZE_BYTES[id];
  if (total === undefined) throw `unknown model: ${id}`;
  if (mockDownloaded.has(id)) return null;
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    await sleep(1500 / steps);
    mockEmit("model-download-progress", {
      id,
      downloaded: Math.round((total * i) / steps),
      total,
    } satisfies ModelDownloadProgress);
  }
  mockDownloaded.add(id);
  return null;
}

function mockFinishRecording(): void {
  mockRecordingTimer = null;
  setMockState("transcribing");
  setTimeout(() => {
    mockPushHistory(MOCK_TRANSCRIPT);
    mockEmit("transcription", {
      text: MOCK_TRANSCRIPT,
      injected: false,
    } satisfies TranscriptionEvent);
    setMockState("idle");
  }, 500);
}

async function mockStartTestRecording(): Promise<null> {
  if (mockState !== "idle") return null;
  setMockState("recording");
  mockRecordingTimer = setTimeout(mockFinishRecording, 1200);
  return null;
}

async function mockStopTestRecording(): Promise<null> {
  if (mockRecordingTimer !== null) {
    clearTimeout(mockRecordingTimer);
    mockFinishRecording();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API — commands
// ---------------------------------------------------------------------------

export function getSettings(): Promise<Settings> {
  if (!isMock) return invoke<Settings>("get_settings");
  return Promise.resolve(mockReadSettings());
}

export function setSettings(settings: Settings): Promise<Settings> {
  if (!isMock) return invoke<Settings>("set_settings", { settings });
  const stored = clone(settings);
  mockWriteSettings(stored);
  return Promise.resolve(stored);
}

export function listInputDevices(): Promise<string[]> {
  if (!isMock) return invoke<string[]>("list_input_devices");
  return Promise.resolve(["Default", "Mock Microphone"]);
}

export function listModels(): Promise<ModelInfo[]> {
  if (!isMock) return invoke<ModelInfo[]>("list_models");
  return Promise.resolve(
    MODEL_IDS.map((id) => ({
      id,
      size_bytes: MODEL_SIZE_BYTES[id],
      downloaded: mockDownloaded.has(id),
    })),
  );
}

export function downloadModel(id: string): Promise<null> {
  if (!isMock) return invoke<null>("download_model", { id });
  return mockDownloadModel(id);
}

export function deleteModel(id: string): Promise<null> {
  if (!isMock) return invoke<null>("delete_model", { id });
  mockDownloaded.delete(id);
  return Promise.resolve(null);
}

export function startTestRecording(): Promise<null> {
  if (!isMock) return invoke<null>("start_test_recording");
  return mockStartTestRecording();
}

export function stopTestRecording(): Promise<null> {
  if (!isMock) return invoke<null>("stop_test_recording");
  return mockStopTestRecording();
}

export function transcribeWav(path: string): Promise<string> {
  if (!isMock) return invoke<string>("transcribe_wav", { path });
  return Promise.resolve(MOCK_TRANSCRIPT);
}

export function getHistory(): Promise<HistoryEntry[]> {
  if (!isMock) return invoke<HistoryEntry[]>("get_history");
  return Promise.resolve(mockReadHistory());
}

export function clearHistory(): Promise<null> {
  if (!isMock) return invoke<null>("clear_history");
  localStorage.removeItem(HISTORY_KEY);
  return Promise.resolve(null);
}

export function copyText(text: string): Promise<null> {
  if (!isMock) return invoke<null>("copy_text", { text });
  // jsdom has no navigator.clipboard; browsers may reject without focus.
  void navigator.clipboard?.writeText(text).catch(() => undefined);
  return Promise.resolve(null);
}

export function getDiskUsage(): Promise<DiskUsage> {
  if (!isMock) return invoke<DiskUsage>("get_disk_usage");
  let models_bytes = 0;
  for (const id of mockDownloaded) models_bytes += MODEL_SIZE_BYTES[id] ?? 0;
  return Promise.resolve({ models_bytes });
}

export function setPaused(paused: boolean): Promise<null> {
  if (!isMock) return invoke<null>("set_paused", { paused });
  const settings = mockReadSettings();
  settings.paused = paused;
  mockWriteSettings(settings);
  return Promise.resolve(null);
}

export function openPermissionSettings(): Promise<null> {
  if (!isMock) return invoke<null>("open_permission_settings");
  return Promise.resolve(null);
}

// ---------------------------------------------------------------------------
// Public API — events
// ---------------------------------------------------------------------------

function subscribe<T>(event: string, cb: (payload: T) => void): Unsubscribe {
  if (isMock) return mockOn(event, cb as (payload: unknown) => void);
  const pending = listen<T>(event, (e) => cb(e.payload));
  return () => {
    void pending.then((unlisten) => unlisten());
  };
}

export function onAppState(cb: (e: AppStateEvent) => void): Unsubscribe {
  return subscribe("app-state", cb);
}

export function onTranscription(cb: (e: TranscriptionEvent) => void): Unsubscribe {
  return subscribe("transcription", cb);
}

export function onModelDownloadProgress(
  cb: (e: ModelDownloadProgress) => void,
): Unsubscribe {
  return subscribe("model-download-progress", cb);
}
