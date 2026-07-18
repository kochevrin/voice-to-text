//! Recording flow orchestration: start → capture → transcribe → post-process
//! → inject → history/event, shared by hotkeys, tray and commands.

use std::path::Path;

use tauri::{AppHandle, Emitter, Manager};

use crate::recorder::{self, RecorderConfig, RecorderHandle};
use crate::state::{self, AppState, Phase, RecorderSlot, TranscriptionPayload};
use crate::{cloud, inject, license, pill, postproc, tray, whisper};

/// Ignore takes shorter than this (accidental key taps): 0.15 s.
const MIN_SAMPLES: usize = 2400;

/// Claims the session slot synchronously (so a hotkey press followed by a
/// quick release is ordered correctly), optimistically flips to Recording and
/// runs the blocking device startup on a background thread. Returns the
/// startup task, or `None` when a session is already starting/active or a
/// transcription is in flight (no-op).
fn spawn_startup(
    app: &AppHandle,
    test: bool,
) -> Option<tauri::async_runtime::JoinHandle<Result<(), String>>> {
    let state = app.state::<AppState>();
    match state::current_phase(app) {
        Phase::Recording | Phase::Transcribing => return None,
        Phase::Idle | Phase::Error => {}
    }
    {
        let mut slot = state.recorder.lock().unwrap();
        match *slot {
            RecorderSlot::Idle => {
                *slot = RecorderSlot::Starting {
                    stop_requested: false,
                }
            }
            // A session is already starting or active; keep it.
            _ => return None,
        }
    }

    let settings = state::current_settings(app);
    state::set_phase(app, Phase::Recording, None);
    if settings.pill_enabled && !test {
        pill::show(app);
    }

    let app = app.clone();
    Some(tauri::async_runtime::spawn_blocking(move || {
        let app_for_auto_stop = app.clone();
        let result = recorder::start(
            RecorderConfig {
                device_name: settings.input_device.clone(),
                vad_enabled: settings.vad_enabled,
                silence_timeout_ms: settings.silence_timeout_ms,
                test,
            },
            move || {
                tauri::async_runtime::spawn(finish_recording(app_for_auto_stop));
            },
        );
        finish_startup(&app, result)
    }))
}

/// Completes a device startup: stores the handle (honoring a stop that arrived
/// while the device was opening) or tears the session back down, reporting the
/// failure via Phase::Error.
fn finish_startup(app: &AppHandle, result: Result<RecorderHandle, String>) -> Result<(), String> {
    let state = app.state::<AppState>();
    let handle = match result {
        Ok(handle) => handle,
        Err(e) => {
            *state.recorder.lock().unwrap() = RecorderSlot::Idle;
            pill::hide(app);
            state::set_phase(app, Phase::Error, Some(e.clone()));
            return Err(e);
        }
    };
    let stop_requested = {
        let mut slot = state.recorder.lock().unwrap();
        let stop_requested = matches!(
            *slot,
            RecorderSlot::Starting {
                stop_requested: true
            }
        );
        *slot = RecorderSlot::Active(handle);
        stop_requested
    };
    if stop_requested {
        tauri::async_runtime::spawn(finish_recording(app.clone()));
    }
    Ok(())
}

/// Starts a recording session from the hotkey/tray path without blocking the
/// caller (opening the device can take seconds): startup failures surface as
/// a notification + Phase::Error instead of a return value. Refuses with a
/// notification when the license is inactive (phase stays Idle).
pub fn start_recording_detached(app: &AppHandle, test: bool) {
    if let Err(message) = license::ensure_can_dictate(app) {
        state::notify(app, "whispr-open", &message);
        return;
    }
    let Some(task) = spawn_startup(app, test) else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = match task.await {
            Ok(result) => result,
            Err(e) => finish_startup(&app, Err(format!("recorder startup task failed: {e}"))),
        };
        if let Err(e) = result {
            tracing::warn!("failed to start recording: {e}");
            state::notify(&app, "whispr-open", &format!("Could not start recording: {e}"));
        }
    });
}

/// Starts a recording session and waits for the device to be ready, returning
/// the startup error (command path). No-ops when a session is already active
/// or a transcription is in flight. Refuses with a notification + `Err` when
/// the license is inactive (phase stays Idle).
pub async fn start_recording(app: &AppHandle, test: bool) -> Result<(), String> {
    if let Err(message) = license::ensure_can_dictate(app) {
        state::notify(app, "whispr-open", &message);
        return Err(message);
    }
    let Some(task) = spawn_startup(app, test) else {
        return Ok(());
    };
    match task.await {
        Ok(result) => result,
        Err(e) => finish_startup(app, Err(format!("recorder startup task failed: {e}"))),
    }
}

/// Stops the active session (if any) and runs the full pipeline. Safe to call
/// concurrently — only the caller that takes the handle proceeds.
pub async fn finish_recording(app: AppHandle) {
    let handle = {
        let state = app.state::<AppState>();
        let mut slot = state.recorder.lock().unwrap();
        match std::mem::replace(&mut *slot, RecorderSlot::Idle) {
            RecorderSlot::Active(handle) => Some(handle),
            RecorderSlot::Starting { .. } => {
                // Device startup is still in flight; ask it to stop once ready.
                *slot = RecorderSlot::Starting {
                    stop_requested: true,
                };
                None
            }
            RecorderSlot::Idle => None,
        }
    };
    let Some(handle) = handle else { return };
    let test = handle.test;

    pill::hide(&app);
    state::set_phase(&app, Phase::Transcribing, None);

    let samples = match tauri::async_runtime::spawn_blocking(move || handle.stop()).await {
        Ok(Ok(samples)) => samples,
        Ok(Err(e)) => {
            fail(&app, format!("recording failed: {e}")).await;
            return;
        }
        Err(e) => {
            fail(&app, format!("recording failed: {e}")).await;
            return;
        }
    };
    if samples.len() < MIN_SAMPLES {
        tracing::debug!("recording too short ({} samples); skipping", samples.len());
        emit_transcription(&app, String::new(), false);
        state::set_phase(&app, Phase::Idle, None);
        return;
    }

    let wav = recorder::temp_wav_path();
    let wav_for_write = wav.clone();
    let samples_for_write = samples;
    let write_result = tauri::async_runtime::spawn_blocking(move || {
        recorder::write_wav_16k_mono(&samples_for_write, &wav_for_write)
    })
    .await;
    match write_result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            fail(&app, format!("failed to write recording: {e}")).await;
            return;
        }
        Err(e) => {
            fail(&app, format!("failed to write recording: {e}")).await;
            return;
        }
    }

    let transcript = transcribe(&app, &wav).await;
    let _ = tokio::fs::remove_file(&wav).await;

    let raw = match transcript {
        Ok(text) => text,
        Err(e) => {
            fail(&app, e).await;
            return;
        }
    };

    let settings = state::current_settings(&app);
    let text = postproc::apply(&settings.postproc, &raw).await;
    let text = clean_transcript(&text);

    let injected = if !test && !text.is_empty() {
        inject::inject_text(&app, &text).await
    } else {
        false
    };

    if !text.is_empty() && settings.history_enabled {
        let state = app.state::<AppState>();
        let snapshot = {
            let mut history = state.history.lock().unwrap();
            state::push_history(
                &mut history,
                state::HistoryEntry {
                    text: text.clone(),
                    ts_ms: state::now_ms(),
                },
            );
            history.clone()
        };
        if let Err(e) = state::save_history(&app, &snapshot) {
            tracing::warn!("failed to persist history: {e}");
        }
        tray::refresh_menu(&app);
    }

    emit_transcription(&app, text, injected);
    state::set_phase(&app, Phase::Idle, None);
}

/// Transcription dispatcher: cloud API when enabled and an API key is set,
/// otherwise (or as fallback on cloud failure) the local whisper sidecar.
/// Used by both the recording pipeline and the `transcribe_wav` command.
pub async fn transcribe(app: &AppHandle, wav: &Path) -> Result<String, String> {
    let settings = state::current_settings(app);
    if settings.cloud.enabled && !settings.cloud.api_key.trim().is_empty() {
        match cloud::transcribe(&settings, wav).await {
            Ok(text) => return Ok(text),
            Err(e) if settings.cloud.fallback_to_local => {
                tracing::warn!("cloud transcription failed ({e}); falling back to local whisper");
            }
            Err(e) => return Err(e),
        }
    }
    whisper::transcribe(app, wav).await
}

async fn fail(app: &AppHandle, message: String) {
    tracing::warn!("recording pipeline failed: {message}");
    state::notify(app, "whispr-open", &message);
    state::set_phase(app, Phase::Error, Some(message));
}

fn emit_transcription(app: &AppHandle, text: String, injected: bool) {
    let _ = app.emit("transcription", TranscriptionPayload { text, injected });
}

/// Trims and drops whole-output whisper non-speech markers such as
/// "[BLANK_AUDIO]" or "(silence)".
fn clean_transcript(text: &str) -> String {
    let trimmed = text.trim();
    let is_marker = trimmed.len() > 1
        && ((trimmed.starts_with('[') && trimmed.ends_with(']'))
            || (trimmed.starts_with('(') && trimmed.ends_with(')')));
    if is_marker {
        String::new()
    } else {
        trimmed.to_string()
    }
}
