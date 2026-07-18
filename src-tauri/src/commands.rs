//! Tauri commands — the IPC surface defined in docs/contracts.md.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};
use whispr_core::{normalize_hotkey, HotkeyError, Settings, MODEL_IDS};

use crate::models::{self, DiskUsage, ModelInfo};
use crate::state::{self, AppState, HistoryEntry};
use crate::{audio, hotkeys, license, postproc, session, tray};

fn hotkey_error_message(err: HotkeyError) -> String {
    match err {
        HotkeyError::Empty => "hotkey must not be empty".to_string(),
        HotkeyError::NoKey => "hotkey needs a non-modifier key".to_string(),
        HotkeyError::UnknownToken(token) => format!("unknown key \"{token}\" in hotkey"),
        HotkeyError::NoModifier => "hotkey needs at least one modifier".to_string(),
    }
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    Ok(state.settings.read().unwrap().clone())
}

#[tauri::command]
pub async fn set_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    mut settings: Settings,
) -> Result<Settings, String> {
    settings.hotkey = normalize_hotkey(&settings.hotkey).map_err(hotkey_error_message)?;
    if !MODEL_IDS.contains(&settings.model.as_str()) {
        return Err(format!("unknown model: {}", settings.model));
    }

    // Try the new hotkey state before persisting anything, so a combo the OS
    // rejects doesn't clobber a working one. Skipped when hotkey and paused
    // are unchanged: there is nothing to re-register, and on Windows tearing
    // down and instantly re-grabbing the same combo can race the OS's async
    // grab release and spuriously fail with "hotkey already taken".
    let previous = state.settings.read().unwrap().clone();
    if settings.hotkey != previous.hotkey || settings.paused != previous.paused {
        if let Err(e) = hotkeys::apply_registration(&app, &settings.hotkey, settings.paused) {
            if let Err(restore) =
                hotkeys::apply_registration(&app, &previous.hotkey, previous.paused)
            {
                tracing::warn!("failed to restore previous hotkey: {restore}");
            }
            return Err(format!("{e}; keeping previous settings"));
        }
    }

    let stored = {
        let mut guard = state.settings.write().unwrap();
        *guard = settings;
        guard.clone()
    };
    state::save_settings(&app, &stored)?;
    if stored.license != previous.license {
        // License key/server changed: re-check in the background without
        // blocking the save.
        let app_for_check = app.clone();
        tauri::async_runtime::spawn(async move {
            license::run_check(&app_for_check).await;
        });
    }
    tray::refresh_menu(&app);
    Ok(stored)
}

#[tauri::command]
pub async fn list_input_devices() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(audio::list_input_devices)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_models(app: AppHandle) -> Result<Vec<ModelInfo>, String> {
    models::list_models(&app)
}

#[tauri::command]
pub async fn download_model(app: AppHandle, id: String) -> Result<(), String> {
    models::download_model(&app, &id).await
}

#[tauri::command]
pub async fn delete_model(app: AppHandle, id: String) -> Result<(), String> {
    models::delete_model(&app, &id)
}

#[tauri::command]
pub async fn start_test_recording(app: AppHandle) -> Result<(), String> {
    session::start_recording(&app, true).await
}

#[tauri::command]
pub async fn stop_test_recording(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn(session::finish_recording(app));
    Ok(())
}

#[tauri::command]
pub async fn transcribe_wav(app: AppHandle, path: String) -> Result<String, String> {
    let wav = PathBuf::from(path);
    if !wav.is_file() {
        return Err(format!("no such file: {}", wav.display()));
    }
    let raw = session::transcribe(&app, &wav).await?;
    let settings = state::current_settings(&app);
    Ok(postproc::apply(&settings.postproc, &raw).await)
}

#[tauri::command]
pub async fn get_history(state: State<'_, AppState>) -> Result<Vec<HistoryEntry>, String> {
    Ok(state.history.lock().unwrap().clone())
}

#[tauri::command]
pub async fn clear_history(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.history.lock().unwrap().clear();
    state::save_history(&app, &[])?;
    tray::refresh_menu(&app);
    Ok(())
}

#[tauri::command]
pub async fn copy_text(app: AppHandle, text: String) -> Result<(), String> {
    state::copy_to_clipboard(&app, &text)
}

#[tauri::command]
pub async fn get_disk_usage(app: AppHandle) -> Result<DiskUsage, String> {
    models::disk_usage(&app)
}

#[tauri::command]
pub async fn set_paused(app: AppHandle, paused: bool) -> Result<(), String> {
    // Try the new registration state before persisting it (resuming can fail
    // when the hotkey is grabbed by another app). Skipped when paused is
    // unchanged — re-registering the same combo is racy on Windows.
    let previous = state::current_settings(&app);
    if paused != previous.paused {
        if let Err(e) = hotkeys::apply_registration(&app, &previous.hotkey, paused) {
            if let Err(restore) =
                hotkeys::apply_registration(&app, &previous.hotkey, previous.paused)
            {
                tracing::warn!("failed to restore previous hotkey: {restore}");
            }
            return Err(format!("{e}; keeping previous settings"));
        }
    }
    let settings = {
        let state = app.state::<AppState>();
        let mut guard = state.settings.write().unwrap();
        guard.paused = paused;
        guard.clone()
    };
    state::save_settings(&app, &settings)?;
    if paused {
        // A paused app should not keep recording.
        tauri::async_runtime::spawn(session::finish_recording(app.clone()));
    }
    tray::refresh_menu(&app);
    Ok(())
}

#[tauri::command]
pub async fn open_permission_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        tauri_plugin_opener::open_url(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        tauri_plugin_opener::open_url("ms-settings:privacy-microphone", None::<&str>)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_repo() -> Result<(), String> {
    tauri_plugin_opener::open_url("https://github.com/kochevrin/voice-to-text", None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_license_status(app: AppHandle) -> Result<license::LicenseStatus, String> {
    Ok(license::current_status(&app))
}

#[tauri::command]
pub async fn check_license_now(app: AppHandle) -> Result<license::LicenseStatus, String> {
    Ok(license::check_now(&app).await)
}
