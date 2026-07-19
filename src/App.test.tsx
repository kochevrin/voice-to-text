import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { DEFAULT_SETTINGS, setSettings } from "@/lib/tauri";

describe("App (mock mode)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows Onboarding until onboarding_done", async () => {
    render(<App />);
    expect(
      await screen.findByText("Welcome to whispr-open"),
    ).toBeInTheDocument();
  });

  it("renders Home when onboarded and opens Settings from the gear button", async () => {
    localStorage.setItem(
      "whispr-mock-settings",
      JSON.stringify({ ...DEFAULT_SETTINGS, onboarding_done: true }),
    );
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("whispr-open")).toBeInTheDocument();
    expect(screen.getByText("No transcriptions yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "GitHub" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByLabelText("Hotkey")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("No transcriptions yet.")).toBeInTheDocument();
  });

  it("renders Home in Ukrainian when ui_language is uk", async () => {
    localStorage.setItem(
      "whispr-mock-settings",
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        onboarding_done: true,
        ui_language: "uk",
      }),
    );
    render(<App />);

    expect(await screen.findByText("Розшифровок ще немає.")).toBeInTheDocument();
    expect(screen.getByText("Історія")).toBeInTheDocument();
    expect(screen.getByText("Перевірка диктування")).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Призупинити диктування" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Налаштування" }),
    ).toBeInTheDocument();
    // Product names and hotkey combos are never translated.
    expect(screen.getByText("whispr-open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "GitHub" })).toBeInTheDocument();
  });

  it("switches language in place when settings are saved, without a reload", async () => {
    const onboarded = { ...DEFAULT_SETTINGS, onboarding_done: true };
    localStorage.setItem("whispr-mock-settings", JSON.stringify(onboarded));
    render(<App />);

    expect(await screen.findByText("History")).toBeInTheDocument();

    // Stands in for the Settings language select: any view that persists
    // settings must move the whole shell to the new language.
    await act(async () => {
      await setSettings({ ...onboarded, ui_language: "uk" });
    });

    expect(await screen.findByText("Історія")).toBeInTheDocument();
    expect(screen.queryByText("History")).not.toBeInTheDocument();
  });

  it("shows the update banner on Home when a newer version is available", async () => {
    localStorage.setItem(
      "whispr-mock-settings",
      JSON.stringify({ ...DEFAULT_SETTINGS, onboarding_done: true }),
    );
    // The mock reports an update while this flag holds a version.
    localStorage.setItem("whispr-mock-update", "0.9.9");
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const user = userEvent.setup();
    render(<App />);

    // The banner appears from Home's on-mount check, not a background emit.
    expect(
      await screen.findByText("Update 0.9.9 is available"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(open).toHaveBeenCalledWith(
      "https://github.com/kochevrin/voice-to-text/releases/latest",
      "_blank",
    );

    // Dismissing clears the banner.
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(
      screen.queryByText("Update 0.9.9 is available"),
    ).not.toBeInTheDocument();
    open.mockRestore();
  });

  it("makes the paused state unmistakable on Home", async () => {
    localStorage.setItem(
      "whispr-mock-settings",
      JSON.stringify({ ...DEFAULT_SETTINGS, onboarding_done: true, paused: true }),
    );
    render(<App />);

    expect(await screen.findByText("Paused")).toBeInTheDocument();
    expect(
      screen.getByText(/Dictation is paused — the hotkey does nothing/),
    ).toBeInTheDocument();

    const toggle = screen.getByRole("switch", { name: "Pause dictation" });
    expect(toggle).toBeChecked();
  });
});
