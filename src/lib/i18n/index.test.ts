import { describe, expect, it } from "vitest";
import { translate } from "./index";

describe("translate", () => {
  it("returns the Ukrainian string when one exists", () => {
    expect(translate("uk", "home.history.title")).toBe("Історія");
  });

  it("interpolates {name} placeholders", () => {
    expect(translate("en", "home.license.trial", { days: 5 })).toBe(
      "TRIAL · 5d",
    );
    expect(translate("uk", "home.license.trial", { days: 5 })).toBe(
      "ПРОБНИЙ ПЕРІОД · 5 дн",
    );
  });

  it("leaves an unknown placeholder verbatim", () => {
    expect(translate("en", "home.license.trial", { other: 1 })).toBe(
      "TRIAL · {days}d",
    );
  });

  it("falls back to the key itself when it is absent from every dict", () => {
    const missing = "home.__missing__" as never;
    expect(translate("uk", missing)).toBe("home.__missing__");
    expect(translate("en", missing)).toBe("home.__missing__");
  });
});
