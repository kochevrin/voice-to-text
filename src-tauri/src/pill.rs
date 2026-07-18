//! Floating "pill" overlay window shown while recording.

use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const PILL_LABEL: &str = "pill";
const PILL_WIDTH: f64 = 180.0;
const PILL_HEIGHT: f64 = 56.0;
const CURSOR_OFFSET: f64 = 18.0;
const BOTTOM_MARGIN: f64 = 96.0;

fn get_or_create(app: &AppHandle) -> Option<WebviewWindow> {
    if let Some(window) = app.get_webview_window(PILL_LABEL) {
        return Some(window);
    }
    let result = WebviewWindowBuilder::new(
        app,
        PILL_LABEL,
        WebviewUrl::App("index.html#/pill".into()),
    )
    .title("whispr-pill")
    .inner_size(PILL_WIDTH, PILL_HEIGHT)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false)
    .build();
    match result {
        Ok(window) => Some(window),
        Err(e) => {
            tracing::warn!("failed to create pill window: {e}");
            None
        }
    }
}

/// Creates the pill window hidden ahead of time so its webview has loaded and
/// registered its event listeners before the first recording starts.
pub fn preload(app: &AppHandle) {
    let _ = get_or_create(app);
}

/// Positions the pill near the cursor (fallback: bottom-center of the primary
/// monitor) and shows it. Positioning may be ignored on Wayland — tolerated.
pub fn show(app: &AppHandle) {
    let Some(window) = get_or_create(app) else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let (w, h) = (PILL_WIDTH * scale, PILL_HEIGHT * scale);

    let position = match app.cursor_position() {
        Ok(cursor) => {
            let mut x = cursor.x + CURSOR_OFFSET * scale;
            let mut y = cursor.y + CURSOR_OFFSET * scale;
            // Keep the pill inside the monitor under the cursor, if known.
            if let Ok(Some(monitor)) = app.monitor_from_point(cursor.x, cursor.y) {
                let pos = monitor.position();
                let size = monitor.size();
                x = x.min(pos.x as f64 + size.width as f64 - w).max(pos.x as f64);
                y = y.min(pos.y as f64 + size.height as f64 - h).max(pos.y as f64);
            }
            Some(PhysicalPosition::new(x as i32, y as i32))
        }
        Err(_) => app.primary_monitor().ok().flatten().map(|monitor| {
            let pos = monitor.position();
            let size = monitor.size();
            PhysicalPosition::new(
                (pos.x as f64 + (size.width as f64 - w) / 2.0) as i32,
                (pos.y as f64 + size.height as f64 - h - BOTTOM_MARGIN * scale) as i32,
            )
        }),
    };
    if let Some(position) = position {
        if let Err(e) = window.set_position(position) {
            tracing::debug!("pill positioning ignored: {e}");
        }
    }
    if let Err(e) = window.show() {
        tracing::warn!("failed to show pill: {e}");
    }
}

pub fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(PILL_LABEL) {
        if let Err(e) = window.hide() {
            tracing::debug!("failed to hide pill: {e}");
        }
    }
}
