import { useState } from "react";
import { Mic, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StateChip } from "@/components/StateChip";
import { TestRecorder } from "@/components/TestRecorder";
import { useAppState } from "@/hooks/useAppState";
import { useHistory } from "@/hooks/useHistory";
import { useSettings } from "@/hooks/useSettings";
import { displayHotkey, isMacPlatform } from "@/lib/hotkey";
import type { HistoryEntry } from "@/lib/types";
import { copyText, setPaused } from "@/lib/tauri";

interface HomeProps {
  onOpenSettings: () => void;
}

export function Home({ onOpenSettings }: HomeProps) {
  const { settings, mutate } = useSettings();
  const app = useAppState();
  const { history } = useHistory();
  const [copiedTs, setCopiedTs] = useState<number | null>(null);

  const handleCopy = async (entry: HistoryEntry) => {
    await copyText(entry.text);
    setCopiedTs(entry.ts_ms);
    window.setTimeout(
      () => setCopiedTs((current) => (current === entry.ts_ms ? null : current)),
      1500,
    );
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <Mic className="h-4 w-4 text-primary" />
        <h1 className="text-base font-semibold">whispr-open</h1>
        <StateChip state={app} />
        <div className="ml-auto">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Settings"
            onClick={onOpenSettings}
          >
            <SettingsIcon />
          </Button>
        </div>
      </header>

      <main className="flex-1 space-y-4 overflow-y-auto p-4">
        {settings && (
          <p className="text-sm text-muted-foreground">
            Hold{" "}
            <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
              {displayHotkey(settings.hotkey, isMacPlatform())}
            </kbd>{" "}
            to dictate into any app.
          </p>
        )}

        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <Label htmlFor="pause-toggle" className="text-sm">
            Pause dictation
          </Label>
          <Switch
            id="pause-toggle"
            checked={settings?.paused ?? false}
            disabled={!settings}
            onCheckedChange={(paused) => {
              mutate({ paused });
              void setPaused(paused);
            }}
          />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Test dictation</CardTitle>
          </CardHeader>
          <CardContent>
            <TestRecorder />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">History</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transcriptions yet.</p>
            ) : (
              <ul className="space-y-1">
                {history.map((entry) => (
                  <li key={entry.ts_ms}>
                    <button
                      type="button"
                      onClick={() => void handleCopy(entry)}
                      title="Click to copy"
                      className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                    >
                      <span className="line-clamp-2 text-foreground/90">
                        {entry.text}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {copiedTs === entry.ts_ms ? (
                          <span className="font-medium text-primary">Copied</span>
                        ) : (
                          new Date(entry.ts_ms).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
