//! whispr-open — cross-platform push-to-talk dictation (Tauri v2 backend).

mod audio;
mod commands;
mod hotkeys;
mod inject;
mod models;
mod pill;
mod postproc;
mod recorder;
mod session;
mod state;
mod tray;
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
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    hotkeys::handle_event(app, event.state());
                })
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running whispr-open");
}
