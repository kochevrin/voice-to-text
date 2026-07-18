// Keyboard-event -> combo-string mapping for the hotkey capture fields.
// Combos use the canonical form from docs/contracts.md: modifiers ordered
// Ctrl, Alt, Shift, Super, "+"-joined, key capitalized (e.g. "Alt+Space").

export interface HotkeyKeyEvent {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  code: string;
}

const SPECIAL_CODES: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Escape: "Escape",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
};

function codeToKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return SPECIAL_CODES[code] ?? null;
}

/**
 * Build a combo string from a keydown event. Returns null while the combo is
 * incomplete: modifier-only presses, unmapped keys, or a bare key without any
 * modifier (global shortcuts require at least one modifier).
 */
export function keyEventToCombo(e: HotkeyKeyEvent): string | null {
  const key = codeToKey(e.code);
  if (key === null) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");
  if (parts.length === 0) return null;
  parts.push(key);
  return parts.join("+");
}

const MAC_SYMBOLS: Record<string, string> = {
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Super: "⌘",
};

/** Human display form: macOS -> "⌥Space", others -> "Alt+Space". */
export function displayHotkey(normalized: string, macos: boolean): string {
  if (!macos) return normalized;
  return normalized
    .split("+")
    .map((token) => MAC_SYMBOLS[token] ?? token)
    .join("");
}

export function isMacPlatform(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.userAgent);
}
