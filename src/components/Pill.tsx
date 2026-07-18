import { useEffect } from "react";
import { useAppState } from "@/hooks/useAppState";
import { cn } from "@/lib/utils";

/** Floating status pill rendered in its own transparent window (#/pill). */
export function Pill() {
  const app = useAppState();

  useEffect(() => {
    document.documentElement.classList.add("pill-route");
    return () => document.documentElement.classList.remove("pill-route");
  }, []);

  const visible = app.state === "recording" || app.state === "transcribing";
  if (!visible) return null;

  const recording = app.state === "recording";

  return (
    <div className="flex h-full items-center justify-center bg-transparent">
      <div className="flex items-center gap-2 rounded-full bg-zinc-950/85 px-4 py-2 text-sm font-medium text-zinc-100 shadow-lg backdrop-blur">
        <span
          className={cn(
            "h-2.5 w-2.5 animate-pulse rounded-full",
            recording ? "bg-red-500" : "bg-amber-400",
          )}
        />
        {recording ? "Recording…" : "Transcribing…"}
      </div>
    </div>
  );
}
