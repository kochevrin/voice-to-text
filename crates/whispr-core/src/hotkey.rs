//! Hotkey combo parsing/normalization and human-readable display.
//!
//! `normalize_hotkey` turns user-typed or captured combos into the canonical
//! form understood by `tauri-plugin-global-shortcut`: modifiers sorted
//! (Ctrl, Alt, Shift, Super), "+"-joined, key capitalized.

use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum HotkeyError {
    #[error("hotkey is empty")]
    Empty,
    #[error("hotkey must contain exactly one non-modifier key")]
    NoKey,
    #[error("unknown hotkey token: {0}")]
    UnknownToken(String),
    #[error("hotkey must contain at least one modifier")]
    NoModifier,
}

/// Canonical modifier order.
const MOD_ORDER: [&str; 4] = ["Ctrl", "Alt", "Shift", "Super"];

fn normalize_modifier(token: &str) -> Option<&'static str> {
    match token {
        "ctrl" | "control" => Some("Ctrl"),
        "alt" | "option" | "opt" => Some("Alt"),
        "shift" => Some("Shift"),
        "super" | "cmd" | "command" | "win" | "meta" => Some("Super"),
        _ => None,
    }
}

/// `token` must already be lowercased.
fn normalize_key(token: &str) -> Option<String> {
    let named = match token {
        "space" | "spacebar" => Some("Space"),
        "enter" | "return" => Some("Enter"),
        "escape" | "esc" => Some("Escape"),
        "tab" => Some("Tab"),
        "backspace" => Some("Backspace"),
        "delete" => Some("Delete"),
        "home" => Some("Home"),
        "end" => Some("End"),
        "pageup" => Some("PageUp"),
        "pagedown" => Some("PageDown"),
        "up" => Some("Up"),
        "down" => Some("Down"),
        "left" => Some("Left"),
        "right" => Some("Right"),
        _ => None,
    };
    if let Some(name) = named {
        return Some(name.to_string());
    }
    // F1..F24 (no leading zeros: "f01" is rejected).
    if let Some(num) = token.strip_prefix('f') {
        if let Ok(n) = num.parse::<u8>() {
            if (1..=24).contains(&n) && num == n.to_string() {
                return Some(format!("F{n}"));
            }
        }
    }
    // Single alphanumeric character: A..Z, 0..9.
    let mut chars = token.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        if c.is_ascii_alphanumeric() {
            return Some(c.to_ascii_uppercase().to_string());
        }
    }
    None
}

/// Parse a user-typed / captured combo into canonical form.
///
/// Rules:
/// - case- and whitespace-insensitive; tokens separated by `+`
/// - modifier aliases: `control`→Ctrl, `option`/`opt`→Alt,
///   `cmd`/`command`/`win`/`meta`→Super
/// - key aliases: `return`→Enter, `esc`→Escape, `spacebar`/`space`→Space
/// - requires at least one modifier ([`HotkeyError::NoModifier`]) and exactly
///   one non-modifier key ([`HotkeyError::NoKey`] for zero or several)
/// - duplicate modifiers are deduplicated; output order is
///   Ctrl, Alt, Shift, Super, then the key, joined with `+`
pub fn normalize_hotkey(input: &str) -> Result<String, HotkeyError> {
    let mut mods: Vec<&'static str> = Vec::new();
    let mut key: Option<String> = None;
    let mut saw_token = false;

    for raw in input.split('+') {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        saw_token = true;
        let token = trimmed.to_lowercase();
        if let Some(m) = normalize_modifier(&token) {
            if !mods.contains(&m) {
                mods.push(m);
            }
        } else if let Some(k) = normalize_key(&token) {
            if key.is_some() {
                return Err(HotkeyError::NoKey); // more than one key
            }
            key = Some(k);
        } else {
            return Err(HotkeyError::UnknownToken(trimmed.to_string()));
        }
    }

    if !saw_token {
        return Err(HotkeyError::Empty);
    }
    let key = key.ok_or(HotkeyError::NoKey)?;
    if mods.is_empty() {
        return Err(HotkeyError::NoModifier);
    }

    let mut parts: Vec<&str> = MOD_ORDER
        .iter()
        .filter(|m| mods.contains(*m))
        .copied()
        .collect();
    parts.push(&key);
    Ok(parts.join("+"))
}

/// Human display form of a normalized combo.
///
/// `macos == true`: modifier symbols concatenated with the key, no
/// separators — Ctrl→⌃ (U+2303), Alt→⌥ (U+2325), Shift→⇧ (U+21E7),
/// Super→⌘ (U+2318), e.g. `"Alt+Space"` → `"⌥Space"`.
/// `macos == false`: tokens joined with `+`, e.g. `"Alt+Space"`.
pub fn display_hotkey(normalized: &str, macos: bool) -> String {
    if !macos {
        return normalized.split('+').collect::<Vec<_>>().join("+");
    }
    normalized
        .split('+')
        .map(|t| match t {
            "Ctrl" => "\u{2303}",
            "Alt" => "\u{2325}",
            "Shift" => "\u{21E7}",
            "Super" => "\u{2318}",
            other => other,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_combo() {
        assert_eq!(normalize_hotkey("Alt+Space").unwrap(), "Alt+Space");
    }

    #[test]
    fn case_insensitive() {
        assert_eq!(normalize_hotkey("CTRL+ALT+a").unwrap(), "Ctrl+Alt+A");
        assert_eq!(normalize_hotkey("shift+ESCAPE").unwrap(), "Shift+Escape");
    }

    #[test]
    fn whitespace_insensitive() {
        assert_eq!(normalize_hotkey("  ctrl +  shift + p ").unwrap(), "Ctrl+Shift+P");
    }

    #[test]
    fn modifier_aliases() {
        assert_eq!(normalize_hotkey("cmd+space").unwrap(), "Super+Space");
        assert_eq!(normalize_hotkey("command+k").unwrap(), "Super+K");
        assert_eq!(normalize_hotkey("win+d").unwrap(), "Super+D");
        assert_eq!(normalize_hotkey("meta+d").unwrap(), "Super+D");
        assert_eq!(normalize_hotkey("option+space").unwrap(), "Alt+Space");
        assert_eq!(normalize_hotkey("opt+esc").unwrap(), "Alt+Escape");
        assert_eq!(normalize_hotkey("control+return").unwrap(), "Ctrl+Enter");
    }

    #[test]
    fn key_aliases() {
        assert_eq!(normalize_hotkey("ctrl+spacebar").unwrap(), "Ctrl+Space");
        assert_eq!(normalize_hotkey("ctrl+return").unwrap(), "Ctrl+Enter");
        assert_eq!(normalize_hotkey("ctrl+esc").unwrap(), "Ctrl+Escape");
    }

    #[test]
    fn modifier_ordering() {
        assert_eq!(
            normalize_hotkey("Shift+Ctrl+Super+Alt+F5").unwrap(),
            "Ctrl+Alt+Shift+Super+F5"
        );
        assert_eq!(normalize_hotkey("shift+alt+x").unwrap(), "Alt+Shift+X");
    }

    #[test]
    fn duplicate_modifiers_deduplicated() {
        assert_eq!(normalize_hotkey("ctrl+control+a").unwrap(), "Ctrl+A");
    }

    #[test]
    fn named_keys() {
        assert_eq!(normalize_hotkey("alt+up").unwrap(), "Alt+Up");
        assert_eq!(normalize_hotkey("alt+down").unwrap(), "Alt+Down");
        assert_eq!(normalize_hotkey("alt+left").unwrap(), "Alt+Left");
        assert_eq!(normalize_hotkey("alt+right").unwrap(), "Alt+Right");
        assert_eq!(normalize_hotkey("alt+tab").unwrap(), "Alt+Tab");
        assert_eq!(normalize_hotkey("alt+backspace").unwrap(), "Alt+Backspace");
        assert_eq!(normalize_hotkey("alt+delete").unwrap(), "Alt+Delete");
        assert_eq!(normalize_hotkey("alt+home").unwrap(), "Alt+Home");
        assert_eq!(normalize_hotkey("alt+end").unwrap(), "Alt+End");
        assert_eq!(normalize_hotkey("super+pageup").unwrap(), "Super+PageUp");
        assert_eq!(normalize_hotkey("super+pagedown").unwrap(), "Super+PageDown");
    }

    #[test]
    fn function_keys() {
        assert_eq!(normalize_hotkey("ctrl+f1").unwrap(), "Ctrl+F1");
        assert_eq!(normalize_hotkey("ctrl+F12").unwrap(), "Ctrl+F12");
        assert_eq!(normalize_hotkey("ctrl+f24").unwrap(), "Ctrl+F24");
        assert_eq!(
            normalize_hotkey("ctrl+f25"),
            Err(HotkeyError::UnknownToken("f25".to_string()))
        );
        assert_eq!(
            normalize_hotkey("ctrl+f0"),
            Err(HotkeyError::UnknownToken("f0".to_string()))
        );
        assert_eq!(
            normalize_hotkey("ctrl+f01"),
            Err(HotkeyError::UnknownToken("f01".to_string()))
        );
    }

    #[test]
    fn single_chars_uppercased() {
        assert_eq!(normalize_hotkey("ctrl+q").unwrap(), "Ctrl+Q");
        assert_eq!(normalize_hotkey("alt+1").unwrap(), "Alt+1");
        // "f" alone is the letter F, not a function key.
        assert_eq!(normalize_hotkey("ctrl+f").unwrap(), "Ctrl+F");
    }

    #[test]
    fn error_empty() {
        assert_eq!(normalize_hotkey(""), Err(HotkeyError::Empty));
        assert_eq!(normalize_hotkey("   "), Err(HotkeyError::Empty));
        assert_eq!(normalize_hotkey("++"), Err(HotkeyError::Empty));
    }

    #[test]
    fn error_no_key() {
        assert_eq!(normalize_hotkey("Ctrl"), Err(HotkeyError::NoKey));
        assert_eq!(normalize_hotkey("ctrl+shift"), Err(HotkeyError::NoKey));
        // Two non-modifier keys is also "not exactly one key".
        assert_eq!(normalize_hotkey("ctrl+a+b"), Err(HotkeyError::NoKey));
    }

    #[test]
    fn error_no_modifier() {
        assert_eq!(normalize_hotkey("A"), Err(HotkeyError::NoModifier));
        assert_eq!(normalize_hotkey("space"), Err(HotkeyError::NoModifier));
    }

    #[test]
    fn error_unknown_token() {
        assert_eq!(
            normalize_hotkey("ctrl+foo"),
            Err(HotkeyError::UnknownToken("foo".to_string()))
        );
        // Original (trimmed, not lowercased) spelling is reported.
        assert_eq!(
            normalize_hotkey("ctrl+ FooBar "),
            Err(HotkeyError::UnknownToken("FooBar".to_string()))
        );
        assert_eq!(
            normalize_hotkey("ctrl+é"),
            Err(HotkeyError::UnknownToken("é".to_string()))
        );
    }

    #[test]
    fn empty_tokens_between_separators_skipped() {
        assert_eq!(normalize_hotkey("ctrl++a").unwrap(), "Ctrl+A");
    }

    #[test]
    fn display_non_macos() {
        assert_eq!(display_hotkey("Alt+Space", false), "Alt+Space");
        assert_eq!(
            display_hotkey("Ctrl+Alt+Shift+Super+A", false),
            "Ctrl+Alt+Shift+Super+A"
        );
    }

    #[test]
    fn display_macos() {
        assert_eq!(display_hotkey("Alt+Space", true), "\u{2325}Space");
        assert_eq!(
            display_hotkey("Ctrl+Alt+Shift+Super+A", true),
            "\u{2303}\u{2325}\u{21E7}\u{2318}A"
        );
        assert_eq!(display_hotkey("Super+Enter", true), "\u{2318}Enter");
    }
}
