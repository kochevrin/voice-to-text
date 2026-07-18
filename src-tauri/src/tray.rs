//! System tray: state-tinted icon, menu (settings / recent / pause / quit).

use std::sync::OnceLock;

use tauri::menu::{CheckMenuItem, Menu, MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};

use crate::i18n::{self, Msg};
use crate::state::{self, AppState, HistoryEntry, Phase, RecorderSlot};
use crate::{hotkeys, session};

pub const TRAY_ID: &str = "whispr-tray";
const RECENT_PREFIX: &str = "recent-";
const RECENT_LABEL_MAX: usize = 40;

/// Base RGBA pixels of icons/32x32.png, decoded once.
fn base_icon() -> &'static (Vec<u8>, u32, u32) {
    static BASE: OnceLock<(Vec<u8>, u32, u32)> = OnceLock::new();
    BASE.get_or_init(|| {
        let img = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))
            .expect("bundled 32x32.png is a valid PNG");
        (img.rgba().to_vec(), img.width(), img.height())
    })
}

fn tint_for(phase: Phase) -> Option<[u8; 3]> {
    match phase {
        Phase::Idle => Some([46, 204, 113]),        // green
        Phase::Recording => Some([231, 76, 60]),    // red
        Phase::Transcribing => Some([241, 196, 15]), // amber
        Phase::Error => Some([128, 128, 128]),      // gray
    }
}

/// Blends the base icon toward the per-state tint, preserving alpha.
fn icon_for(phase: Phase) -> tauri::image::Image<'static> {
    let (rgba, width, height) = base_icon();
    let mut out = rgba.clone();
    if let Some(tint) = tint_for(phase) {
        const STRENGTH: u32 = 140; // 0..=255
        for px in out.chunks_exact_mut(4) {
            if px[3] == 0 {
                continue;
            }
            for c in 0..3 {
                let orig = px[c] as u32;
                px[c] = ((orig * (255 - STRENGTH) + tint[c] as u32 * STRENGTH) / 255) as u8;
            }
        }
    }
    tauri::image::Image::new_owned(out, *width, *height)
}

fn tooltip_for(phase: Phase, message: Option<&str>) -> String {
    match message {
        Some(msg) => format!("whispr-open — {}: {msg}", phase.as_str()),
        None => format!("whispr-open — {}", phase.as_str()),
    }
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let (history, paused) = snapshot(app);
    let menu = build_menu(app, &history, paused)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon_for(Phase::Idle))
        .tooltip(tooltip_for(Phase::Idle, None))
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .build(app)?;
    Ok(())
}

fn snapshot(app: &AppHandle) -> (Vec<HistoryEntry>, bool) {
    let state = app.state::<AppState>();
    let history = state.history.lock().unwrap().clone();
    let paused = state::current_settings(app).paused;
    (history, paused)
}

fn truncate_label(text: &str) -> String {
    let single_line = text.replace(['\n', '\r'], " ");
    let trimmed = single_line.trim();
    if trimmed.chars().count() <= RECENT_LABEL_MAX {
        trimmed.to_string()
    } else {
        let cut: String = trimmed.chars().take(RECENT_LABEL_MAX).collect();
        format!("{}…", cut.trim_end())
    }
}

fn build_menu(
    app: &AppHandle,
    history: &[HistoryEntry],
    paused: bool,
) -> tauri::Result<Menu<Wry>> {
    let lang = state::ui_language(app);
    let settings_item = MenuItem::with_id(
        app,
        "settings",
        i18n::t(&lang, Msg::TraySettings),
        true,
        None::<&str>,
    )?;

    let mut recent = SubmenuBuilder::new(app, i18n::t(&lang, Msg::TrayRecent));
    if history.is_empty() {
        let empty = MenuItem::with_id(
            app,
            "recent-empty",
            i18n::t(&lang, Msg::TrayRecentEmpty),
            false,
            None::<&str>,
        )?;
        recent = recent.item(&empty);
    } else {
        for (i, entry) in history.iter().enumerate() {
            let item = MenuItem::with_id(
                app,
                format!("{RECENT_PREFIX}{i}"),
                truncate_label(&entry.text),
                true,
                None::<&str>,
            )?;
            recent = recent.item(&item);
        }
    }
    let recent = recent.build()?;

    let pause_item = CheckMenuItem::with_id(
        app,
        "pause",
        i18n::t(&lang, Msg::TrayPause),
        true,
        paused,
        None::<&str>,
    )?;
    let quit_item =
        MenuItem::with_id(app, "quit", i18n::t(&lang, Msg::TrayQuit), true, None::<&str>)?;

    MenuBuilder::new(app)
        .item(&settings_item)
        .item(&recent)
        .separator()
        .item(&pause_item)
        .separator()
        .item(&quit_item)
        .build()
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "settings" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
        "pause" => toggle_pause(app),
        "quit" => {
            // Stop any in-flight capture thread before exiting.
            let slot = std::mem::replace(
                &mut *app.state::<AppState>().recorder.lock().unwrap(),
                RecorderSlot::Idle,
            );
            drop(slot);
            app.exit(0);
        }
        other => {
            if let Some(idx) = other.strip_prefix(RECENT_PREFIX) {
                if let Ok(idx) = idx.parse::<usize>() {
                    copy_recent(app, idx);
                }
            }
        }
    }
}

fn toggle_pause(app: &AppHandle) {
    let paused = {
        let state = app.state::<AppState>();
        let mut settings = state.settings.write().unwrap();
        settings.paused = !settings.paused;
        settings.paused
    };
    let settings = state::current_settings(app);
    if let Err(e) = state::save_settings(app, &settings) {
        tracing::warn!("failed to persist settings: {e}");
    }
    if paused {
        hotkeys::unregister_all(app);
        // A paused app should not keep recording.
        tauri::async_runtime::spawn(session::finish_recording(app.clone()));
    } else if let Err(e) = hotkeys::sync_registration(app) {
        state::notify(app, "whispr-open", &e);
    }
    refresh_menu(app);
}

fn copy_recent(app: &AppHandle, idx: usize) {
    let text = {
        let state = app.state::<AppState>();
        let history = state.history.lock().unwrap();
        history.get(idx).map(|e| e.text.clone())
    };
    if let Some(text) = text {
        match state::copy_to_clipboard(app, &text) {
            Ok(()) => {
                let notice = i18n::t(&state::ui_language(app), Msg::TranscriptCopied);
                state::notify(app, "whispr-open", notice);
            }
            Err(e) => tracing::warn!("failed to copy transcript: {e}"),
        }
    }
}

/// Rebuilds the tray menu from current history + pause state.
pub fn refresh_menu(app: &AppHandle) {
    let (history, paused) = snapshot(app);
    let app = app.clone();
    // Menus must be created/attached on the main thread on some platforms.
    let handle = app.clone();
    let _ = handle.run_on_main_thread(move || {
        match build_menu(&app, &history, paused) {
            Ok(menu) => {
                if let Some(tray) = app.tray_by_id(TRAY_ID) {
                    if let Err(e) = tray.set_menu(Some(menu)) {
                        tracing::warn!("failed to update tray menu: {e}");
                    }
                }
            }
            Err(e) => tracing::warn!("failed to rebuild tray menu: {e}"),
        }
    });
}

/// Updates tray icon + tooltip for the given app state.
pub fn set_state(app: &AppHandle, phase: Phase, message: Option<&str>) {
    let tooltip = tooltip_for(phase, message);
    let app = app.clone();
    let handle = app.clone();
    let _ = handle.run_on_main_thread(move || {
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            if let Err(e) = tray.set_icon(Some(icon_for(phase))) {
                tracing::warn!("failed to update tray icon: {e}");
            }
            let _ = tray.set_tooltip(Some(tooltip.as_str()));
        }
    });
}
