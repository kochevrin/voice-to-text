import { useEffect, useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import logo from "@/assets/logo.png";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StateChip } from "@/components/StateChip";
import { TestRecorder } from "@/components/TestRecorder";
import { useAppState } from "@/hooks/useAppState";
import { useHistory } from "@/hooks/useHistory";
import { useSettings } from "@/hooks/useSettings";
import { displayHotkey, isMacPlatform } from "@/lib/hotkey";
import { useT } from "@/lib/i18n";
import type { TFunction } from "@/lib/i18n";
import type { HistoryEntry, LicenseStatus } from "@/lib/types";
import { copyText, getLicenseStatus, openUrl, setPaused } from "@/lib/tauri";
import { cn } from "@/lib/utils";

/** The author's profile rather than the repository — the repo may go private. */
const REPO_URL = "https://github.com/kochevrin/voice-to-text";

/** Quiet countdown for the header: the trial, or a subscription about to
 * lapse. Nothing when licensing is off or the key is comfortably active. */
function licenseCountdown(
  status: LicenseStatus | null,
  t: TFunction,
): string | null {
  if (status === null || status.state === "disabled") return null;
  if (status.state === "trial")
    return t("home.license.trial", { days: status.trial_days_left ?? 0 });
  if (status.days_left !== null && status.days_left <= 14)
    return t("home.license.subscription", { days: status.days_left });
  return null;
}

interface HomeProps {
  onOpenSettings: () => void;
}

export function Home({ onOpenSettings }: HomeProps) {
  const { settings, mutate } = useSettings();
  const app = useAppState();
  const t = useT();
  const { history } = useHistory();
  const [copiedTs, setCopiedTs] = useState<number | null>(null);
  const [license, setLicense] = useState<LicenseStatus | null>(null);

  useEffect(() => {
    void getLicenseStatus()
      .then(setLicense)
      .catch(() => setLicense(null));
  }, []);

  const countdown = licenseCountdown(license, t);

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
      {/* Status bar: identity on the left, machine state in the middle, the
          single control on the right. */}
      <header className="flex items-center gap-3 px-4 py-3">
        <img src={logo} alt="" className="h-5 w-5 shrink-0 rounded-full" />
        <h1 className="text-sm font-semibold tracking-tight">whispr-open</h1>
        <StateChip state={app} />
        {countdown && (
          <span className="readout text-[11px] tracking-[0.12em] text-muted-foreground">
            {countdown}
          </span>
        )}
        {settings?.paused && (
          <span className="readout text-[11px] uppercase tracking-[0.12em] text-warn">
            {t("home.paused.badge")}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("common.settings")}
          className="ml-auto shrink-0"
          onClick={onOpenSettings}
        >
          <SettingsIcon />
        </Button>
      </header>
      <div className="transmission" data-state={app.state} />

      <main className="flex-1 space-y-6 overflow-y-auto p-4">
        {settings && (
          <p className="text-sm text-muted-foreground">
            {t("home.hint.hold")}{" "}
            <kbd className="readout rounded border bg-muted px-1.5 py-0.5 text-xs text-foreground">
              {displayHotkey(settings.hotkey, isMacPlatform())}
            </kbd>
            {t("home.hint.rest")}
          </p>
        )}

        <div
          className={cn(
            "flex items-center justify-between gap-4 rounded-md border px-3 py-2.5",
            settings?.paused && "border-warn/40",
          )}
        >
          <div className="space-y-0.5">
            <Label htmlFor="pause-toggle" className="text-sm">
              {t("home.pause.label")}
            </Label>
            {settings?.paused && (
              <p className="text-xs text-warn">{t("home.pause.warning")}</p>
            )}
          </div>
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

        <section className="space-y-3">
          <h2 className="eyebrow">{t("home.test.title")}</h2>
          <TestRecorder />
        </section>

        <section className="space-y-3">
          <h2 className="eyebrow">{t("home.history.title")}</h2>
          {history.length === 0 ? (
            <div className="rounded-md border border-dashed px-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                {t("home.history.empty")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("home.history.emptyHint")}
              </p>
            </div>
          ) : (
            <ul className="divide-y rounded-md border">
              {history.map((entry) => (
                <li key={entry.ts_ms}>
                  <button
                    type="button"
                    onClick={() => void handleCopy(entry)}
                    title={t("common.copyHint")}
                    className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <span className="line-clamp-2 text-foreground/90">
                      {entry.text}
                    </span>
                    {copiedTs === entry.ts_ms ? (
                      <span className="readout shrink-0 text-xs text-foreground">
                        {t("common.copied")}
                      </span>
                    ) : (
                      <span className="readout shrink-0 text-xs text-muted-foreground">
                        {new Date(entry.ts_ms).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="px-4 pb-3 text-center text-xs text-muted-foreground/70">
        {t("home.footer.by")} Konstantin Kochevrin ·{" "}
        <button
          type="button"
          onClick={() => void openUrl(REPO_URL)}
          className="underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          GitHub
        </button>
      </footer>
    </div>
  );
}
