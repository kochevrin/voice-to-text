//! Windows injection: SendInput with KEYEVENTF_UNICODE events. Surrogate
//! pairs are sent as consecutive UTF-16 units, which Windows reassembles.

use std::time::Duration;

use whispr_core::PlatformCaps;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    KEYEVENTF_UNICODE, VIRTUAL_KEY,
};

use super::InjectError;

const INTER_CHUNK_DELAY: Duration = Duration::from_millis(10);

pub fn caps() -> PlatformCaps {
    PlatformCaps {
        keystroke_injection: true,
        max_chunk_chars: 500,
    }
}

fn unicode_input(unit: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(0),
                wScan: unit,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

pub fn inject_chunks(chunks: &[String]) -> Result<(), InjectError> {
    for (done, chunk) in chunks.iter().enumerate() {
        let mut inputs: Vec<INPUT> = Vec::with_capacity(chunk.len() * 2);
        for unit in chunk.encode_utf16() {
            inputs.push(unicode_input(unit, KEYEVENTF_UNICODE));
            inputs.push(unicode_input(unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
        }
        if inputs.is_empty() {
            continue;
        }
        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent != inputs.len() as u32 {
            return Err(InjectError {
                injected_chunks: done,
                message: format!("SendInput delivered {sent} of {} events", inputs.len()),
            });
        }
        std::thread::sleep(INTER_CHUNK_DELAY);
    }
    Ok(())
}
