import { useEffect, useState } from "react";
import { ArrowLeft, Download, Eye, EyeOff, Info, Trash2 } from "lucide-react";
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
import { I18nProvider, LANGS, useT } from "@/lib/i18n";
import type { Lang, TFunction } from "@/lib/i18n";
import type {
  HotkeyMode,
  LicenseStatus,
  ModelDownloadProgress,
  ModelInfo,
  Settings as SettingsType,
  UpdateStatus,
} from "@/lib/types";
import {
  checkLicenseNow,
  checkUpdates,
  clearHistory,
  deleteModel,
  downloadModel,
  getDiskUsage,
  getLicenseStatus,
  listInputDevices,
  listModels,
  onModelDownloadProgress,
  openUrl,
} from "@/lib/tauri";
import { cn, formatBytes } from "@/lib/utils";

const DEFAULT_DEVICE = "__default__";

const GROQ_CONSOLE_URL = "https://console.groq.com/keys";

const TELEGRAM_BOT_URL = "https://t.me/whispr_license_bot?start=subscribe";

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

/** Dictation languages. Each name stays in its own language — never
 * translated; "auto" is the one entry that is real UI copy. */
const DICTATION_LANGUAGES: { value: string; label: string }[] = [
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

interface SecretInputProps {
  id: string;
  /** Accessible name of the field itself, e.g. "License key". */
  label: string;
  /** Accessible names of the reveal button in both of its states. */
  showLabel: string;
  hideLabel: string;
  value: string;
  onChange: (value: string) => void;
}

/** Masked credential field with an eye toggle. Secrets are never shown by
 * default — someone is usually looking over a dictating user's shoulder. */
function SecretInput({
  id,
  label,
  showLabel,
  hideLabel,
  value,
  onChange,
}: SecretInputProps) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        aria-label={label}
        type={shown ? "text" : "password"}
        className="readout pr-10"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        aria-label={shown ? hideLabel : showLabel}
        onClick={() => setShown((current) => !current)}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {shown ? (
          <EyeOff className="size-4" />
        ) : (
          <Eye className="size-4" />
        )}
      </button>
    </div>
  );
}

export function Settings({ onClose }: SettingsProps) {
  const { settings, save } = useSettings();
  const t = useT();

  if (!settings) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  return <SettingsEditor stored={settings} save={save} onClose={onClose} />;
}

interface SettingsEditorProps extends SettingsProps {
  stored: SettingsType;
  save: (next: SettingsType) => Promise<SettingsType>;
}

function SettingsEditor({ stored, save, onClose }: SettingsEditorProps) {
  const [draft, setDraft] = useState<SettingsType>(stored);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);

  const update = (patch: Partial<SettingsType>) => {
    setSaveError(null);
    setDraft((current) => ({ ...current, ...patch }));
  };

  /** Persist the current draft, rethrowing so callers can surface failures. */
  const persistDraft = async () => {
    setDraft(await save(draft));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await persistDraft();
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  };

  // The screen speaks the language being picked, before Save — the language
  // select is its own preview. Once saved, the app shell follows suit.
  return (
    <I18nProvider lang={draft.ui_language}>
      <SettingsScreen
        draft={draft}
        update={update}
        persist={persistDraft}
        dirty={dirty}
        saving={saving}
        saveError={saveError}
        onSave={() => void handleSave()}
        onClose={onClose}
      />
    </I18nProvider>
  );
}

interface TabProps {
  draft: SettingsType;
  update: (patch: Partial<SettingsType>) => void;
}

interface SettingsScreenProps extends TabProps, SettingsProps {
  persist: () => Promise<void>;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
}

function SettingsScreen({
  draft,
  update,
  persist,
  dirty,
  saving,
  saveError,
  onSave,
  onClose,
}: SettingsScreenProps) {
  const t = useT();

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 px-4 py-3">
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("settings.back")}
            onClick={onClose}
          >
            <ArrowLeft />
          </Button>
        )}
        <h1 className="text-sm font-semibold tracking-tight">
          {t("common.settings")}
        </h1>
        <div className="ml-auto flex items-center gap-3">
          {saveError && (
            <span role="alert" className="text-xs text-destructive">
              {saveError}
            </span>
          )}
          {dirty && (
            <span className="readout text-[11px] uppercase tracking-[0.12em] text-warn">
              {t("settings.unsaved")}
            </span>
          )}
          <Button size="sm" onClick={onSave} disabled={!dirty || saving}>
            {t("settings.save")}
          </Button>
        </div>
      </header>
      <div className="transmission" />

      <Tabs
        defaultValue="general"
        className="flex flex-1 flex-col overflow-hidden px-4 pb-4"
      >
        <TabsList className="w-full shrink-0">
          <TabsTrigger value="general">{t("settings.tab.general")}</TabsTrigger>
          <TabsTrigger value="transcription">
            {t("settings.tab.transcription")}
          </TabsTrigger>
          <TabsTrigger value="postproc">{t("settings.tab.postproc")}</TabsTrigger>
          <TabsTrigger value="privacy">{t("settings.tab.privacy")}</TabsTrigger>
          <TabsTrigger value="license">{t("settings.tab.license")}</TabsTrigger>
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
          <PrivacyTab draft={draft} update={update} />
        </TabsContent>

        <TabsContent value="license" className="mt-4 flex-1 space-y-5 overflow-y-auto">
          <LicenseTab draft={draft} update={update} persist={persist} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function GeneralTab({ draft, update }: TabProps) {
  const t = useT();
  const [devices, setDevices] = useState<string[]>([]);

  useEffect(() => {
    void listInputDevices()
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="hotkey">{t("settings.general.hotkey")}</Label>
        <HotkeyCapture
          id="hotkey"
          value={draft.hotkey}
          onChange={(hotkey) => update({ hotkey })}
        />
        <p className="text-xs text-muted-foreground">
          {t("settings.general.hotkeyHint")}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="hotkey-mode">{t("settings.general.mode")}</Label>
        <Select
          value={draft.hotkey_mode}
          onValueChange={(v) => update({ hotkey_mode: v as HotkeyMode })}
        >
          <SelectTrigger id="hotkey-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="push_to_talk">
              {t("settings.general.mode.push")}
            </SelectItem>
            <SelectItem value="toggle">
              {t("settings.general.mode.toggle")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ui-language">{t("settings.general.uiLanguage")}</Label>
        <Select
          value={draft.ui_language}
          onValueChange={(v) => update({ ui_language: v as Lang })}
        >
          <SelectTrigger id="ui-language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGS.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t("settings.general.uiLanguageHint")}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="input-device">{t("settings.general.device")}</Label>
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
            <SelectItem value={DEFAULT_DEVICE}>
              {t("settings.general.device.default")}
            </SelectItem>
            {devices.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="pill-enabled">{t("settings.general.pill")}</Label>
        <Switch
          id="pill-enabled"
          checked={draft.pill_enabled}
          onCheckedChange={(pill_enabled) => update({ pill_enabled })}
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="autostart">{t("settings.general.autostart")}</Label>
        <Switch
          id="autostart"
          checked={draft.autostart}
          onCheckedChange={(autostart) => update({ autostart })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="silence-timeout">{t("settings.general.silence")}</Label>
        <Input
          id="silence-timeout"
          className="readout"
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
        <Label htmlFor="vad-enabled">{t("settings.general.vad")}</Label>
        <Switch
          id="vad-enabled"
          checked={draft.vad_enabled}
          onCheckedChange={(vad_enabled) => update({ vad_enabled })}
        />
      </div>

      <UpdatesSection />
    </>
  );
}

/** Manual update check — level 1: compare against the latest GitHub release
 * and hand off to the browser for the actual download. */
function UpdatesSection() {
  const t = useT();
  const [result, setResult] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const handleCheck = async () => {
    setChecking(true);
    setError(null);
    try {
      setResult(await checkUpdates());
    } catch (err) {
      setResult(null);
      setError(String(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="space-y-3 border-t pt-5">
      <h2 className="eyebrow">{t("settings.updates.title")}</h2>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={checking}
          onClick={() => void handleCheck()}
        >
          {checking ? t("settings.updates.checking") : t("settings.updates.check")}
        </Button>
        {result?.update_available && (
          <Button size="sm" onClick={() => void openUrl(result.url)}>
            {t("settings.updates.download")}
          </Button>
        )}
      </div>
      {result && (
        <p
          className={cn(
            "readout text-xs",
            result.update_available ? "text-warn" : "text-ok",
          )}
        >
          {result.update_available
            ? t("settings.updates.available", { version: result.latest ?? "" })
            : t("settings.updates.upToDate", { version: result.current })}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {t("settings.updates.error", { error })}
        </p>
      )}
    </section>
  );
}

/** The one thing standing between a new user and working cloud dictation is a
 * Groq key, so the steps live right next to the provider select. */
function GroqHelpDialog() {
  const t = useT();

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("settings.groq.help")}>
          <Info />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings.groq.title")}</DialogTitle>
        </DialogHeader>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>{t("settings.groq.step1")}</li>
          <li>{t("settings.groq.step2")}</li>
          <li>{t("settings.groq.step3")}</li>
          <li>{t("settings.groq.step4")}</li>
        </ol>
        <DialogDescription className="text-xs">
          {t("settings.groq.note")}
        </DialogDescription>
        <DialogFooter>
          <Button onClick={() => void openUrl(GROQ_CONSOLE_URL)}>
            {t("settings.groq.open")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TranscriptionTab({ draft, update }: TabProps) {
  const t = useT();
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
      <section className="space-y-3">
        <h2 className="eyebrow">{t("settings.transcription.localModel")}</h2>
        <div className="space-y-2">
          {models.map((m) => {
            const p = progress[m.id];
            const active = draft.model === m.id;
            return (
              <div
                key={m.id}
                className={cn(
                  "rounded-md border px-3 py-2",
                  active && "border-ok/40",
                )}
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => update({ model: m.id })}
                    className="flex flex-1 items-center gap-2 text-left text-sm"
                    aria-label={t("settings.transcription.useModel", { id: m.id })}
                  >
                    <span className="readout font-medium">{m.id}</span>
                    <span className="readout text-xs text-muted-foreground">
                      {formatBytes(m.size_bytes)}
                    </span>
                    {active && (
                      <span className="readout text-[10px] uppercase tracking-[0.12em] text-ok">
                        {t("settings.transcription.active")}
                      </span>
                    )}
                  </button>
                  {m.downloaded ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("settings.transcription.deleteModel", {
                        id: m.id,
                      })}
                      onClick={() => void handleDelete(m.id)}
                    >
                      <Trash2 />
                    </Button>
                  ) : p ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={t("settings.transcription.downloadModel", {
                        id: m.id,
                      })}
                      onClick={() => void handleDownload(m.id)}
                    >
                      <Download />
                      {t("settings.transcription.download")}
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
      </section>

      <div className="space-y-2">
        <Label htmlFor="language">{t("settings.transcription.language")}</Label>
        <Select
          value={draft.language}
          onValueChange={(language) => update({ language })}
        >
          <SelectTrigger id="language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">
              {t("settings.transcription.language.auto")}
            </SelectItem>
            {DICTATION_LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t("settings.transcription.languageHint")}
        </p>
      </div>

      <section className="space-y-5 border-t pt-5">
        <h2 className="eyebrow">{t("settings.transcription.cloud")}</h2>

        <div className="flex items-center justify-between">
          <Label htmlFor="cloud-enabled">
            {t("settings.transcription.cloudEnabled")}
          </Label>
          <Switch
            id="cloud-enabled"
            checked={draft.cloud.enabled}
            onCheckedChange={(enabled) => updateCloud({ enabled })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cloud-provider">
            {t("settings.transcription.provider")}
          </Label>
          <div className="flex items-center gap-1">
            <Select
              value={cloudPreset}
              onValueChange={(v) => {
                const preset = CLOUD_PRESETS.find((p) => p.value === v);
                if (preset)
                  updateCloud({ base_url: preset.base_url, model: preset.model });
              }}
            >
              <SelectTrigger id="cloud-provider" className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLOUD_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
                <SelectItem value="custom">
                  {t("settings.transcription.provider.custom")}
                </SelectItem>
              </SelectContent>
            </Select>
            <GroqHelpDialog />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="cloud-base-url">
            {t("settings.transcription.baseUrl")}
          </Label>
          <Input
            id="cloud-base-url"
            className="readout"
            value={draft.cloud.base_url}
            onChange={(e) => updateCloud({ base_url: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cloud-api-key">
            {t("settings.transcription.apiKey")}
          </Label>
          <SecretInput
            id="cloud-api-key"
            label={t("settings.transcription.apiKey")}
            showLabel={t("settings.transcription.showApiKey")}
            hideLabel={t("settings.transcription.hideApiKey")}
            value={draft.cloud.api_key}
            onChange={(api_key) => updateCloud({ api_key })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cloud-model">{t("settings.transcription.model")}</Label>
          <Input
            id="cloud-model"
            className="readout"
            value={draft.cloud.model}
            onChange={(e) => updateCloud({ model: e.target.value })}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="cloud-fallback">
            {t("settings.transcription.fallback")}
          </Label>
          <Switch
            id="cloud-fallback"
            checked={draft.cloud.fallback_to_local}
            onCheckedChange={(fallback_to_local) =>
              updateCloud({ fallback_to_local })
            }
          />
        </div>

        <p className="text-xs text-muted-foreground">
          {t("settings.transcription.cloudNote")}
        </p>
      </section>
    </>
  );
}

function PostprocTab({ draft, update }: TabProps) {
  const t = useT();

  const updatePostproc = (patch: Partial<SettingsType["postproc"]>) => {
    update({ postproc: { ...draft.postproc, ...patch } });
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <Label htmlFor="postproc-enabled">{t("settings.postproc.enabled")}</Label>
        <Switch
          id="postproc-enabled"
          checked={draft.postproc.enabled}
          onCheckedChange={(enabled) => updatePostproc({ enabled })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ollama-url">{t("settings.postproc.ollamaUrl")}</Label>
        <Input
          id="ollama-url"
          className="readout"
          value={draft.postproc.ollama_url}
          onChange={(e) => updatePostproc({ ollama_url: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="postproc-model">{t("settings.postproc.model")}</Label>
        <Input
          id="postproc-model"
          className="readout"
          value={draft.postproc.model}
          onChange={(e) => updatePostproc({ model: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="postproc-prompt">{t("settings.postproc.prompt")}</Label>
        <Textarea
          id="postproc-prompt"
          rows={4}
          value={draft.postproc.prompt}
          onChange={(e) => updatePostproc({ prompt: e.target.value })}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {t("settings.postproc.note")}
      </p>
    </>
  );
}

function PrivacyTab({ draft, update }: TabProps) {
  const t = useT();
  const [modelsBytes, setModelsBytes] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    void getDiskUsage().then((u) => setModelsBytes(u.models_bytes));
  }, []);

  return (
    <>
      {draft.cloud.enabled ? (
        <div className="flex items-start gap-2 rounded-md border border-warn/40 px-3 py-2.5 text-sm text-warn">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
          <p>
            {t("settings.privacy.cloudOn")}{" "}
            <span className="readout break-all">{draft.cloud.base_url}</span>
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-md border border-ok/40 px-3 py-2.5 text-sm text-ok">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
          <p>{t("settings.privacy.local")}</p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <Label htmlFor="history-enabled">{t("settings.privacy.history")}</Label>
        <Switch
          id="history-enabled"
          checked={draft.history_enabled}
          onCheckedChange={(history_enabled) => update({ history_enabled })}
        />
      </div>
      {!draft.history_enabled && (
        <p className="text-xs text-muted-foreground">
          {t("settings.privacy.historyOff")}
        </p>
      )}

      <div className="space-y-1">
        <h2 className="eyebrow">{t("settings.privacy.disk")}</h2>
        <p className="readout text-sm text-foreground">
          {modelsBytes === null ? "…" : formatBytes(modelsBytes)}
        </p>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">{t("settings.privacy.clear")}</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.privacy.clearTitle")}</DialogTitle>
            <DialogDescription>
              {t("settings.privacy.clearBody")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              {t("settings.privacy.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void clearHistory();
                setConfirmOpen(false);
              }}
            >
              {t("settings.privacy.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatLicenseStatus(t: TFunction, status: LicenseStatus): string {
  switch (status.state) {
    case "disabled":
      return t("settings.license.state.disabled");
    case "trial":
      return t("settings.license.state.trial", {
        days: status.trial_days_left ?? 0,
      });
    case "active":
      return t("settings.license.state.active", {
        date: status.expires ?? t("settings.license.unknownDate"),
      });
    case "inactive":
      return t("settings.license.state.inactive");
    case "unverified":
      return t("settings.license.state.unverified");
  }
}

/** What the license server said last time we asked — the half of the picture
 * the old single-word status hid. */
function formatServerVerdict(t: TFunction, status: LicenseStatus): string {
  if (status.server_active === false)
    return status.reason === "device_limit"
      ? t("settings.license.verdict.deviceLimit")
      : t("settings.license.verdict.rejected");
  if (status.server_active !== true)
    return t("settings.license.verdict.pending");
  const parts = [t("settings.license.verdict.active")];
  if (status.days_left !== null)
    parts.push(t("settings.license.verdict.daysLeft", { days: status.days_left }));
  if (status.expires !== null)
    parts.push(t("settings.license.verdict.until", { date: status.expires }));
  return parts.join(" · ");
}

function verdictTone(status: LicenseStatus): string {
  if (status.server_active === true) return "text-ok";
  if (status.server_active === false) return "text-destructive";
  return "text-muted-foreground";
}

function formatCheckedAt(t: TFunction, ms: number | null): string | null {
  if (ms === null) return null;
  const at = new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return t("settings.license.checkedAt", { time: at });
}

interface LicenseTabProps extends TabProps {
  /** Writes the current draft through to the backend, rethrowing on failure. */
  persist: () => Promise<void>;
}

function LicenseTab({ draft, update, persist }: LicenseTabProps) {
  const t = useT();
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const updateLicense = (patch: Partial<SettingsType["license"]>) => {
    update({ license: { ...draft.license, ...patch } });
  };

  useEffect(() => {
    void getLicenseStatus().then(setStatus);
  }, []);

  // The backend checks the *saved* key, so persist the draft first — otherwise
  // a freshly typed key silently checks the previous one.
  const handleCheck = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      await persist();
      setStatus(await checkLicenseNow());
    } catch (err) {
      setCheckError(String(err));
    } finally {
      setChecking(false);
    }
  };

  const checkedAt =
    status === null ? null : formatCheckedAt(t, status.last_checked_ms);

  // The CTA targets everyone who may need to pay: trials, rejected keys, and
  // soon-to-expire subscriptions. A comfortably active user doesn't need it.
  const showSubscribe =
    status !== null &&
    status.state !== "disabled" &&
    !(status.state === "active" && (status.days_left ?? 0) > 30);

  return (
    <>
      <section className="space-y-3">
        <h2 className="eyebrow">{t("settings.license.status")}</h2>
        <div className="space-y-1.5 rounded-md border px-3 py-3">
          <p className="readout text-sm text-foreground">
            {status === null ? "…" : formatLicenseStatus(t, status)}
          </p>
          {/* Licensing off entirely: the state line already says everything. */}
          {status?.state !== "disabled" && (
            <p
              className={cn(
                "readout text-xs",
                status === null ? "text-muted-foreground" : verdictTone(status),
              )}
            >
              {status === null ? "…" : formatServerVerdict(t, status)}
            </p>
          )}
          {checkedAt && (
            <p className="readout text-[11px] text-muted-foreground">
              {checkedAt}
            </p>
          )}
          {checkError && (
            <p role="alert" className="text-xs text-destructive">
              {t("settings.license.checkError", { error: checkError })}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={checking}
          onClick={() => void handleCheck()}
        >
          {checking ? t("settings.license.checking") : t("settings.license.check")}
        </Button>
        {showSubscribe && (
          <div className="space-y-1.5">
            <Button size="sm" onClick={() => void openUrl(TELEGRAM_BOT_URL)}>
              {t("settings.license.subscribe")}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t("settings.license.subscribeHint")}
            </p>
          </div>
        )}
      </section>

      <section className="space-y-5 border-t pt-5">
        <h2 className="eyebrow">{t("settings.license.credentials")}</h2>

        <div className="space-y-2">
          <Label htmlFor="license-key">{t("settings.license.key")}</Label>
          <SecretInput
            id="license-key"
            label={t("settings.license.key")}
            showLabel={t("settings.license.showKey")}
            hideLabel={t("settings.license.hideKey")}
            value={draft.license.key}
            onChange={(key) => updateLicense({ key })}
          />
          <p className="text-xs text-muted-foreground">
            {t("settings.license.keyHint")}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="license-server-url">
            {t("settings.license.serverUrl")}
          </Label>
          <Input
            id="license-server-url"
            aria-label={t("settings.license.serverUrl")}
            className="readout"
            value={draft.license.server_url}
            onChange={(e) => updateLicense({ server_url: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {t("settings.license.serverHint")}
          </p>
        </div>
      </section>
    </>
  );
}
