// Playwright e2e against the Vite dev server in mock mode (VITE_MOCK_TAURI=1,
// configured in playwright.config.ts). Verifies the Settings rebind + toggle +
// save flow persists across a real page reload via the localStorage mock.

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Skip onboarding, but never clobber settings saved during the test.
    if (!localStorage.getItem("whispr-mock-settings")) {
      localStorage.setItem(
        "whispr-mock-settings",
        JSON.stringify({ onboarding_done: true }),
      );
    }
  });
});

test("hotkey rebind and post-processing toggle persist across reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();

  // Rebind the hotkey to Ctrl+Shift+P.
  const hotkeyField = page.getByLabel("Hotkey");
  await expect(hotkeyField).toHaveValue("Alt+Space");
  await hotkeyField.click();
  await hotkeyField.press("Control+Shift+KeyP");
  await expect(hotkeyField).toHaveValue("Ctrl+Shift+P");

  // Toggle post-processing.
  await page.getByRole("tab", { name: "Post-processing" }).click();
  const toggle = page.getByRole("switch", { name: "Enable post-processing" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  // Save; the button disables once the draft matches the stored settings.
  const saveButton = page.getByRole("button", { name: "Save" });
  await saveButton.click();
  await expect(saveButton).toBeDisabled();

  // Reload the page and verify both values survived.
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();

  await expect(page.getByLabel("Hotkey")).toHaveValue("Ctrl+Shift+P");
  await page.getByRole("tab", { name: "Post-processing" }).click();
  await expect(
    page.getByRole("switch", { name: "Enable post-processing" }),
  ).toHaveAttribute("aria-checked", "true");
});
