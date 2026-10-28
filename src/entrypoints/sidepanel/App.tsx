import { useEffect, useState } from "react";
import { useSettings } from "./store/settings";
import { Chat } from "./components/Chat";
import { SettingsView } from "./components/Settings";
import { Library } from "./components/Library";
import { Runs } from "./components/Runs";
import { Onboarding } from "./components/Onboarding";

type Tab = "chat" | "library" | "runs" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "library", label: "Library" },
  { id: "runs", label: "Runs" },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("chat");
  const { settings, load } = useSettings();

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <header className="flex items-center gap-1 border-b border-border px-3 pt-2 pb-1">
        <span className="mr-auto flex items-center gap-2 text-sm font-semibold">
          <span className="grid size-5 place-items-center rounded-md bg-accent text-[10px] font-bold text-white">
            ▶
          </span>
          Teachable Browser Agent
        </span>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id}
            className={`rounded-md px-2 py-1 text-xs font-medium transition-colors duration-150 ${
              tab === t.id
                ? "bg-bg-elev text-fg underline decoration-accent decoration-2 underline-offset-4"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        {settings && !settings.onboarded ? (
          <Onboarding />
        ) : tab === "chat" ? (
          <Chat onRunStarted={() => setTab("runs")} />
        ) : tab === "library" ? (
          <Library />
        ) : tab === "runs" ? (
          <Runs />
        ) : (
          <SettingsView />
        )}
      </main>
    </div>
  );
}
