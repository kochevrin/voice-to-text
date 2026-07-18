import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Pill } from "./Pill";
import { startTestRecording, stopTestRecording } from "@/lib/tauri";

describe("Pill (mock mode)", () => {
  it("shows Recording…, then Transcribing…, then hides on idle", async () => {
    render(<Pill />);

    // Idle: nothing rendered.
    expect(screen.queryByText("Recording…")).not.toBeInTheDocument();
    expect(screen.queryByText("Transcribing…")).not.toBeInTheDocument();

    await act(async () => {
      await startTestRecording();
    });
    expect(screen.getByText("Recording…")).toBeInTheDocument();

    await act(async () => {
      await stopTestRecording();
    });
    expect(screen.getByText("Transcribing…")).toBeInTheDocument();
    expect(screen.queryByText("Recording…")).not.toBeInTheDocument();

    // The mock transcribes and returns to idle shortly after.
    await waitFor(
      () => expect(screen.queryByText("Transcribing…")).not.toBeInTheDocument(),
      { timeout: 3000 },
    );
  });
});
