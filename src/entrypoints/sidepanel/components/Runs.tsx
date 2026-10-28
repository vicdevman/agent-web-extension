import { useEffect } from "react";
import { useRuns } from "../store/runs";

const KIND_ICON: Record<string, string> = {
  observation: "👁",
  plan: "🧠",
  action: "⚡",
  result: "✓",
  approval: "⏸",
  error: "✗",
  info: "•",
};

/** Live run view (docs/11 §11.2): timeline, current action, Pause/Stop, approval cards. */
export function Runs() {
  const runs = useRuns();

  useEffect(() => {
    runs.subscribeRuntime();
    void runs.refreshCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = runs.status === "running" || runs.status === "awaiting_approval";

  return (
    <div className="flex h-full flex-col p-3">
      <header className="mb-2 flex items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold">Runs</h2>
        {runs.runId && (
          <span className="rounded-full bg-bg-elev px-2 py-0.5 text-[11px] text-fg-muted">
            {runs.runId}
          </span>
        )}
      </header>

      {/* terminal / status card */}
      <div className="rounded-xl border border-border bg-bg-elev p-3">
        <p className="text-xs font-medium text-fg-muted">
          {runs.currentAction || "No active run. Ask the agent in Chat, then press ▶ Run on this tab."}
        </p>
        {runs.status && (
          <span
            className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
              runs.status === "running"
                ? "bg-accent text-white"
                : runs.status === "completed"
                  ? "bg-success text-white"
                  : runs.status === "failed" || runs.status === "stopped"
                    ? "bg-danger text-white"
                    : "bg-fg-muted text-white"
            }`}
          >
            {runs.status}
          </span>
        )}
      </div>

      {/* approval card (docs/11 §11.5) */}
      {runs.approval && (
        <div className="mt-2 rounded-xl border border-accent p-3">
          <p className="text-sm font-medium">Approval needed</p>
          <p className="mt-1 text-xs text-fg-muted">{runs.approval.summary}</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => runs.approve(true)}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong"
            >
              Approve
            </button>
            <button
              onClick={() => runs.approve(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {/* controls */}
      {runs.runId && (
        <div className="mt-2 flex gap-2">
          {runs.status === "paused" ? (
            <button
              onClick={runs.resume}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong"
            >
              Resume
            </button>
          ) : (
            <button
              onClick={runs.pause}
              disabled={!busy}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              Pause
            </button>
          )}
          <button
            onClick={runs.stop}
            disabled={!busy}
            className="rounded-lg border border-danger px-3 py-1.5 text-xs font-medium text-danger disabled:opacity-40"
          >
            Stop
          </button>
        </div>
      )}

      {/* timeline */}
      <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {runs.events.map((e) => (
          <div key={`${e.seq}-${e.ts}`} className="flex items-start gap-2 rounded-lg px-2 py-1 hover:bg-bg-elev">
            <span className="w-4 text-center text-[11px]">{KIND_ICON[e.kind] ?? "•"}</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-snug">{e.text}</p>
              {e.detail && <p className="truncate text-[10px] text-fg-muted">{e.detail}</p>}
            </div>
          </div>
        ))}
      </div>

      {!busy && (
        <footer className="mt-2 border-t border-border pt-2 text-center text-[11px] text-fg-muted">
          Start runs from the Chat tab (▶ Run on this tab).
        </footer>
      )}
    </div>
  );
}
