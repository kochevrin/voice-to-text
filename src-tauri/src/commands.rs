//! Tauri commands — the IPC surface defined in docs/contracts.md.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};
use whispr_core::{normalize_hotkey, HotkeyError, Settings, MODEL_IDS};

use crate::i18n::{self, Msg};
use crate::models::{self, DiskUsage, ModelInfo};
use crate::state::{self, AppState, HistoryEntry};
use crate::{audio, hotkeys, license, postproc, session, tray, updates};

/// Enables or disables the OS launch-at-login entry via tauri-plugin-autostart.
fn apply_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    if enabled { manager.enable() } else { manager.disable() }.map_err(|e| e.to_string())
}

fn hotkey_error_message(lang: &str, err: HotkeyError) -> String {
    match err {
        HotkeyError::Empty => i18n::t(lang, Msg::HotkeyEmpty).to_string(),
        HotkeyError::NoKey => i18n::t(lang, Msg::HotkeyNoKey).to_string(),
        HotkeyError::UnknownToken(token) => {
            i18n::t(lang, Msg::HotkeyUnknownToken).replace("{token}", &token)
        }
        HotkeyError::NoModifier => i18n::t(lang, Msg::HotkeyNoModifier).to_string(),
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
    let previous = state.settings.read().unwrap().clone();
    // A rejected request applies nothing, so the interface the user is looking
    // at keeps the language stored before the call: report every error in it.
    let lang = previous.ui_language.clone();

    if !i18n::UI_LANGUAGES.contains(&settings.ui_language.as_str()) {
        return Err(i18n::t(&lang, Msg::UnknownUiLanguage).replace("{lang}", &settings.ui_language));
    }
    settings.hotkey =
        normalize_hotkey(&settings.hotkey).map_err(|e| hotkey_error_message(&lang, e))?;
    if !MODEL_IDS.contains(&settings.model.as_str()) {
        return Err(i18n::t(&lang, Msg::UnknownModel).replace("{model}", &settings.model));
    }

    // Apply the login entry first: unlike the hotkey it has no rollback
    // dependency, so a failure here rejects the save cleanly before any other
    // OS state is touched. Persisting happens later, so the stored flag never
    // says one thing while the OS does another.
    let autostart_changed = settings.autostart != previous.autostart;
    if autostart_changed {
        if let Err(e) = apply_autostart(&app, settings.autostart) {
            return Err(i18n::t(&lang, Msg::AutostartFailed).replace("{detail}", &e));
        }
    }

    // Try the new hotkey state before persisting anything, so a combo the OS
    // rejects doesn't clobber a working one. Skipped when hotkey and paused
    // are unchanged: there is nothing to re-register, and on Windows tearing
    // down and instantly re-grabbing the same combo can race the OS's async
    // grab release and spuriously fail with "hotkey already taken".
    if settings.hotkey != previous.hotkey || settings.paused != previous.paused {
        if let Err(e) = hotkeys::apply_registration(&app, &settings.hotkey, settings.paused) {
            if let Err(restore) =
                hotkeys::apply_registration(&app, &previous.hotkey, previous.paused)
            {
                tracing::warn!("failed to restore previous hotkey: {restore}");
            }
            // Roll back the autostart change too, so a rejected save leaves no
            // applied OS state behind.
            if autostart_changed {
                if let Err(revert) = apply_autostart(&app, previous.autostart) {
                    tracing::warn!("failed to restore previous autostart: {revert}");
                }
            }
            return Err(i18n::t(&lang, Msg::KeepingPreviousSettings).replace("{detail}", &e));
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
        return Err(i18n::t(&state::ui_language(&app), Msg::NoSuchFile)
            .replace("{path}", &wav.display().to_string()));
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
            return Err(i18n::t(&previous.ui_language, Msg::KeepingPreviousSettings)
                .replace("{detail}", &e));
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

/// Opens an external URL in the default browser. Only `https://` is accepted:
/// the UI passes fixed destinations (author profile, Groq console, docs), and
/// refusing every other scheme keeps the command from becoming a way to launch
/// arbitrary handlers. The refusal is not translated — the command takes no
/// app handle, and it only fires on a caller bug, never on user input.
#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("only https URLs can be opened".to_string());
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_license_status(app: AppHandle) -> Result<license::LicenseStatus, String> {
    Ok(license::current_status(&app))
}

#[tauri::command]
pub async fn check_license_now(app: AppHandle) -> Result<license::LicenseStatus, String> {
    Ok(license::check_now(&app).await)
}

#[tauri::command]
pub async fn check_updates(app: AppHandle) -> Result<updates::UpdateStatus, String> {
    updates::check_now(&app).await
}
