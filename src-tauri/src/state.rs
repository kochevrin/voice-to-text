//! Central application state, settings/history persistence and app-state events.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Mutex, RwLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use whispr_core::{LicenseState, Settings};

use crate::recorder::RecorderHandle;
use crate::tray;

pub const HISTORY_MAX: usize = 20;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    Idle,
    Recording,
    Transcribing,
    Error,
}

impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Idle => "idle",
            Phase::Recording => "recording",
            Phase::Transcribing => "transcribing",
            Phase::Error => "error",
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub text: String,
    pub ts_ms: u64,
}

/// Recorder session slot. Device startup runs on a background thread, so the
/// slot distinguishes "starting" from "active" to keep double-start and
/// stop-during-startup safe.
pub enum RecorderSlot {
    Idle,
    /// Startup in flight; `stop_requested` is set when a stop arrives before
    /// the device is ready.
    Starting { stop_requested: bool },
    Active(RecorderHandle),
}

pub struct AppState {
    pub settings: RwLock<Settings>,
    pub history: Mutex<Vec<HistoryEntry>>,
    pub recorder: Mutex<RecorderSlot>,
    pub phase: Mutex<Phase>,
    /// Model ids with a download currently in flight.
    pub downloads: Mutex<HashSet<String>>,
    /// Last effective license state seen by a check, for once-per-transition
    /// notifications.
    pub license_state: Mutex<Option<LicenseState>>,
    /// Kept alive for the whole app lifetime: on X11 the clipboard contents
    /// are only served while the owning `Clipboard` instance exists.
    pub clipboard: Mutex<Option<arboard::Clipboard>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            settings: RwLock::new(Settings::default()),
            history: Mutex::new(Vec::new()),
            recorder: Mutex::new(RecorderSlot::Idle),
            phase: Mutex::new(Phase::Idle),
            downloads: Mutex::new(HashSet::new()),
            license_state: Mutex::new(None),
            clipboard: Mutex::new(None),
        }
    }
}

pub fn current_settings(app: &AppHandle) -> Settings {
    app.state::<AppState>().settings.read().unwrap().clone()
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Paths + persistence
// ---------------------------------------------------------------------------

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

pub fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("settings.json"))
}

pub fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("history.json"))
}

pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("models"))
}

pub fn load_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| e.to_string())
}

pub fn load_history(app: &AppHandle) -> Vec<HistoryEntry> {
    history_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str::<Vec<HistoryEntry>>(&raw).ok())
        .map(|mut list| {
            list.truncate(HISTORY_MAX);
            list
        })
        .unwrap_or_default()
}

pub fn save_history(app: &AppHandle, history: &[HistoryEntry]) -> Result<(), String> {
    let path = history_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(history).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| e.to_string())
}

/// Insert `entry` as the newest item, keeping at most [`HISTORY_MAX`] entries.
pub fn push_history(list: &mut Vec<HistoryEntry>, entry: HistoryEntry) {
    list.insert(0, entry);
    list.truncate(HISTORY_MAX);
}

// ---------------------------------------------------------------------------
// Events + notifications
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
struct AppStatePayload {
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct TranscriptionPayload {
    pub text: String,
    pub injected: bool,
}

pub fn set_phase(app: &AppHandle, phase: Phase, message: Option<String>) {
    {
        let state = app.state::<AppState>();
        *state.phase.lock().unwrap() = phase;
    }
    let _ = app.emit(
        "app-state",
        AppStatePayload {
            state: phase.as_str(),
            message: message.clone(),
        },
    );
    tray::set_state(app, phase, message.as_deref());
}

pub fn current_phase(app: &AppHandle) -> Phase {
    *app.state::<AppState>().phase.lock().unwrap()
}

/// Tray notification; failures are only logged (never modal dialogs).
pub fn notify(app: &AppHandle, title: &str, body: &str) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        tracing::warn!("failed to show notification: {e}");
    }
}

pub fn copy_to_clipboard(app: &AppHandle, text: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut guard = state.clipboard.lock().unwrap();
    if guard.is_none() {
        *guard = Some(arboard::Clipboard::new().map_err(|e| e.to_string())?);
    }
    let clip = guard.as_mut().expect("clipboard just initialized");
    if let Err(first) = clip.set_text(text) {
        // The connection can go stale; retry once with a fresh clipboard.
        *guard = Some(arboard::Clipboard::new().map_err(|e| e.to_string())?);
        guard
            .as_mut()
            .expect("clipboard just initialized")
            .set_text(text)
            .map_err(|e| format!("{first}; retry failed: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(text: &str, ts_ms: u64) -> HistoryEntry {
        HistoryEntry {
            text: text.to_string(),
            ts_ms,
        }
    }

    #[test]
    fn push_history_newest_first() {
        let mut list = Vec::new();
        push_history(&mut list, entry("first", 1));
        push_history(&mut list, entry("second", 2));
        push_history(&mut list, entry("third", 3));
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].text, "third");
        assert_eq!(list[1].text, "second");
        assert_eq!(list[2].text, "first");
    }

    #[test]
    fn push_history_caps_at_max() {
        let mut list = Vec::new();
        for i in 0..(HISTORY_MAX as u64 + 5) {
            push_history(&mut list, entry(&format!("t{i}"), i));
        }
        assert_eq!(list.len(), HISTORY_MAX);
        // Newest kept, oldest dropped.
        assert_eq!(list[0].text, format!("t{}", HISTORY_MAX as u64 + 4));
        assert_eq!(list[HISTORY_MAX - 1].text, "t5");
    }
}
