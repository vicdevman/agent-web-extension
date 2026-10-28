import { create } from "zustand";
import { send } from "@/core/messaging";
import type { TimelineEvent, RunStatus } from "@/core/schema/run";

/** Panel-side view of the active run (docs/04 §4.2). SW broadcasts RUN_EVENT one-shots;
 * the panel applies them to this store and renders the live timeline. */

interface UiApproval {
  id: string;
  summary: string;
}

interface RunsState {
  runId: string | null;
  status: RunStatus | null;
  currentAction: string;
  events: TimelineEvent[];
  approval: UiApproval | null;
  needsGrant: boolean;
  connected: boolean;
  start: (instruction: string, tabId: number | null) => Promise<boolean>;
  refreshCurrent: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  approve: (approved: boolean) => void;
  subscribeRuntime: () => void;
}

let subscribed = false;

export const useRuns = create<RunsState>((set, get) => ({
  runId: null,
  status: null,
  currentAction: "",
  events: [],
  approval: null,
  needsGrant: false,
  connected: false,

  start: async (instruction, tabId) => {
    if (get().status === "running" || get().status === "awaiting_approval") return false;
    set({
      runId: null,
      status: "running",
      currentAction: "Starting…",
      events: [],
      approval: null,
      needsGrant: false,
      connected: true,
    });
    const res = await send<{ runId: string }>("RUN_START_ADHOC", { instruction, tabId });
    if (!res.ok) {
      set({
        status: "failed",
        currentAction: res.error?.message ?? "Failed to start",
        runId: null,
      });
      return false;
    }
    set({ runId: res.data?.runId ?? null });
    return true;
  },

  refreshCurrent: async () => {
    const res = await send<{ runId: string | null }>("RUN_CURRENT");
    if (res.ok && res.data?.runId) {
      set({ runId: res.data.runId, connected: true });
    }
  },

  pause: () => void send("RUN_PAUSE", { runId: get().runId }),
  resume: () => void send("RUN_RESUME", { runId: get().runId }),
  stop: () => void send("RUN_STOP", { runId: get().runId }),
  approve: (approved) => {
    const { runId, approval } = get();
    if (runId && approval) void send("RUN_APPROVE", { runId, approvalId: approval.id, approved });
    set({ approval: null });
  },

  subscribeRuntime: () => {
    if (subscribed) return;
    subscribed = true;
    chrome.runtime.onMessage.addListener((msg: { ns?: string; type?: string; payload?: unknown }) => {
      if (msg?.ns !== "tba") return;
      const p = (msg.payload ?? {}) as {
        runId?: string;
        event?: TimelineEvent;
        status?: RunStatus;
        approval?: UiApproval | null;
      };
      if (msg.type === "RUN_EVENT" && p.runId) {
        if (get().runId && p.runId !== get().runId) return;
        set((s) => ({
          runId: s.runId ?? p.runId!,
          status: p.status ?? s.status,
          events: p.event ? [...s.events, p.event!] : s.events,
          approval: p.approval ?? null,
          currentAction: p.event && (p.event.kind === "plan" || p.event.kind === "action") ? p.event.text : s.currentAction,
        }));
      }
    });
  },
}));
