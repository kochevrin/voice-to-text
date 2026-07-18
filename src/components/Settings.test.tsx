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
