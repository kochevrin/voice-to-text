import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { DEFAULT_SETTINGS } from "@/lib/tauri";

describe("App (mock mode)", () => {
  beforeEach(() => {
    localStorage.clear();
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
