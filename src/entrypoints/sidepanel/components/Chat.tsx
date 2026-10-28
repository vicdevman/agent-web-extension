import { useState } from "react";
import { useChat } from "../store/chat";
import { useRuns } from "../store/runs";

export function Chat({ onRunStarted }: { onRunStarted?: () => void }) {
  const { messages, busy, send } = useChat();
  const runsStart = useRuns((s) => s.start);
  const status = useRuns((s) => s.status);
  const [input, setInput] = useState("");

  const submit = () => {
    send(input);
    setInput("");
  };

  const runOnTab = async () => {
    const instruction = input.trim();
    if (!instruction || status === "running" || status === "awaiting_approval") return;
    setInput("");
    const started = await runsStart(instruction, null);
    if (started) onRunStarted?.();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col-reverse gap-2 overflow-y-auto p-3">
        <div className="flex flex-col gap-2">
          {messages.length === 0 && (
            <div className="mt-24 text-center text-fg-muted">
              <p className="text-sm">Talk to the agent, or run a workflow from the Library.</p>
              <p className="mt-1 text-xs">Runs in your own tabs, with your own logins.</p>
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[88%] rounded-xl px-3 py-2 text-sm leading-snug ${
                m.role === "user"
                  ? "self-end bg-accent text-white"
                  : "self-start bg-bg-elev text-fg"
              }`}
            >
              {m.error ? (
                <span className="text-danger">{m.error}</span>
              ) : (
                <span className="whitespace-pre-wrap">{m.text}</span>
              )}
              {m.streaming && <span className="ml-1 inline-block animate-pulse">▍</span>}
            </div>
          ))}
        </div>
      </div>
      <form
        className="flex items-end gap-2 border-t border-border p-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask the agent to do something…"
          rows={2}
          className="min-h-9 flex-1 resize-none rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none"
          aria-label="Chat with the agent"
        />
        <button
          type="button"
          onClick={() => void runOnTab()}
          disabled={!input.trim() || status === "running" || status === "awaiting_approval"}
          className="rounded-lg border border-accent px-3 py-2 text-sm font-medium text-accent transition-colors duration-150 hover:bg-accent hover:text-white disabled:opacity-40"
          title="Run this instruction as an agent on the current tab"
        >
          ▶ Run
        </button>
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-strong disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
