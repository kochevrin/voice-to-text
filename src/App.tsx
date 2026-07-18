import { useState } from "react";
import { Home } from "@/components/Home";
import { Onboarding } from "@/components/Onboarding";
import { Pill } from "@/components/Pill";
import { Settings } from "@/components/Settings";
import { useSettings } from "@/hooks/useSettings";

export default function App() {
  if (window.location.hash === "#/pill") return <Pill />;
  return <MainWindow />;
}

function MainWindow() {
  const { settings, loading, refresh } = useSettings();
  const [view, setView] = useState<"home" | "settings">("home");

  if (loading || !settings) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!settings.onboarding_done) {
    return <Onboarding settings={settings} onComplete={() => void refresh()} />;
  }

  if (view === "settings") {
    return <Settings onClose={() => setView("home")} />;
  }

  return <Home onOpenSettings={() => setView("settings")} />;
}
