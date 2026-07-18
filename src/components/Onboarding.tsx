import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Mic } from "lucide-react";
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

const TOTAL_STEPS = 3;

interface PlatformCopy {
  name: string;
  lines: string[];
}

function platformCopy(): PlatformCopy {
  const ua = navigator.userAgent;
  if (/Mac/.test(ua)) {
    return {
      name: "macOS",
      lines: [
        "whispr-open types text into the focused app, which requires the Accessibility permission.",
        "Open System Settings → Privacy & Security → Accessibility and enable whispr-open.",
      ],
    };
  }
  if (/Windows/.test(ua)) {
    return {
      name: "Windows",
      lines: [
        "No special permission is required to type text into other apps.",
        "If your antivirus flags simulated keystrokes, allow whispr-open.",
      ],
    };
  }
  return {
    name: "Linux",
    lines: [
      "On X11 no special permission is required.",
      "On Wayland, keystroke injection may be restricted; clipboard paste is used as a fallback.",
    ],
  };
}

export function Onboarding({ settings, onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [hotkey, setHotkey] = useState(settings.hotkey);
  const [model, setModel] = useState(settings.model);
  const [transcript, setTranscript] = useState("");
  const [skipped, setSkipped] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const canFinish = skipped || transcript.trim().length > 0;

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
    <div className="mx-auto flex h-full w-full max-w-md flex-col p-6">
      <div className="mb-6 flex items-center gap-3">
        <Mic className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">Welcome to whispr-open</h1>
      </div>

      <div
        className="mb-6 flex gap-1.5"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={TOTAL_STEPS}
        aria-valuenow={step + 1}
        aria-label={`Step ${step + 1} of ${TOTAL_STEPS}`}
      >
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 w-8 rounded-full",
              i <= step ? "bg-primary" : "bg-muted",
            )}
          />
        ))}
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto">
        {step === 0 && (
          <>
            <h2 className="text-base font-medium">Choose your dictation hotkey</h2>
            <p className="text-sm text-muted-foreground">
              Hold it to dictate, release to insert the text. Click the field and
              press a combination.
            </p>
            <div className="space-y-2">
              <Label htmlFor="onboarding-hotkey">Hotkey</Label>
              <HotkeyCapture
                id="onboarding-hotkey"
                value={hotkey}
                onChange={setHotkey}
              />
            </div>
          </>
        )}

        {step === 1 && <PermissionsStep />}

        {step === 2 && (
          <ModelStep
            model={model}
            onModelChange={setModel}
            onTranscript={setTranscript}
            skipped={skipped}
            onSkip={() => setSkipped(true)}
          />
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        {step > 0 ? (
          <Button variant="ghost" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        ) : (
          <span />
        )}
        {step < TOTAL_STEPS - 1 ? (
          <Button onClick={() => setStep(step + 1)} disabled={hotkey.length === 0}>
            Next
          </Button>
        ) : (
          <Button
            onClick={() => void handleFinish()}
            disabled={!canFinish || finishing}
          >
            Finish
          </Button>
        )}
      </div>
    </div>
  );
}

function PermissionsStep() {
  const copy = platformCopy();
  return (
    <>
      <h2 className="text-base font-medium">Permissions ({copy.name})</h2>
      <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        {copy.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <Button variant="outline" onClick={() => void openPermissionSettings()}>
        <ExternalLink />
        Open system settings
      </Button>
      <p className="text-sm text-muted-foreground">
        The microphone is only used while your hotkey is held. Audio never leaves
        this device.
      </p>
    </>
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
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const modelRef = useRef(model);
  modelRef.current = model;

  const refresh = () => void listModels().then(setModels);

  useEffect(() => {
    refresh();
    return onModelDownloadProgress((p) => {
      if (p.id === modelRef.current) setProgress(p);
    });
  }, []);

  const selected = models.find((m) => m.id === model);
  const downloaded = selected?.downloaded ?? false;

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadModel(model);
    } catch (err) {
      setDownloadError(String(err));
    } finally {
      setDownloading(false);
      setProgress(null);
      refresh();
    }
  };

  return (
    <>
      <h2 className="text-base font-medium">Pick a model and test it</h2>
      <div className="space-y-2">
        <Label htmlFor="onboarding-model">Model</Label>
        <Select value={model} onValueChange={onModelChange}>
          <SelectTrigger id="onboarding-model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.id} ({formatBytes(m.size_bytes)})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!downloaded && (
        <div className="space-y-2">
          <Button
            variant="outline"
            onClick={() => void handleDownload()}
            disabled={downloading}
          >
            <Download />
            {downloading ? "Downloading…" : `Download ${model}`}
          </Button>
          {downloading && progress && (
            <Progress value={(progress.downloaded / progress.total) * 100} />
          )}
          {downloadError && (
            <p role="alert" className="text-xs text-destructive">
              {downloadError}
            </p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Try a quick dictation test. Speak, then stop — the transcript appears
          below.
        </p>
        <TestRecorder onTranscript={onTranscript} disabled={!downloaded} />
        {!skipped && (
          <Button variant="link" size="sm" className="px-0" onClick={onSkip}>
            Skip test
          </Button>
        )}
      </div>
    </>
  );
}
