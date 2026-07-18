//! Linux injection: X11 via enigo, Wayland via ydotool (when present),
//! otherwise the caller falls back to clipboard paste.

use std::time::Duration;

use whispr_core::PlatformCaps;

use super::InjectError;

const INTER_CHUNK_DELAY: Duration = Duration::from_millis(15);

fn is_wayland() -> bool {
    match std::env::var("XDG_SESSION_TYPE") {
        Ok(v) => v.eq_ignore_ascii_case("wayland"),
        // XDG_SESSION_TYPE may be unset (e.g. launched from a service);
        // fall back to the compositor socket.
        Err(_) => std::env::var_os("WAYLAND_DISPLAY").is_some(),
    }
}

fn has_ydotool() -> bool {
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).any(|dir| dir.join("ydotool").is_file()))
        .unwrap_or(false)
}

pub fn caps() -> PlatformCaps {
    let keystroke_injection = if is_wayland() { has_ydotool() } else { true };
    PlatformCaps {
        keystroke_injection,
        max_chunk_chars: 200,
    }
}

pub fn inject_chunks(chunks: &[String]) -> Result<(), InjectError> {
    if is_wayland() {
        for (done, chunk) in chunks.iter().enumerate() {
            let status = std::process::Command::new("ydotool")
                .arg("type")
                .arg("--")
                .arg(chunk)
                .status()
                .map_err(|e| InjectError {
                    injected_chunks: done,
                    message: format!("failed to spawn ydotool: {e}"),
                })?;
            if !status.success() {
                return Err(InjectError {
                    injected_chunks: done,
                    message: format!("ydotool type exited with {status}"),
                });
            }
            std::thread::sleep(INTER_CHUNK_DELAY);
        }
        Ok(())
    } else {
        use enigo::{Enigo, Keyboard, Settings};
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| InjectError {
            injected_chunks: 0,
            message: format!("enigo init failed: {e}"),
        })?;
        for (done, chunk) in chunks.iter().enumerate() {
            enigo.text(chunk).map_err(|e| InjectError {
                injected_chunks: done,
                message: format!("enigo text failed: {e}"),
            })?;
            std::thread::sleep(INTER_CHUNK_DELAY);
        }
        Ok(())
    }
}
