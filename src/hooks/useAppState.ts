import { useEffect, useState } from "react";
import type { AppStateEvent } from "@/lib/types";
import { onAppState } from "@/lib/tauri";

export function useAppState(): AppStateEvent {
  const [state, setState] = useState<AppStateEvent>({ state: "idle" });

  useEffect(() => onAppState(setState), []);

  return state;
}
