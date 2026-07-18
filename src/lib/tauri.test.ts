import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, getHistory, getSettings, openUrl } from "./tauri";

describe("tauri mock history", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns [] when localStorage holds valid non-array JSON", async () => {
    localStorage.setItem("whispr-mock-history", "{}");
    await expect(getHistory()).resolves.toEqual([]);
  });
});

describe("tauri mock settings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("hydrates stored settings without a cloud section using defaults", async () => {
    const { cloud: _cloud, ...legacy } = DEFAULT_SETTINGS;
    localStorage.setItem(
      "whispr-mock-settings",
      JSON.stringify({ ...legacy, hotkey: "Ctrl+Shift+K" }),
    );
    const settings = await getSettings();
    expect(settings.hotkey).toBe("Ctrl+Shift+K");
    expect(settings.cloud).toEqual(DEFAULT_SETTINGS.cloud);
  });

  it("defaults ui_language to en for settings stored before it existed", async () => {
    const { ui_language: _lang, ...legacy } = DEFAULT_SETTINGS;
    localStorage.setItem("whispr-mock-settings", JSON.stringify(legacy));
    await expect(getSettings()).resolves.toMatchObject({ ui_language: "en" });
  });
});

describe("tauri mock openUrl", () => {
  it("opens the given url in a new tab", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await openUrl("https://github.com/kochevrin");
    expect(open).toHaveBeenCalledWith("https://github.com/kochevrin", "_blank");
    open.mockRestore();
  });
});
