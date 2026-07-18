import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Onboarding } from "./Onboarding";
import { I18nProvider } from "@/lib/i18n";
import { DEFAULT_SETTINGS } from "@/lib/tauri";
import type { Settings } from "@/lib/types";

/** Mirrors App.tsx: the shell provides the language from the settings. */
function renderWizard(
  overrides: Partial<Settings> = {},
  onComplete = vi.fn(),
) {
  const settings = { ...DEFAULT_SETTINGS, ...overrides };
  render(
    <I18nProvider lang={settings.ui_language}>
      <Onboarding settings={settings} onComplete={onComplete} />
    </I18nProvider>,
  );
  return onComplete;
}

describe("Onboarding (mock mode)", () => {
  beforeAll(() => {
    // jsdom lacks these APIs Radix Select relies on.
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it("gates Finish on a transcript or an explicit skip", async () => {
    const user = userEvent.setup();
    const onComplete = renderWizard();

    // Step 1: hotkey (prefilled with the default) -> Next.
    expect(screen.getByLabelText("Hotkey")).toHaveValue("Alt+Space");
    await user.click(screen.getByRole("button", { name: "Next" }));

    // Step 2: permissions (jsdom UA is Linux, where the system settings
    // button is a no-op and therefore hidden) -> Next.
    expect(
      screen.getByRole("heading", { name: "Permissions (Linux)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Open system settings/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));

    // Step 3: Finish is gated until a transcript exists or the test is skipped.
    const finish = screen.getByRole("button", { name: "Finish" });
    expect(finish).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Skip test" }));
    expect(finish).toBeEnabled();

    await user.click(finish);
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));

    const stored = JSON.parse(localStorage.getItem("whispr-mock-settings")!);
    expect(stored.onboarding_done).toBe(true);
    expect(stored.hotkey).toBe("Alt+Space");
  });

  it("persists the model choice immediately, before Finish", async () => {
    const user = userEvent.setup();
    renderWizard();

    // Go to step 3.
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    // Pick a different model in the dropdown.
    await user.click(screen.getByLabelText("Model"));
    await user.click(await screen.findByRole("option", { name: /tiny\.en/ }));

    // The choice is written to settings right away — no Finish needed.
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("whispr-mock-settings")!);
      expect(stored.model).toBe("tiny.en");
      expect(stored.onboarding_done).toBe(false);
    });
  });

  it("renders the wizard in Ukrainian when ui_language is uk", async () => {
    const user = userEvent.setup();
    renderWizard({ ui_language: "uk" });

    // Step 1 — header, step counter, step copy, footer.
    expect(screen.getByText("Вітаємо у whispr-open")).toBeInTheDocument();
    expect(screen.getByText("Крок 1 із 3")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Оберіть гарячу клавішу для диктування" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Гаряча клавіша")).toHaveValue("Alt+Space");

    // Step 2 — per-OS permission copy, with the OS name left untranslated.
    await user.click(screen.getByRole("button", { name: "Далі" }));
    expect(
      screen.getByRole("heading", { name: "Дозволи (Linux)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/На Wayland емуляція натискань клавіш/),
    ).toBeInTheDocument();

    // Step 3 — model step and the Finish gate hint.
    await user.click(screen.getByRole("button", { name: "Далі" }));
    expect(screen.getByLabelText("Модель")).toBeInTheDocument();
    expect(
      screen.getByText("Запустіть тест або пропустіть його."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Готово" })).toBeDisabled();

    // The language switch persists immediately, like the model select.
    expect(
      screen.getByRole("group", { name: "Мова інтерфейсу" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "UK" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "EN" }));
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("whispr-mock-settings")!);
      expect(stored.ui_language).toBe("en");
    });
  });
});
