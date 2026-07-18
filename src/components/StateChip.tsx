import { useT } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import type { AppState, AppStateEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

const LABEL_KEYS: Record<AppState, Key> = {
  idle: "common.state.idle",
  recording: "common.state.recording",
  transcribing: "common.state.transcribing",
  error: "common.state.error",
};

// State colours only — never the brand accent. The transmission hairline
// carries the motion, so the dot itself stays still.
const TONE: Record<AppState, { dot: string; text: string }> = {
  idle: { dot: "bg-muted-foreground/50", text: "text-muted-foreground" },
  recording: { dot: "bg-rec", text: "text-rec" },
  transcribing: { dot: "bg-work", text: "text-work" },
  error: { dot: "bg-destructive", text: "text-destructive" },
};

interface StateChipProps {
  state: AppStateEvent;
  className?: string;
}

/** Dot + mono readout. Shares its visual language with the floating pill. */
export function StateChip({ state, className }: StateChipProps) {
  const t = useT();
  const s = state.state;
  const tone = TONE[s];
  return (
    <span
      className={cn(
        "readout inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em]",
        tone.text,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} />
      {/* Backend error messages arrive already-worded; they pass through. */}
      {s === "error" ? (state.message ?? t(LABEL_KEYS.error)) : t(LABEL_KEYS[s])}
    </span>
  );
}
