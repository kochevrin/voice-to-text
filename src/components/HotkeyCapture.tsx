import type { KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { displayHotkey, isMacPlatform, keyEventToCombo } from "@/lib/hotkey";
import { cn } from "@/lib/utils";

interface HotkeyCaptureProps {
  id?: string;
  value: string;
  onChange: (combo: string) => void;
  className?: string;
}

/** Read-only input that captures a key combo on keydown. */
export function HotkeyCapture({ id, value, onChange, className }: HotkeyCaptureProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const combo = keyEventToCombo(e);
    if (combo !== null) onChange(combo);
  };

  return (
    <Input
      id={id}
      readOnly
      value={displayHotkey(value, isMacPlatform())}
      placeholder="Press a shortcut…"
      onKeyDown={handleKeyDown}
      className={cn("cursor-pointer text-center font-medium", className)}
    />
  );
}
