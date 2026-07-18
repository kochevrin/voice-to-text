import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Onboarding } from "./Onboarding";
import { DEFAULT_SETTINGS } from "@/lib/tauri";

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
    const onComplete = vi.fn();
    render(<Onboarding settings={DEFAULT_SETTINGS} onComplete={onComplete} />);

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
    render(<Onboarding settings={DEFAULT_SETTINGS} onComplete={vi.fn()} />);

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
});
