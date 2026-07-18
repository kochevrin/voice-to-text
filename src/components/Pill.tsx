import { useEffect } from "react";
import { useAppState } from "@/hooks/useAppState";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Floating status pill rendered in its own transparent window (#/pill).
 * Same language as StateChip — dot + mono readout — closed by the
 * transmission hairline that carries the current state. */
export function Pill() {
  const app = useAppState();
  const t = useT();

  useEffect(() => {
    document.documentElement.classList.add("pill-route");
    return () => document.documentElement.classList.remove("pill-route");
  }, []);

  const visible = app.state === "recording" || app.state === "transcribing";
  if (!visible) return null;

  const recording = app.state === "recording";

  return (
    <div className="flex h-full items-center justify-center bg-transparent p-2">
      <div className="overflow-hidden rounded-full border border-white/10 bg-zinc-950/85 shadow-md backdrop-blur">
        <div className="flex items-center gap-2 px-4 py-2">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              recording ? "bg-rec" : "bg-work",
            )}
          />
          <span className="readout text-[11px] uppercase tracking-[0.12em] text-zinc-100">
            {recording
              ? t("common.state.recording")
              : t("common.state.transcribing")}
          </span>
        </div>
        <div className="transmission" data-state={app.state} />
      </div>
    </div>
  );
}
