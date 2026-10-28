import { browser } from "wxt/browser";
import { logInfo, logError } from "@/core/log";
import type { RunState } from "@/core/schema/run";

/**
 * Keep-alive layer (docs/07 §7.3), grounding: SW idles ~30s; offscreen-document messages
 * (Chrome 109+) and recorded extension API calls reset the timer; `chrome.alarms`
 * (periodInMinutes 0.5, Chrome 120+) revives a terminated worker; checkpointing is the
 * actual guarantee (resume-from-checkpoint in run-manager).
 */

const KEEPALIVE_ALARM = "sw_watchdog";
const JITTER_MS = 200;

export async function ensureOffscreen(): Promise<void> {
  try {
    await browser.offscreen.createDocument({
      url: "/offscreen.html",
      reasons: ["BLOBS"],
      justification: "Keep service worker alive during agent runs (docs/07 §7.3).",
    });
    logInfo("offscreen created");
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (!/single offscreen|already/i.test(msg)) logError("offscreen create failed", e);
  }
}

export function stopKeepalive(): void {
  try {
    browser.offscreen.closeDocument().catch(() => undefined);
  } catch {
    // ignore
  }
}

/** Alarm watchdog: revives a terminated SW and resumes any interrupted run (docs/07 §7.6). */
export async function initWatchdog(onInterruptedRun: (run: RunState) => void): Promise<void> {
  await browser.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  browser.alarms.onAlarm?.addListener((alarm: { name: string }) => {
    if (alarm.name !== KEEPALIVE_ALARM) return;
    void handleFire(onInterruptedRun);
  });
}

async function handleFire(onInterruptedRun: (run: RunState) => void): Promise<void> {
  const { listRunningSessionRuns } = await import("./run-store");
  const runs = await listRunningSessionRuns();
  for (const run of runs) {
    // Small jitter so a model call in flight doesn't double-fire consumers.
    await new Promise((r) => setTimeout(r, JITTER_MS));
    onInterruptedRun(run);
  }
}

/** Human-like pacing between steps (docs/09 §9.3 batch pacing generalizes here). */
export function pacedDelay(ms: number): Promise<void> {
  const jitter = ms === 0 ? 0 : Math.random() * ms * 0.5;
  return new Promise((r) => setTimeout(r, ms + jitter));
}
