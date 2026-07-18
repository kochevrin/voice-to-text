//! macOS injection: synthetic keyboard events carrying Unicode payloads
//! (CGEventKeyboardSetUnicodeString). Requires the Accessibility permission.

use std::time::Duration;

use core_graphics::event::{CGEvent, CGEventTapLocation};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use whispr_core::PlatformCaps;

use super::InjectError;

/// CGEventKeyboardSetUnicodeString only reliably delivers short strings per
/// event, so chunks are further split into pieces of this many UTF-16 units.
const MAX_UTF16_PER_EVENT: usize = 20;
const INTER_EVENT_DELAY: Duration = Duration::from_millis(5);
const INTER_CHUNK_DELAY: Duration = Duration::from_millis(15);

pub fn caps() -> PlatformCaps {
    PlatformCaps {
        keystroke_injection: true,
        max_chunk_chars: 200,
    }
}

pub fn inject_chunks(chunks: &[String]) -> Result<(), InjectError> {
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).map_err(|_| {
        InjectError {
            injected_chunks: 0,
            message: "failed to create CGEventSource".to_string(),
        }
    })?;
    for (done, chunk) in chunks.iter().enumerate() {
        let event_error = || InjectError {
            injected_chunks: done,
            message: "failed to create keyboard event".to_string(),
        };
        let utf16: Vec<u16> = chunk.encode_utf16().collect();
        for piece in split_utf16(&utf16, MAX_UTF16_PER_EVENT) {
            let down = CGEvent::new_keyboard_event(source.clone(), 0, true)
                .map_err(|_| event_error())?;
            down.set_string_from_utf16_unchecked(piece);
            down.post(CGEventTapLocation::HID);

            let up = CGEvent::new_keyboard_event(source.clone(), 0, false)
                .map_err(|_| event_error())?;
            up.post(CGEventTapLocation::HID);

            std::thread::sleep(INTER_EVENT_DELAY);
        }
        std::thread::sleep(INTER_CHUNK_DELAY);
    }
    Ok(())
}

/// Splits UTF-16 units into pieces of at most `max` units without separating
/// a surrogate pair.
fn split_utf16(units: &[u16], max: usize) -> Vec<&[u16]> {
    let mut pieces = Vec::new();
    let mut start = 0;
    while start < units.len() {
        let mut end = (start + max).min(units.len());
        // Never end a piece on a high surrogate whose low half follows.
        if end < units.len() && (0xD800..0xDC00).contains(&units[end - 1]) {
            end -= 1;
        }
        if end == start {
            end = start + 1; // defensive: never stall
        }
        pieces.push(&units[start..end]);
        start = end;
    }
    pieces
}
