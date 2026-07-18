import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Onboarding } from "./Onboarding";
import { DEFAULT_SETTINGS } from "@/lib/tauri";

describe("Onboarding (mock mode)", () => {
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

    // Step 2: permissions -> Next.
    expect(
      screen.getByRole("button", { name: /Open system settings/ }),
    ).toBeInTheDocument();
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
});
