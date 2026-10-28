import { useSettings } from "../store/settings";

/** 60-second onboarding — PRD §8: add API key → enable a site → record a sample workflow.
 * M1 scope: gate 1 and 2 are inline; recording appears in M4. */
export function Onboarding() {
  const { settings, save } = useSettings();
  if (!settings) return null;

  const steps = [
    { done: true, label: "Install the extension" },
    { done: Object.values(settings.providers).some((p) => p.apiKeyRef), label: "Choose provider" },
    { done: settings.sites.length > 0, label: "Enable the first site (record step, next milestone)" },
  ];
  const readyForFirstRun = steps[0].done && steps[1].done;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h1 className="text-base font-semibold">Welcome 👋</h1>
        <p className="mt-1 text-xs text-fg-muted">
          Three things and you're teaching your first workflow. Everything stays in this browser.
        </p>
      </div>
      <ol className="flex flex-col gap-2">
        {steps.map((s, i) => (
          <li
            key={i}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
              s.done ? "border-success" : "border-border"
            }`}
          >
            <span
              className={`grid size-5 place-items-center rounded-full text-[11px] font-bold ${
                s.done ? "bg-success text-white" : "bg-bg-elev text-fg-muted"
              }`}
            >
              {s.done ? "✓" : i + 1}
            </span>
            <span className="text-sm">{s.label}</span>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2">
        <button
          onClick={() => void save({ onboarded: true })}
          disabled={!readyForFirstRun}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-strong disabled:opacity-40"
        >
          Skip tour — go to Chat
        </button>
        {!readyForFirstRun && (
          <span className="text-xs text-fg-muted">Finish the first two steps to unlock</span>
        )}
      </div>
      <p className="text-xs text-fg-muted">
        Tip: configure your provider key in the <b>Settings</b> tab.
      </p>
    </div>
  );
}
