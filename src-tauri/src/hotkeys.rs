//! Global hotkey registration and press/release handling.

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::i18n::{self, Msg};
use crate::session;
use crate::state::{self, Phase};

/// (Re-)registers the configured hotkey; unregisters everything when paused.
pub fn sync_registration(app: &AppHandle) -> Result<(), String> {
    let settings = state::current_settings(app);
    apply_registration(app, &settings.hotkey, settings.paused)
}

/// Unregisters everything, then registers `hotkey` unless `paused`. Lets
/// callers try a new hotkey state before persisting it.
pub fn apply_registration(app: &AppHandle, hotkey: &str, paused: bool) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    shortcuts.unregister_all().map_err(|e| e.to_string())?;
    if !paused && shortcuts.register(hotkey).is_err() {
        // On Windows the OS releases a grab asynchronously, so registering a
        // combo right after unregistering it can hit the not-yet-released
        // grab. Wait briefly and retry once before giving up.
        std::thread::sleep(std::time::Duration::from_millis(150));
        shortcuts.register(hotkey).map_err(|e| {
            i18n::t(&state::ui_language(app), Msg::HotkeyRegisterFailed)
                .replace("{hotkey}", hotkey)
                .replace("{detail}", &e.to_string())
        })?;
    }
    Ok(())
}

pub fn unregister_all(app: &AppHandle) {
    if let Err(e) = app.global_shortcut().unregister_all() {
        tracing::warn!("failed to unregister hotkeys: {e}");
    }
}

/// Called from the global-shortcut plugin handler for every hotkey event.
pub fn handle_event(app: &AppHandle, shortcut_state: ShortcutState) {
    let settings = state::current_settings(app);
    let push_to_talk = settings.hotkey_mode != "toggle";

    match (shortcut_state, push_to_talk) {
        (ShortcutState::Pressed, true) => session::start_recording_detached(app, false),
        (ShortcutState::Released, true) => {
            tauri::async_runtime::spawn(session::finish_recording(app.clone()));
        }
        (ShortcutState::Pressed, false) => {
            if state::current_phase(app) == Phase::Recording {
                tauri::async_runtime::spawn(session::finish_recording(app.clone()));
            } else {
                session::start_recording_detached(app, false);
            }
        }
        (ShortcutState::Released, false) => {}
    }
}
