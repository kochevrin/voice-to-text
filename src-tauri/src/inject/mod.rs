//! Text injection into the focused application, planned by
//! `whispr_core::build_inject_plan` and executed per platform.

use tauri::AppHandle;
use whispr_core::{build_inject_plan, InjectMethod};

use crate::state;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
use linux as platform;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as platform;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
use windows as platform;

/// Keystroke-injection failure: the first `injected_chunks` chunks were fully
/// typed before the error hit.
pub struct InjectError {
    pub injected_chunks: usize,
    pub message: String,
}

/// Injects `text` into the focused app. Returns `true` when it was typed via
/// keystrokes, `false` when it went to the clipboard (or was empty).
pub async fn inject_text(app: &AppHandle, text: &str) -> bool {
    let caps = platform::caps();
    let plan = build_inject_plan(text, &caps);
    if plan.chunks.is_empty() {
        return false;
    }
    match plan.method {
        InjectMethod::UnicodeKeystrokes => {
            let chunks = plan.chunks.clone();
            let result =
                tauri::async_runtime::spawn_blocking(move || platform::inject_chunks(&chunks))
                    .await;
            match result {
                Ok(Ok(())) => true,
                Ok(Err(e)) => {
                    tracing::warn!(
                        "keystroke injection failed ({}); falling back to clipboard",
                        e.message
                    );
                    // Only the chunks that were not typed go to the clipboard,
                    // so pasting doesn't duplicate the already-typed prefix.
                    clipboard_fallback(
                        app,
                        &plan.chunks[e.injected_chunks..].concat(),
                        e.injected_chunks > 0,
                    );
                    false
                }
                Err(e) => {
                    tracing::warn!("injection task failed ({e}); falling back to clipboard");
                    clipboard_fallback(app, &plan.chunks.concat(), false);
                    false
                }
            }
        }
        InjectMethod::ClipboardPaste => {
            clipboard_fallback(app, &plan.chunks.concat(), false);
            false
        }
    }
}

fn clipboard_fallback(app: &AppHandle, text: &str, partially_typed: bool) {
    match state::copy_to_clipboard(app, text) {
        Ok(()) => {
            let paste_key = if cfg!(target_os = "macos") { "Cmd+V" } else { "Ctrl+V" };
            let message = if partially_typed {
                format!(
                    "Typing was interrupted — part of the text may already be typed; \
                     the rest was copied, press {paste_key} to paste"
                )
            } else {
                format!("Transcript copied — press {paste_key} to paste")
            };
            state::notify(app, "whispr-open", &message);
        }
        Err(e) => {
            tracing::warn!("clipboard fallback failed: {e}");
            state::notify(app, "whispr-open", "Could not copy transcript to clipboard");
        }
    }
}
