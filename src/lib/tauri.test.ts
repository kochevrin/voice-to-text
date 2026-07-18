import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, getHistory, getSettings } from "./tauri";

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
});
