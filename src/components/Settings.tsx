import { useEffect, useState } from "react";
import { ArrowLeft, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { HotkeyCapture } from "@/components/HotkeyCapture";
import { useSettings } from "@/hooks/useSettings";
import type {
  HotkeyMode,
  ModelDownloadProgress,
  ModelInfo,
  Settings as SettingsType,
} from "@/lib/types";
import {
  clearHistory,
  deleteModel,
  downloadModel,
  getDiskUsage,
  listInputDevices,
  listModels,
  onModelDownloadProgress,
} from "@/lib/tauri";
import { cn, formatBytes } from "@/lib/utils";

const DEFAULT_DEVICE = "__default__";

const CLOUD_PRESETS = [
  {
    value: "groq",
    label: "Groq",
    base_url: "https://api.groq.com/openai/v1",
    model: "whisper-large-v3-turbo",
  },
  {
    value: "openai",
    label: "OpenAI",
    base_url: "https://api.openai.com/v1",
    model: "whisper-1",
  },
] as const;

const LANGUAGES: { value: string; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "ru", label: "Русский" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "uk", label: "Українська" },
];

interface SettingsProps {
  onClose?: () => void;
}

export function Settings({ onClose }: SettingsProps) {
  const { settings, save } = useSettings();
  const [draft, setDraft] = useState<SettingsType | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (settings && draft === null) setDraft(settings);
  }, [settings, draft]);

  const dirty =
    settings !== null &&
    draft !== null &&
    JSON.stringify(draft) !== JSON.stringify(settings);

  const update = (patch: Partial<SettingsType>) => {
    setSaveError(null);
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const stored = await save(draft);
      setDraft(stored);
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        {onClose && (
          <Button variant="ghost" size="icon" aria-label="Back" onClick={onClose}>
            <ArrowLeft />
          </Button>
        )}
        <h1 className="text-base font-semibold">Settings</h1>
        <div className="ml-auto flex items-center gap-3">
          {saveError && (
            <span role="alert" className="text-xs text-destructive">
              {saveError}
            </span>
          )}
          {dirty && (
            <span className="text-xs text-amber-400">Unsaved changes</span>
          )}
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={!dirty || saving}
          >
            Save
          </Button>
        </div>
      </header>

      <Tabs defaultValue="general" className="flex flex-1 flex-col overflow-hidden p-4">
        <TabsList className="grid w-full shrink-0 grid-cols-4">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="transcription">Transcription</TabsTrigger>
          <TabsTrigger value="postproc">Post-processing</TabsTrigger>
          <TabsTrigger value="privacy">Privacy</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4 flex-1 space-y-5 overflow-y-auto">
          <GeneralTab draft={draft} update={update} />
        </TabsContent>

        <TabsContent
          value="transcription"
          className="mt-4 flex-1 space-y-5 overflow-y-auto"
        >
          <TranscriptionTab draft={draft} update={update} />
        </TabsContent>

        <TabsContent value="postproc" className="mt-4 flex-1 space-y-5 overflow-y-auto">
          <PostprocTab draft={draft} update={update} />
        </TabsContent>

        <TabsContent value="privacy" className="mt-4 flex-1 space-y-5 overflow-y-auto">
          <PrivacyTab draft={draft} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface TabProps {
  draft: SettingsType;
  update: (patch: Partial<SettingsType>) => void;
}

function GeneralTab({ draft, update }: TabProps) {
  const [devices, setDevices] = useState<string[]>([]);

  useEffect(() => {
    void listInputDevices()
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="hotkey">Hotkey</Label>
        <HotkeyCapture
          id="hotkey"
          value={draft.hotkey}
          onChange={(hotkey) => update({ hotkey })}
        />
        <p className="text-xs text-muted-foreground">
          Click the field, then press the new shortcut.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="hotkey-mode">Mode</Label>
        <Select
          value={draft.hotkey_mode}
          onValueChange={(v) => update({ hotkey_mode: v as HotkeyMode })}
        >
          <SelectTrigger id="hotkey-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="push_to_talk">Push to talk</SelectItem>
            <SelectItem value="toggle">Toggle</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="input-device">Input device</Label>
        <Select
          value={draft.input_device ?? DEFAULT_DEVICE}
          onValueChange={(v) =>
            update({ input_device: v === DEFAULT_DEVICE ? null : v })
          }
        >
          <SelectTrigger id="input-device">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_DEVICE}>System default</SelectItem>
            {devices.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="pill-enabled">Show recording pill</Label>
        <Switch
          id="pill-enabled"
          checked={draft.pill_enabled}
          onCheckedChange={(pill_enabled) => update({ pill_enabled })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="silence-timeout">Silence timeout (ms)</Label>
        <Input
          id="silence-timeout"
          type="number"
          min={100}
          max={10000}
          step={100}
          value={draft.silence_timeout_ms}
          onChange={(e) => {
            const n = Math.trunc(Number(e.target.value));
            if (Number.isFinite(n)) update({ silence_timeout_ms: n });
          }}
          onBlur={() => {
            const clamped = Math.min(
              10000,
              Math.max(100, draft.silence_timeout_ms),
            );
            if (clamped !== draft.silence_timeout_ms)
              update({ silence_timeout_ms: clamped });
          }}
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="vad-enabled">Voice activity detection</Label>
        <Switch
          id="vad-enabled"
          checked={draft.vad_enabled}
          onCheckedChange={(vad_enabled) => update({ vad_enabled })}
        />
      </div>
    </>
  );
}

function TranscriptionTab({ draft, update }: TabProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [progress, setProgress] = useState<Record<string, ModelDownloadProgress>>(
    {},
  );
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const updateCloud = (patch: Partial<SettingsType["cloud"]>) => {
    update({ cloud: { ...draft.cloud, ...patch } });
  };

  const cloudPreset =
    CLOUD_PRESETS.find((p) => p.base_url === draft.cloud.base_url)?.value ??
    "custom";

  const refresh = () => void listModels().then(setModels);

  useEffect(() => {
    refresh();
    return onModelDownloadProgress((p) => {
      setProgress((current) => ({ ...current, [p.id]: p }));
    });
  }, []);

  const handleDownload = async (id: string) => {
    setDownloadError(null);
    try {
      await downloadModel(id);
    } catch (err) {
      setDownloadError(String(err));
    } finally {
      setProgress((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      refresh();
    }
  };

  const handleDelete = async (id: string) => {
    await deleteModel(id);
    refresh();
  };

  return (
    <>
      <div className="space-y-2">
        <Label>Model</Label>
        <div className="space-y-2">
          {models.map((m) => {
            const p = progress[m.id];
            const active = draft.model === m.id;
            return (
              <div
                key={m.id}
                className={cn(
                  "rounded-md border px-3 py-2",
                  active && "border-primary/60 bg-primary/5",
                )}
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => update({ model: m.id })}
                    className="flex flex-1 items-center gap-2 text-left text-sm"
                    aria-label={`Use model ${m.id}`}
                  >
                    <span className="font-medium">{m.id}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatBytes(m.size_bytes)}
                    </span>
                    {active && (
                      <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        Active
                      </span>
                    )}
                  </button>
                  {m.downloaded ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${m.id}`}
                      onClick={() => void handleDelete(m.id)}
                    >
                      <Trash2 />
                    </Button>
                  ) : p ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Download ${m.id}`}
                      onClick={() => void handleDownload(m.id)}
                    >
                      <Download />
                      Download
                    </Button>
                  )}
                </div>
                {p && !m.downloaded && (
                  <Progress
                    className="mt-2"
                    value={(p.downloaded / p.total) * 100}
                  />
                )}
              </div>
            );
          })}
        </div>
        {downloadError && (
          <p role="alert" className="text-xs text-destructive">
            {downloadError}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="language">Language</Label>
        <Select
          value={draft.language}
          onValueChange={(language) => update({ language })}
        >
          <SelectTrigger id="language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          With a non-English language, English-only (.en) models automatically
          fall back to the multilingual variant.
        </p>
      </div>

      <div className="space-y-5 border-t pt-5">
        <div className="flex items-center justify-between">
          <Label htmlFor="cloud-enabled">Cloud transcription</Label>
          <Switch
            id="cloud-enabled"
            checked={draft.cloud.enabled}
            onCheckedChange={(enabled) => updateCloud({ enabled })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cloud-provider">Provider</Label>
          <Select
            value={cloudPreset}
            onValueChange={(v) => {
              const preset = CLOUD_PRESETS.find((p) => p.value === v);
              if (preset)
                updateCloud({ base_url: preset.base_url, model: preset.model });
            }}
          >
            <SelectTrigger id="cloud-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLOUD_PRESETS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="cloud-base-url">Base URL</Label>
          <Input
            id="cloud-base-url"
            value={draft.cloud.base_url}
            onChange={(e) => updateCloud({ base_url: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cloud-api-key">API key</Label>
          <Input
            id="cloud-api-key"
            type="password"
            aria-label="API key"
            value={draft.cloud.api_key}
            onChange={(e) => updateCloud({ api_key: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cloud-model">Model</Label>
          <Input
            id="cloud-model"
            value={draft.cloud.model}
            onChange={(e) => updateCloud({ model: e.target.value })}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="cloud-fallback">Fall back to local on failure</Label>
          <Switch
            id="cloud-fallback"
            checked={draft.cloud.fallback_to_local}
            onCheckedChange={(fallback_to_local) =>
              updateCloud({ fallback_to_local })
            }
          />
        </div>

        <p className="text-xs text-muted-foreground">
          The API key is stored in plain text in the local settings file. While
          cloud transcription is enabled, recorded audio is uploaded to the
          server above.
        </p>
      </div>
    </>
  );
}

function PostprocTab({ draft, update }: TabProps) {
  const updatePostproc = (patch: Partial<SettingsType["postproc"]>) => {
    update({ postproc: { ...draft.postproc, ...patch } });
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <Label htmlFor="postproc-enabled">Enable post-processing</Label>
        <Switch
          id="postproc-enabled"
          checked={draft.postproc.enabled}
          onCheckedChange={(enabled) => updatePostproc({ enabled })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ollama-url">Ollama URL</Label>
        <Input
          id="ollama-url"
          value={draft.postproc.ollama_url}
          onChange={(e) => updatePostproc({ ollama_url: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="postproc-model">Model</Label>
        <Input
          id="postproc-model"
          value={draft.postproc.model}
          onChange={(e) => updatePostproc({ model: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="postproc-prompt">Prompt</Label>
        <Textarea
          id="postproc-prompt"
          rows={4}
          value={draft.postproc.prompt}
          onChange={(e) => updatePostproc({ prompt: e.target.value })}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        If Ollama is unreachable or errors, the raw transcript is used silently —
        dictation never blocks on post-processing.
      </p>
    </>
  );
}

function PrivacyTab({ draft }: { draft: SettingsType }) {
  const [modelsBytes, setModelsBytes] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    void getDiskUsage().then((u) => setModelsBytes(u.models_bytes));
  }, []);

  return (
    <>
      {draft.cloud.enabled ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-500 dark:text-amber-400">
          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
          Cloud transcription on — audio is sent to {draft.cloud.base_url}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-emerald-600/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500 dark:text-emerald-400">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
          100% local — audio never leaves this device
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Models on disk:{" "}
        <span className="font-medium text-foreground">
          {modelsBytes === null ? "…" : formatBytes(modelsBytes)}
        </span>
      </p>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">Clear history</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear history?</DialogTitle>
            <DialogDescription>
              This permanently removes all stored transcriptions from this device.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void clearHistory();
                setConfirmOpen(false);
              }}
            >
              Clear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
