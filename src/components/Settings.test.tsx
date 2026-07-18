// THE SPEC INTEGRATION TEST: rebind hotkey + toggle post-processing in mock
// mode, save, remount fresh — both values must be persisted (localStorage
// backed mock, key "whispr-mock-settings").

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "./Settings";
import { DEFAULT_SETTINGS } from "@/lib/tauri";

describe("Settings (mock mode)", () => {
  beforeEach(() => {
    localStorage.clear();
    // Seed a non-default hotkey so the Alt+Space rebind is a real change.
    localStorage.setItem(
      "whispr-mock-settings",
      JSON.stringify({ ...DEFAULT_SETTINGS, hotkey: "Ctrl+Shift+K", onboarding_done: true }),
    );
  });

  it("persists hotkey rebind and post-processing toggle across remount", async () => {
    const user = userEvent.setup();
    const first = render(<Settings />);

    // Rebind the hotkey: focus the capture field, press Alt+Space.
    const hotkeyField = await screen.findByLabelText("Hotkey");
    expect(hotkeyField).toHaveValue("Ctrl+Shift+K");
    fireEvent.keyDown(hotkeyField, { altKey: true, code: "Space" });
    expect(hotkeyField).toHaveValue("Alt+Space");

    // Toggle post-processing on its tab.
    await user.click(screen.getByRole("tab", { name: "Post-processing" }));
    const toggle = screen.getByRole("switch", { name: "Enable post-processing" });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(toggle).toBeChecked();

    // Save persists; the Save button goes back to disabled once stored.
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);
    await waitFor(() => expect(saveButton).toBeDisabled());

    first.unmount();

    // Fresh mount reads persisted settings from the mock backend.
    render(<Settings />);
    const reloadedHotkey = await screen.findByLabelText("Hotkey");
    expect(reloadedHotkey).toHaveValue("Alt+Space");

    await user.click(screen.getByRole("tab", { name: "Post-processing" }));
    expect(
      screen.getByRole("switch", { name: "Enable post-processing" }),
    ).toBeChecked();
  });

  it("persists cloud settings across remount and flips the privacy indicator", async () => {
    const user = userEvent.setup();
    const first = render(<Settings />);
    await screen.findByLabelText("Hotkey");

    // Privacy starts green while cloud is off.
    await user.click(screen.getByRole("tab", { name: "Privacy" }));
    expect(screen.getByText(/100% local/)).toBeInTheDocument();

    // Enable cloud and type an API key on the Transcription tab.
    await user.click(screen.getByRole("tab", { name: "Transcription" }));
    const cloudToggle = screen.getByRole("switch", {
      name: "Cloud transcription",
    });
    expect(cloudToggle).not.toBeChecked();
    await user.click(cloudToggle);
    expect(cloudToggle).toBeChecked();
    await user.type(screen.getByLabelText("API key"), "gsk_test_123");

    // Privacy indicator turns amber with the target base_url.
    await user.click(screen.getByRole("tab", { name: "Privacy" }));
    expect(
      screen.getByText(/audio is sent to https:\/\/api\.groq\.com\/openai\/v1/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/100% local/)).not.toBeInTheDocument();

    const saveButton = screen.getByRole("button", { name: "Save" });
    await user.click(saveButton);
    await waitFor(() => expect(saveButton).toBeDisabled());
    expect(localStorage.getItem("whispr-mock-settings")).toContain(
      "gsk_test_123",
    );

    first.unmount();

    // Fresh mount reads persisted cloud settings from the mock backend.
    render(<Settings />);
    await screen.findByLabelText("Hotkey");
    await user.click(screen.getByRole("tab", { name: "Transcription" }));
    expect(
      screen.getByRole("switch", { name: "Cloud transcription" }),
    ).toBeChecked();
    expect(screen.getByLabelText("API key")).toHaveValue("gsk_test_123");
  });

  it("persists history_enabled=false across remount and shows the hint", async () => {
    const user = userEvent.setup();
    const first = render(<Settings />);
    await screen.findByLabelText("Hotkey");

    await user.click(screen.getByRole("tab", { name: "Privacy" }));
    const historyToggle = screen.getByRole("switch", {
      name: "Save transcription history",
    });
    expect(historyToggle).toBeChecked();
    await user.click(historyToggle);
    expect(historyToggle).not.toBeChecked();
    expect(
      screen.getByText(/New transcriptions won't be kept/),
    ).toBeInTheDocument();

    const saveButton = screen.getByRole("button", { name: "Save" });
    await user.click(saveButton);
    await waitFor(() => expect(saveButton).toBeDisabled());
    expect(
      JSON.parse(localStorage.getItem("whispr-mock-settings") ?? "{}"),
    ).toMatchObject({ history_enabled: false });

    first.unmount();

    // Fresh mount reads the persisted flag from the mock backend.
    render(<Settings />);
    await screen.findByLabelText("Hotkey");
    await user.click(screen.getByRole("tab", { name: "Privacy" }));
    expect(
      screen.getByRole("switch", { name: "Save transcription history" }),
    ).not.toBeChecked();
  });

  it("persists license key and server URL across remount", async () => {
    const user = userEvent.setup();
    const first = render(<Settings />);
    await screen.findByLabelText("Hotkey");

    await user.click(screen.getByRole("tab", { name: "License" }));
    await user.type(screen.getByLabelText("License key"), "WHSPR-TEST-KEY");
    // The server URL field is prefilled with the baked-in default; replace it.
    await user.clear(screen.getByLabelText("License server URL"));
    await user.type(
      screen.getByLabelText("License server URL"),
      "https://license.example.com",
    );

    const saveButton = screen.getByRole("button", { name: "Save" });
    await user.click(saveButton);
    await waitFor(() => expect(saveButton).toBeDisabled());
    expect(
      JSON.parse(localStorage.getItem("whispr-mock-settings") ?? "{}"),
    ).toMatchObject({
      license: { key: "WHSPR-TEST-KEY", server_url: "https://license.example.com" },
    });

    first.unmount();

    // Fresh mount reads the persisted license settings from the mock backend.
    render(<Settings />);
    await screen.findByLabelText("Hotkey");
    await user.click(screen.getByRole("tab", { name: "License" }));
    expect(screen.getByLabelText("License key")).toHaveValue("WHSPR-TEST-KEY");
    expect(screen.getByLabelText("License server URL")).toHaveValue(
      "https://license.example.com",
    );
  });

  it("shows trial status on mount and Active after Check now with a key", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await screen.findByLabelText("Hotkey");

    await user.click(screen.getByRole("tab", { name: "License" }));
    expect(await screen.findByText("Trial — 5 days left")).toBeInTheDocument();

    // Enter and save a key, then force a check: the mock reports Active.
    await user.type(screen.getByLabelText("License key"), "WHSPR-TEST-KEY");
    const saveButton = screen.getByRole("button", { name: "Save" });
    await user.click(saveButton);
    await waitFor(() => expect(saveButton).toBeDisabled());

    await user.click(screen.getByRole("button", { name: "Check now" }));
    expect(
      await screen.findByText("Active until 2027-01-01"),
    ).toBeInTheDocument();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rolls back and surfaces the error when save fails, recovering on retry", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const hotkeyField = await screen.findByLabelText("Hotkey");
    fireEvent.keyDown(hotkeyField, { altKey: true, code: "Space" });
    expect(hotkeyField).toHaveValue("Alt+Space");

    // Make the mock backend's persistence throw.
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("disk full");
      });

    const saveButton = screen.getByRole("button", { name: "Save" });
    await user.click(saveButton);

    // Error is visible, nothing was persisted, and the form is still dirty.
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(saveButton).toBeEnabled();
    expect(localStorage.getItem("whispr-mock-settings")).toContain(
      "Ctrl+Shift+K",
    );

    // Retry with a working backend: error clears and the save sticks.
    setItem.mockRestore();
    await user.click(saveButton);
    await waitFor(() => expect(saveButton).toBeDisabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(localStorage.getItem("whispr-mock-settings")).toContain("Alt+Space");
  });
});
