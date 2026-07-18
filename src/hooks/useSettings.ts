import { useCallback, useEffect, useState } from "react";
import type { Settings } from "@/lib/types";
import { getSettings, setSettings } from "@/lib/tauri";

export function useSettings() {
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const loaded = await getSettings();
    setSettingsState(loaded);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Persist new settings; optimistic local update, then the stored value.
   * On backend failure the optimistic update is rolled back and the (string)
   * error is rethrown for the caller to surface. */
  const save = useCallback(
    async (next: Settings): Promise<Settings> => {
      const previous = settings;
      setSettingsState(next);
      try {
        const stored = await setSettings(next);
        setSettingsState(stored);
        return stored;
      } catch (err) {
        setSettingsState(previous);
        throw err;
      }
    },
    [settings],
  );

  /** Local-only patch (e.g. after a dedicated command like set_paused). */
  const mutate = useCallback((patch: Partial<Settings>) => {
    setSettingsState((current) => (current ? { ...current, ...patch } : current));
  }, []);

  return { settings, loading, save, mutate, refresh };
}
