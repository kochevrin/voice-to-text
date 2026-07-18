import { useCallback, useEffect, useState } from "react";
import type { HistoryEntry } from "@/lib/types";
import { clearHistory, getHistory, onTranscription } from "@/lib/tauri";

export function useHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const refresh = useCallback(async () => {
    setHistory(await getHistory());
  }, []);

  useEffect(() => {
    void refresh();
    return onTranscription(() => {
      void refresh();
    });
  }, [refresh]);

  const clear = useCallback(async () => {
    await clearHistory();
    setHistory([]);
  }, []);

  return { history, refresh, clear };
}
