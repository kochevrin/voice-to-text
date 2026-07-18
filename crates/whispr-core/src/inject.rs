//! Text-injection planning: sanitize transcribed text and split it into
//! platform-appropriate chunks for keystroke injection or clipboard paste.

/// How the text gets delivered into the focused application.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InjectMethod {
    /// Type the text as synthetic Unicode keystrokes, chunk by chunk.
    UnicodeKeystrokes,
    /// Put the text on the clipboard and synthesize a paste.
    ClipboardPaste,
}

/// What the current platform supports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlatformCaps {
    /// Whether synthetic Unicode keystroke injection is available.
    pub keystroke_injection: bool,
    /// Maximum number of characters per injected chunk.
    pub max_chunk_chars: usize,
}

/// The result of [`build_inject_plan`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InjectPlan {
    pub method: InjectMethod,
    pub chunks: Vec<String>,
}

/// Strip control characters (except `\n` and `\t`); normalize `\r\n` and
/// lone `\r` to `\n`.
fn sanitize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                out.push('\n');
            }
            '\n' | '\t' => out.push(c),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out
}

/// Build an injection plan for `text` given the platform capabilities.
///
/// - Sanitizes the text (control characters stripped except `\n`/`\t`,
///   `\r\n` and lone `\r` normalized to `\n`).
/// - Empty sanitized text yields an empty plan (no chunks).
/// - `keystroke_injection == false` yields [`InjectMethod::ClipboardPaste`]
///   with the whole sanitized text as a single chunk.
/// - Otherwise the text is split into chunks of at most `max_chunk_chars`
///   characters (chars, not bytes — multi-byte characters are never split).
pub fn build_inject_plan(text: &str, caps: &PlatformCaps) -> InjectPlan {
    let sanitized = sanitize(text);
    if sanitized.is_empty() {
        return InjectPlan {
            method: InjectMethod::ClipboardPaste,
            chunks: Vec::new(),
        };
    }
    if !caps.keystroke_injection {
        return InjectPlan {
            method: InjectMethod::ClipboardPaste,
            chunks: vec![sanitized],
        };
    }
    // Guard against a zero chunk size; one char per chunk is the minimum.
    let max = caps.max_chunk_chars.max(1);
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut count = 0usize;
    for c in sanitized.chars() {
        if count == max {
            chunks.push(std::mem::take(&mut current));
            count = 0;
        }
        current.push(c);
        count += 1;
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    InjectPlan {
        method: InjectMethod::UnicodeKeystrokes,
        chunks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keystroke_caps(max: usize) -> PlatformCaps {
        PlatformCaps {
            keystroke_injection: true,
            max_chunk_chars: max,
        }
    }

    #[test]
    fn simple_text_single_chunk() {
        let plan = build_inject_plan("hello world", &keystroke_caps(100));
        assert_eq!(plan.method, InjectMethod::UnicodeKeystrokes);
        assert_eq!(plan.chunks, vec!["hello world"]);
    }

    #[test]
    fn crlf_normalized_to_lf() {
        let plan = build_inject_plan("a\r\nb", &keystroke_caps(100));
        assert_eq!(plan.chunks, vec!["a\nb"]);
    }

    #[test]
    fn lone_cr_normalized_to_lf() {
        let plan = build_inject_plan("a\rb", &keystroke_caps(100));
        assert_eq!(plan.chunks, vec!["a\nb"]);
        // Lone \r followed by \r\n: two newlines.
        let plan = build_inject_plan("a\r\r\nb", &keystroke_caps(100));
        assert_eq!(plan.chunks, vec!["a\n\nb"]);
    }

    #[test]
    fn control_chars_stripped_except_newline_and_tab() {
        let plan = build_inject_plan("\u{0}a\u{7}b\u{1b}c\u{7f}\u{85}d\te\nf", &keystroke_caps(100));
        assert_eq!(plan.chunks, vec!["abcd\te\nf"]);
    }

    #[test]
    fn chunking_ascii() {
        let plan = build_inject_plan("abcdefgh", &keystroke_caps(3));
        assert_eq!(plan.chunks, vec!["abc", "def", "gh"]);
    }

    #[test]
    fn chunking_exact_multiple_no_empty_tail() {
        let plan = build_inject_plan("abcd", &keystroke_caps(2));
        assert_eq!(plan.chunks, vec!["ab", "cd"]);
    }

    #[test]
    fn chunking_cyrillic_counts_chars_not_bytes() {
        // Each Cyrillic char is 2 bytes in UTF-8; byte-based splitting at 2
        // would break inside a character.
        let plan = build_inject_plan("привет", &keystroke_caps(2));
        assert_eq!(plan.chunks, vec!["пр", "ив", "ет"]);
    }

    #[test]
    fn chunking_emoji_counts_chars_not_bytes() {
        // Each emoji is 4 bytes in UTF-8.
        let plan = build_inject_plan("\u{1F600}\u{1F600}\u{1F600}", &keystroke_caps(2));
        assert_eq!(plan.chunks, vec!["\u{1F600}\u{1F600}", "\u{1F600}"]);
    }

    #[test]
    fn chunking_mixed_multibyte() {
        let plan = build_inject_plan("aж\u{1F600}b", &keystroke_caps(3));
        assert_eq!(plan.chunks, vec!["aж\u{1F600}", "b"]);
    }

    #[test]
    fn clipboard_when_no_keystroke_injection() {
        let caps = PlatformCaps {
            keystroke_injection: false,
            max_chunk_chars: 3,
        };
        // Whole text as a single chunk even though it exceeds max_chunk_chars.
        let plan = build_inject_plan("hello\r\nworld", &caps);
        assert_eq!(plan.method, InjectMethod::ClipboardPaste);
        assert_eq!(plan.chunks, vec!["hello\nworld"]);
    }

    #[test]
    fn empty_input_yields_empty_plan() {
        let plan = build_inject_plan("", &keystroke_caps(10));
        assert_eq!(plan.method, InjectMethod::ClipboardPaste);
        assert!(plan.chunks.is_empty());
    }

    #[test]
    fn control_only_input_yields_empty_plan() {
        let plan = build_inject_plan("\u{0}\u{7}\u{1b}", &keystroke_caps(10));
        assert_eq!(plan.method, InjectMethod::ClipboardPaste);
        assert!(plan.chunks.is_empty());

        let caps = PlatformCaps {
            keystroke_injection: false,
            max_chunk_chars: 10,
        };
        let plan = build_inject_plan("\u{0}", &caps);
        assert!(plan.chunks.is_empty());
    }

    #[test]
    fn zero_max_chunk_chars_does_not_hang() {
        let plan = build_inject_plan("abc", &keystroke_caps(0));
        assert_eq!(plan.chunks, vec!["a", "b", "c"]);
    }
}
