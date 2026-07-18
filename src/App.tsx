import { useEffect, useState } from "react";
import { Home } from "@/components/Home";
import { Onboarding } from "@/components/Onboarding";
import { Pill } from "@/components/Pill";
import { Settings } from "@/components/Settings";
import { useSettings } from "@/hooks/useSettings";
import { I18nProvider, useT } from "@/lib/i18n";
import { onSettingsChanged } from "@/lib/tauri";
import type { Settings as AppSettings } from "@/lib/types";

export default function App() {
  const { settings, loading, refresh } = useSettings();

  // Views keep their own copy of the settings, so re-read ours whenever any of
  // them persists a change — that is what makes the language switch land
  // immediately instead of on the next launch.
  useEffect(() => onSettingsChanged(() => void refresh()), [refresh]);

  return (
    <I18nProvider lang={settings?.ui_language ?? "en"}>
      {window.location.hash === "#/pill" ? (
        <Pill />
      ) : (
        <MainWindow
          settings={settings}
          loading={loading}
          onOnboarded={() => void refresh()}
        />
      )}
    </I18nProvider>
  );
}

interface MainWindowProps {
  settings: AppSettings | null;
  loading: boolean;
  onOnboarded: () => void;
}

function MainWindow({ settings, loading, onOnboarded }: MainWindowProps) {
  const t = useT();
  const [view, setView] = useState<"home" | "settings">("home");

  if (loading || !settings) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  if (!settings.onboarding_done) {
    return <Onboarding settings={settings} onComplete={onOnboarded} />;
  }

  if (view === "settings") {
    return <Settings onClose={() => setView("home")} />;
  }

  return <Home onOpenSettings={() => setView("settings")} />;
}
