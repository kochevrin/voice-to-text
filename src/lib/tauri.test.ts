import { beforeEach, describe, expect, it } from "vitest";
import { getHistory } from "./tauri";

describe("tauri mock history", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns [] when localStorage holds valid non-array JSON", async () => {
    localStorage.setItem("whispr-mock-history", "{}");
    await expect(getHistory()).resolves.toEqual([]);
  });
});
