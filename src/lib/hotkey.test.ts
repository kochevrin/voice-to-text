import { describe, expect, it } from "vitest";
import { displayHotkey, keyEventToCombo, type HotkeyKeyEvent } from "./hotkey";

function ev(over: Partial<HotkeyKeyEvent>): HotkeyKeyEvent {
  return {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    code: "",
    ...over,
  };
}

describe("keyEventToCombo", () => {
  it("maps Alt+Space", () => {
    expect(keyEventToCombo(ev({ altKey: true, code: "Space" }))).toBe("Alt+Space");
  });

  it("orders modifiers Ctrl, Alt, Shift, Super", () => {
    expect(
      keyEventToCombo(
        ev({
          metaKey: true,
          shiftKey: true,
          altKey: true,
          ctrlKey: true,
          code: "KeyA",
        }),
      ),
    ).toBe("Ctrl+Alt+Shift+Super+A");
  });

  it("maps letters and digits from KeyX/DigitN codes", () => {
    expect(keyEventToCombo(ev({ ctrlKey: true, code: "KeyZ" }))).toBe("Ctrl+Z");
    expect(keyEventToCombo(ev({ ctrlKey: true, code: "Digit1" }))).toBe("Ctrl+1");
  });

  it("maps function keys", () => {
    expect(keyEventToCombo(ev({ shiftKey: true, code: "F6" }))).toBe("Shift+F6");
    expect(keyEventToCombo(ev({ altKey: true, code: "F12" }))).toBe("Alt+F12");
  });

  it("returns null for a modifier-only press", () => {
    expect(keyEventToCombo(ev({ altKey: true, code: "AltLeft" }))).toBeNull();
    expect(keyEventToCombo(ev({ ctrlKey: true, code: "ControlLeft" }))).toBeNull();
  });

  it("returns null for a bare key without modifiers", () => {
    expect(keyEventToCombo(ev({ code: "KeyA" }))).toBeNull();
    expect(keyEventToCombo(ev({ code: "Space" }))).toBeNull();
  });

  it("returns null for unmapped codes", () => {
    expect(keyEventToCombo(ev({ ctrlKey: true, code: "MediaPlayPause" }))).toBeNull();
  });
});

describe("displayHotkey", () => {
  it("returns the combo unchanged on non-mac", () => {
    expect(displayHotkey("Alt+Space", false)).toBe("Alt+Space");
  });

  it("uses mac symbols on macOS", () => {
    expect(displayHotkey("Ctrl+Alt+Shift+Super+Space", true)).toBe("⌃⌥⇧⌘Space");
  });
});
