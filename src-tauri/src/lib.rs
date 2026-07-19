//! whispr-open — cross-platform push-to-talk dictation (Tauri v2 backend).

mod audio;
mod cloud;
mod commands;
mod hotkeys;
mod i18n;
mod inject;
mod license;
mod models;
mod pill;
mod postproc;
mod recorder;
mod session;
mod state;
mod tray;
mod updates;
pub mod whisper;

use tauri::Manager;

use crate::state::AppState;

pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .try_init();

    tauri::Builder::default()
        // Must be the first plugin: a second launch exits immediately and
        // focuses the existing instance instead of fighting for the hotkey.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    hotkeys::handle_event(app, event.state());
                })
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(AppState::default())
        .on_window_event(|window, event| {
            // Closing the main window hides it; the app lives in the tray.
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            {
                let state = app.state::<AppState>();
                *state.settings.write().unwrap() = state::load_settings(&handle);
                *state.history.lock().unwrap() = state::load_history(&handle);
            }
            tray::init(&handle)?;
            pill::preload(&handle);
            if let Err(e) = hotkeys::sync_registration(&handle) {
                tracing::warn!("{e}");
                state::notify(&handle, "whispr-open", &e);
            }
            // Sync the OS login entry to the stored flag on every launch, both
            // ways: enabling heals a moved binary path (AppImage renamed, app
            // dragged elsewhere), and disabling heals a divergence where the OS
            // entry was left on while a later save recorded the flag as off.
            // The stored flag is the single source of truth.
            {
                use tauri_plugin_autostart::ManagerExt;
                let manager = handle.autolaunch();
                let want = state::current_settings(&handle).autostart;
                let applied = if want { manager.enable() } else { manager.disable() };
                if let Err(e) = applied {
                    tracing::warn!("failed to sync the autostart entry: {e}");
                }
            }
            license::spawn_periodic_check(&handle);
            updates::spawn_periodic_check(&handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::set_settings,
            commands::list_input_devices,
            commands::list_models,
            commands::download_model,
            commands::delete_model,
            commands::start_test_recording,
            commands::stop_test_recording,
            commands::transcribe_wav,
            commands::get_history,
            commands::clear_history,
            commands::copy_text,
            commands::get_disk_usage,
            commands::set_paused,
            commands::open_permission_settings,
            commands::open_url,
            commands::get_license_status,
            commands::check_license_now,
            commands::check_updates,
        ])
        .run(tauri::generate_context!())
        .expect("error while running whispr-open");
}
