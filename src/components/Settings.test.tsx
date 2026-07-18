// THE SPEC INTEGRATION TEST: rebind hotkey + toggle post-processing in mock
// mode, save, remount fresh — both values must be persisted (localStorage
// backed mock, key "whispr-mock-settings").

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "./Settings";
import { DEFAULT_SETTINGS } from "@/lib/tauri";

describe("Settings (mock mode)", () => {
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

    // Privacy indicator turns amber with the target base_url (a .readout span).
    await user.click(screen.getByRole("tab", { name: "Privacy" }));
    expect(screen.getByText(/audio is sent to/)).toBeInTheDocument();
    expect(
      screen.getByText("https://api.groq.com/openai/v1"),
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

  it("shows the server verdict line after Check now, saving the typed key first", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await screen.findByLabelText("Hotkey");

    await user.click(screen.getByRole("tab", { name: "License" }));
    // Trial with no server contact yet: the verdict says so out loud.
    expect(await screen.findByText("Not verified yet")).toBeInTheDocument();

    // No separate Save — Check now must persist the draft key, then check it.
    await user.type(screen.getByLabelText("License key"), "WHSPR-TEST-KEY");
    await user.click(screen.getByRole("button", { name: "Check now" }));

    expect(
      await screen.findByText("Key active · 365 days left · until 2027-01-01"),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Checked \d{1,2}:\d{2}/)).toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem("whispr-mock-settings") ?? "{}"),
    ).toMatchObject({ license: { key: "WHSPR-TEST-KEY" } });
  });

  it("masks the license key behind an eye toggle", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await screen.findByLabelText("Hotkey");

    await user.click(screen.getByRole("tab", { name: "License" }));
    const key = screen.getByLabelText("License key");
    expect(key).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Show license key" }));
    expect(key).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "Hide license key" }));
    expect(key).toHaveAttribute("type", "password");
  });

  it("switches the interface language to Ukrainian and persists it", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await screen.findByLabelText("Hotkey");

    await user.click(screen.getByLabelText("Interface language"));
    await user.click(await screen.findByRole("option", { name: "Українська" }));

    // The screen previews the picked language right away, before Save.
    expect(await screen.findByLabelText("Гаряча клавіша")).toHaveValue(
      "Ctrl+Shift+K",
    );
    expect(screen.getByLabelText("Мова інтерфейсу")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Приватність" })).toBeInTheDocument();
    expect(screen.getByText("Незбережені зміни")).toBeInTheDocument();
    // The hint keeps interface and dictation languages apart.
    expect(
      screen.getByText(/а не мову, якою ви диктуєте/),
    ).toBeInTheDocument();

    const saveButton = screen.getByRole("button", { name: "Зберегти" });
    await user.click(saveButton);
    await waitFor(() => expect(saveButton).toBeDisabled());
    expect(
      JSON.parse(localStorage.getItem("whispr-mock-settings") ?? "{}"),
    ).toMatchObject({ ui_language: "uk" });

    // Machine data stays untranslated on the Transcription tab.
    await user.click(screen.getByRole("tab", { name: "Розпізнавання" }));
    expect(screen.getByLabelText("Базовий URL")).toHaveValue(
      "https://api.groq.com/openai/v1",
    );
    expect(screen.getByLabelText("Мова диктування")).toBeInTheDocument();
  });

  it("opens the Groq how-to from the info button and links to the console", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<Settings />);
    await screen.findByLabelText("Hotkey");

    await user.click(screen.getByRole("tab", { name: "Transcription" }));
    await user.click(
      screen.getByRole("button", { name: "How to get a Groq API key" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Get a free Groq API key"),
    ).toBeInTheDocument();

    const steps = within(dialog).getAllByRole("listitem");
    expect(steps).toHaveLength(4);
    expect(steps[0]).toHaveTextContent(
      "Open console.groq.com and sign in with Google or GitHub",
    );
    expect(steps[1]).toHaveTextContent("Go to API Keys and create a new key.");
    expect(steps[2]).toHaveTextContent("Copy the key — it is shown only once.");
    expect(steps[3]).toHaveTextContent(
      "Paste it into API key here and turn Cloud transcription on.",
    );
    expect(
      within(dialog).getByText(/recorded audio is uploaded to Groq/),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Open console.groq.com" }),
    );
    expect(open).toHaveBeenCalledWith("https://console.groq.com/keys", "_blank");
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
