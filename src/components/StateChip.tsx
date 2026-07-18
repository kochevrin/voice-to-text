import type { AppState, AppStateEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

const LABELS: Record<AppState, string> = {
  idle: "Idle",
  recording: "Recording…",
  transcribing: "Transcribing…",
  error: "Error",
};

export function StateChip({ state }: { state: AppStateEvent }) {
  const s = state.state;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        s === "idle" && "bg-muted text-muted-foreground",
        s === "recording" && "bg-red-500/15 text-red-400",
        s === "transcribing" && "bg-amber-500/15 text-amber-400",
        s === "error" && "bg-destructive/15 text-destructive",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          s === "idle" && "bg-muted-foreground/60",
          s === "recording" && "animate-pulse bg-red-500",
          s === "transcribing" && "animate-pulse bg-amber-400",
          s === "error" && "bg-destructive",
        )}
      />
      {s === "error" ? (state.message ?? "Error") : LABELS[s]}
    </span>
  );
}
