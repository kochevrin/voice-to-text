import { useEffect, useState } from "react";
import { Check, Download, ExternalLink } from "lucide-react";
import logo from "@/assets/logo.png";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HotkeyCapture } from "@/components/HotkeyCapture";
import { TestRecorder } from "@/components/TestRecorder";
import { useAppState } from "@/hooks/useAppState";
import { LANGS, useLang, useT } from "@/lib/i18n";
import type { Key, Lang } from "@/lib/i18n";
import type { ModelDownloadProgress, ModelInfo, Settings } from "@/lib/types";
import {
  downloadModel,
  listModels,
  onModelDownloadProgress,
  openPermissionSettings,
  setSettings,
} from "@/lib/tauri";
import { formatBytes } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface OnboardingProps {
  settings: Settings;
  onComplete: () => void;
}

const STEP_TITLE_KEYS: Key[] = [
  "onboarding.step.hotkey",
  "onboarding.step.permissions",
  "onboarding.step.model",
];
const TOTAL_STEPS = STEP_TITLE_KEYS.length;

/** OS names are product names — shown as-is in every language. */
type Platform = "macOS" | "Windows" | "Linux";

const PERMISSION_LINES: Record<Platform, Key[]> = {
  macOS: [
    "onboarding.permissions.macos.accessibility",
    "onboarding.permissions.macos.enable",
  ],
  Windows: [
    "onboarding.permissions.windows.none",
    "onboarding.permissions.windows.antivirus",
  ],
  Linux: [
    "onboarding.permissions.linux.x11",
    "onboarding.permissions.linux.wayland",
  ],
};

function platformName(): Platform {
  const ua = navigator.userAgent;
  if (/Mac/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  return "Linux";
}

export function Onboarding({ settings, onComplete }: OnboardingProps) {
  const app = useAppState();
  const t = useT();
  const [step, setStep] = useState(0);
  const [hotkey, setHotkey] = useState(settings.hotkey);
  const [model, setModel] = useState(settings.model);
  const [transcript, setTranscript] = useState("");
  const [skipped, setSkipped] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const lastStep = step === TOTAL_STEPS - 1;
  const canFinish = skipped || transcript.trim().length > 0;

  // Persist the choice immediately so the backend's active model matches
  // before the step-3 test runs (Finish still writes the final settings).
  const handleModelChange = (id: string) => {
    setModel(id);
    void setSettings({ ...settings, model: id });
  };

  const handleFinish = async () => {
    setFinishing(true);
    try {
      await setSettings({ ...settings, hotkey, model, onboarding_done: true });
      onComplete();
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <header>
        <div className="mx-auto w-full max-w-md px-6 pb-4 pt-5">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="" className="h-5 w-5 shrink-0 rounded-full" />
            <h1 className="min-w-0 truncate text-sm font-semibold tracking-tight">
              {t("onboarding.title")}
            </h1>
            <span className="eyebrow ml-auto shrink-0">
              {t("onboarding.step", { current: step + 1, total: TOTAL_STEPS })}
            </span>
            <LanguageSwitch settings={settings} />
          </div>

          <div
            className="mt-3 flex gap-1"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={TOTAL_STEPS}
            aria-valuenow={step + 1}
            aria-label={t("onboarding.progress", {
              current: step + 1,
              total: TOTAL_STEPS,
              title: t(STEP_TITLE_KEYS[step]),
            })}
          >
            {STEP_TITLE_KEYS.map((key, i) => (
              <span
                key={key}
                className={cn(
                  "h-0.5 flex-1 rounded-full",
                  i === step && "bg-primary",
                  i < step && "bg-foreground/25",
                  i > step && "bg-border",
                )}
              />
            ))}
          </div>
        </div>
        <div className="transmission" data-state={app.state} />
      </header>

      <main className="min-h-0 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
        <div className="mx-auto w-full max-w-md px-6 py-4">
          {step === 0 && (
            <HotkeyStep value={hotkey} onChange={setHotkey} />
          )}

          {step === 1 && <PermissionsStep />}

          {step === 2 && (
            <ModelStep
              model={model}
              onModelChange={handleModelChange}
              onTranscript={setTranscript}
              skipped={skipped}
              onSkip={() => setSkipped(true)}
            />
          )}
        </div>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-4 px-6 py-4">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              {t("onboarding.back")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            {lastStep && !canFinish && (
              <p className="text-xs text-muted-foreground">
                {t("onboarding.finishHint")}
              </p>
            )}
            {lastStep ? (
              <Button
                onClick={() => void handleFinish()}
                disabled={!canFinish || finishing}
              >
                {t("onboarding.finish")}
              </Button>
            ) : (
              <Button
                onClick={() => setStep(step + 1)}
                disabled={hotkey.length === 0}
              >
                {t("onboarding.next")}
              </Button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}

interface LanguageSwitchProps {
  settings: Settings;
}

/** Compact EN/UK control so the wizard is readable from the very first screen.
 * Writes through the same immediate-persist path as the model select; the app
 * shell re-reads the settings and re-renders the wizard translated in place. */
function LanguageSwitch({ settings }: LanguageSwitchProps) {
  const t = useT();
  const lang = useLang();

  const choose = (next: Lang) => {
    if (next === lang) return;
    void setSettings({ ...settings, ui_language: next });
  };

  return (
    <div
      role="group"
      aria-label={t("onboarding.lang.label")}
      title={t("onboarding.lang.hint")}
      className="flex shrink-0 items-center gap-0.5 rounded-full border p-0.5"
    >
      {LANGS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === lang}
          onClick={() => choose(option.value)}
          className={cn(
            "readout rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            option.value === lang
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.value.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

interface StepHeadingProps {
  title: string;
  purpose: string;
}

function StepHeading({ title, purpose }: StepHeadingProps) {
  return (
    <div className="space-y-1">
      <h2 className="text-base font-medium tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{purpose}</p>
    </div>
  );
}

interface HotkeyStepProps {
  value: string;
  onChange: (combo: string) => void;
}

function HotkeyStep({ value, onChange }: HotkeyStepProps) {
  const t = useT();
  return (
    <section className="space-y-4">
      <StepHeading
        title={t("onboarding.hotkey.title")}
        purpose={t("onboarding.hotkey.purpose")}
      />
      <div className="space-y-1.5">
        <Label htmlFor="onboarding-hotkey" className="eyebrow">
          {t("onboarding.hotkey.label")}
        </Label>
        <HotkeyCapture
          id="onboarding-hotkey"
          value={value}
          onChange={onChange}
          className="readout"
        />
        <p className="text-xs text-muted-foreground">
          {t("onboarding.hotkey.hint")}
        </p>
      </div>
    </section>
  );
}

function PermissionsStep() {
  const t = useT();
  const os = platformName();
  return (
    <section className="space-y-4">
      <StepHeading
        title={t("onboarding.permissions.title", { os })}
        purpose={t("onboarding.permissions.purpose")}
      />
      <ul className="divide-y border-y">
        {PERMISSION_LINES[os].map((key) => (
          <li key={key} className="py-2.5 text-sm text-muted-foreground">
            {t(key)}
          </li>
        ))}
      </ul>
      {os !== "Linux" && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void openPermissionSettings()}
        >
          <ExternalLink />
          {t("onboarding.permissions.open")}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        {t("onboarding.permissions.privacy")}
      </p>
    </section>
  );
}

interface ModelStepProps {
  model: string;
  onModelChange: (id: string) => void;
  onTranscript: (text: string) => void;
  skipped: boolean;
  onSkip: () => void;
}

function ModelStep({ model, onModelChange, onTranscript, skipped, onSkip }: ModelStepProps) {
  const t = useT();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const refresh = () => void listModels().then(setModels);

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (downloadingId === null) return;
    return onModelDownloadProgress((p) => {
      if (p.id === downloadingId) setProgress(p);
    });
  }, [downloadingId]);

  const selected = models.find((m) => m.id === model);
  const downloaded = selected?.downloaded ?? false;
  const percent =
    progress === null || progress.total === 0
      ? 0
      : Math.round((progress.downloaded / progress.total) * 100);

  const handleDownload = async () => {
    const id = model;
    setDownloadingId(id);
    setDownloadError(null);
    try {
      await downloadModel(id);
    } catch (err) {
      setDownloadError(String(err));
    } finally {
      setDownloadingId(null);
      setProgress(null);
      refresh();
    }
  };

  return (
    <section className="space-y-4">
      <StepHeading
        title={t("onboarding.model.title")}
        purpose={t("onboarding.model.purpose")}
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="onboarding-model" className="eyebrow">
            {t("onboarding.model.label")}
          </Label>
          {downloaded && (
            <span className="eyebrow flex items-center gap-1.5 text-ok">
              <Check className="size-3" />
              {t("onboarding.model.onDevice")}
            </span>
          )}
        </div>

        <Select value={model} onValueChange={onModelChange}>
          <SelectTrigger id="onboarding-model" className="readout">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id} className="readout">
                {m.id} · {formatBytes(m.size_bytes)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!downloaded && (
          <div className="flex h-8 items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleDownload()}
              disabled={downloadingId !== null}
            >
              <Download />
              {downloadingId === null
                ? t("onboarding.model.download")
                : t("onboarding.model.downloading")}
            </Button>
            {downloadingId !== null && progress ? (
              <>
                <Progress value={percent} className="h-1 flex-1" />
                <span className="readout w-10 shrink-0 text-right text-xs text-muted-foreground">
                  {percent}%
                </span>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("onboarding.model.downloadHint")}
              </p>
            )}
          </div>
        )}
      </div>

      {downloadError && (
        <p role="alert" className="text-xs text-destructive">
          {t("onboarding.model.downloadError", { error: downloadError })}
        </p>
      )}

      <div className="space-y-2 border-t pt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="eyebrow">{t("onboarding.test.label")}</span>
          {!skipped && (
            <Button
              variant="link"
              size="sm"
              className="h-auto shrink-0 px-0 text-xs text-muted-foreground hover:text-foreground"
              onClick={onSkip}
            >
              {t("onboarding.test.skip")}
            </Button>
          )}
        </div>
        <TestRecorder onTranscript={onTranscript} disabled={!downloaded} />
      </div>
    </section>
  );
}
