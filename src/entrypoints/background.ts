import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";

import { PORT, err, makeMsg, type MsgEnvelope, type Reply } from "@/core/schema/message";
import { logError, logInfo } from "@/core/log";
import { getSecrets, getSettings, updateSettings, resetSettings } from "@/core/storage";
import { createProvider } from "@/llm";
import type { ChatParams } from "@/llm/types";
import type { Settings } from "@/core/schema/settings";
import {
  startAdHocRun,
  pauseRun,
  resumeRun,
  stopRun,
  resolveApproval,
  resumeRunFromCheckpoint,
  pauseRunOnTabClosed,
  retargetRunTab,
} from "@/background/run-manager";
import { getActiveTab } from "@/background/tab-manager";
import {
  listInterruptedRuns,
  getCurrentRunId,
} from "@/background/run-store";
import { initWatchdog } from "@/background/keepalive";
import type { RunState } from "@/core/schema/run";

/**
 * Service worker — the single orchestrator (docs/02 §2.1). Phases 1–3: settings, secrets,
 * provider factory, streaming chat/test over the `chat` port, ad hoc run commands, and
 * background reliability (offscreen keep-alive, alarm watchdog, tab listeners, resume).
 */

export default defineBackground(() => {
  logInfo("background ready");
  void bootstrapReliability();

  // Toolbar icon opens the side panel (docs/02 §2.1 popup = launcher only).
  browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch((e: unknown) => {
    logError("setPanelBehavior failed", e);
  });

  // ---- one-shot commands (docs/04 §4.1) ----
  browser.runtime.onMessage.addListener((msg: MsgEnvelope, _s, sendReply: (r: Reply) => void) => {
    void handleMessage(msg, sendReply);
    return true; // async reply
  });

  // ---- streaming chat/test port (docs/04 §4.2 pattern) ----
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === PORT.keepalive) {
      logInfo("keepalive port connected");
      return;
    }
    if (port.name !== PORT.chat) return;
    port.onMessage.addListener((msg: MsgEnvelope) => {
      void handleChatPort(port, msg);
    });
  });

  // ---- M3: tab lifecycle → run safety (docs/07 §7.6) ----
  browser.tabs.onRemoved.addListener((tabId: number) => {
    pauseRunOnTabClosed(tabId);
  });

  browser.tabs.onReplaced.addListener((addedTabId: number, removedTabId: number) => {
    // Memory-saver discards / tab replacement: retarget transparently (docs/07 §7.6).
    retargetRunTab(removedTabId, addedTabId);
  });
});

/** M3 reliability bootstrap: revive interrupted runs, arm the alarm watchdog. */
async function bootstrapReliability(): Promise<void> {
  try {
    const interrupted = await listInterruptedRuns();
    // Awaiting-approval runs are revived as running: the re-planned step re-solicits approval.
    for (const r of interrupted.awaitingApproval) {
      await resumeRunFromCheckpoint({ ...r, status: "running" } as RunState);
    }
    for (const r of interrupted.running) {
      await resumeRunFromCheckpoint(r);
    }
    await initWatchdog((run: RunState) => {
      void resumeRunFromCheckpoint(run);
    });
  } catch (e) {
    logError("reliability bootstrap failed", e);
  }
}

async function handleMessage(msg: MsgEnvelope, sendReply: (r: Reply) => void): Promise<void> {
  if (!msg || msg.ns !== "tba") {
    sendReply({ ok: false, error: err("BAD_REQUEST", "Malformed envelope") });
    return;
  }
  try {
    switch (msg.type) {
      case "PING": {
        sendReply({ ok: true, data: { pong: true } });
        return;
      }
      case "SETTINGS_GET": {
        sendReply({ ok: true, data: await getSettings() });
        return;
      }
      case "SETTINGS_UPDATE": {
        const patch = (msg.payload ?? {}) as Partial<Settings>;
        const next = await updateSettings(patch);
        sendReply({ ok: true, data: next });
        await broadcastState("SETTINGS_APPLIED", next);
        return;
      }
      case "SETTINGS_RESET": {
        const next = await resetSettings();
        sendReply({ ok: true, data: next });
        await broadcastState("SETTINGS_APPLIED", next);
        return;
      }
      case "RUN_START_ADHOC": {
        const p = msg.payload as { instruction?: string; tabId?: number | null } | undefined;
        const instruction = (p?.instruction ?? "").trim();
        if (!instruction) {
          sendReply({ ok: false, error: err("BAD_REQUEST", "Empty instruction") });
          return;
        }
        const tab = p?.tabId != null ? { id: p.tabId } : await getActiveTab();
        if (!tab?.id) {
          sendReply({ ok: false, error: err("BAD_REQUEST", "No active tab") });
          return;
        }
        const { runId } = startAdHocRun({ instruction, tabId: tab.id });
        sendReply({ ok: true, data: { runId, tabId: tab.id } });
        return;
      }
      case "RUN_PAUSE":
        pauseRun((msg.payload as { runId?: string })?.runId ?? "");
        sendReply({ ok: true, data: {} });
        return;
      case "RUN_RESUME":
        resumeRun((msg.payload as { runId?: string })?.runId ?? "");
        sendReply({ ok: true, data: {} });
        return;
      case "RUN_STOP":
        stopRun((msg.payload as { runId?: string })?.runId ?? "");
        sendReply({ ok: true, data: {} });
        return;
      case "RUN_APPROVE": {
        const p = msg.payload as { runId?: string; approvalId?: string; approved?: boolean };
        const ok2 = resolveApproval(p?.runId ?? "", p?.approvalId ?? "", Boolean(p?.approved));
        sendReply({ ok: ok2, data: {} });
        return;
      }
      case "RUN_CURRENT": {
        sendReply({ ok: true, data: { runId: await getCurrentRunId() } });
        return;
      }
      case "KEEPALIVE_TICK": {
        // Presence of this handler + the incoming message resets the SW idle timer (docs/07 §7.3).
        sendReply({ ok: true, data: {} });
        return;
      }
      default: {
        sendReply({ ok: false, error: err("BAD_REQUEST", `Unknown message type "${msg.type}"`) });
      }
    }
  } catch (e) {
    logError(`handler ${msg.type} failed`, e);
    sendReply({ ok: false, error: err("EXEC_FAILED", String((e as Error)?.message ?? e)) });
  }
}

async function handleChatPort(
  port: chrome.runtime.Port,
  env: MsgEnvelope,
): Promise<void> {
  if (env.type !== "LLM_CHAT") {
    port.postMessage({ type: "error", message: `Unsupported port message: ${env.type}` });
    return;
  }
  const payload = (env.payload ?? {}) as {
    messages: ChatParams["messages"];
    model?: string;
    temperature?: number;
  };
  const settings = await getSettings();
  const secrets = await getSecrets();
  const providerCfg = settings.providers[settings.activeProvider];
  const provider = createProvider(providerCfg, secrets, settings.activeProvider);
  if ("error" in provider) {
    port.postMessage({ type: "error", message: provider.error });
    return;
  }
  try {
    const stream = await provider.chat({
      messages: payload.messages ?? [],
      temperature: payload.temperature ?? 0.4,
      model: payload.model,
    });
    for await (const event of stream) {
      port.postMessage({ type: "chat-event", event });
    }
  } catch (e) {
    port.postMessage({
      type: "error",
      message: String((e as Error)?.message ?? e),
      aborted: (e as Error)?.name === "AbortError",
    });
  }
}

async function broadcastState(type: string, payload: unknown): Promise<void> {
  try {
    const msg = makeMsg(type, payload);
    await browser.runtime.sendMessage(msg);
  } catch {
    // No other listener; fine.
  }
}
