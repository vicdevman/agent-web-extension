import { browser } from "wxt/browser";
import { openDB, type IDBPDatabase } from "idb";
import { RUN_SESSION_KEY_PREFIX, type RunState, type TimelineEvent } from "@/core/schema/run";
import { logError } from "@/core/log";

/**
 * Run persistence (docs/03 §3.7): in-flight state lives in chrome.storage.session (survives SW
 * death, cleared on browser restart); completed runs + audit logs are promoted to IndexedDB.
 * Full resume-from-checkpoint lands in M3; M2 already writes the checkpoints.
 */

interface TBADB extends IDBPDatabase {
  runs: { key: string; value: RunState };
  runlogs: { key: [string, number]; value: TimelineEvent & { runId: string } };
}

let dbPromise: Promise<TBADB> | null = null;

function db(): Promise<TBADB> {
  if (!dbPromise) {
    dbPromise = openDB("tba", 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains("runs")) {
          d.createObjectStore("runs", { keyPath: "id" });
          d.createObjectStore("runlogs", { keyPath: ["runId", "seq"] });
        }
      },
    }) as never;
  }
  return dbPromise;
}

export async function checkpointRun(state: RunState): Promise<void> {
  try {
    await browser.storage.session.set({ [`${RUN_SESSION_KEY_PREFIX}${state.id}`]: state });
  } catch (e) {
    logError("checkpoint failed", e);
  }
}

export async function getSessionRun(runId: string): Promise<RunState | null> {
  const res = await browser.storage.session.get(`${RUN_SESSION_KEY_PREFIX}${runId}`);
  const raw = res[`${RUN_SESSION_KEY_PREFIX}${runId}`];
  return (raw as RunState | undefined) ?? null;
}

/** Current/lasest active run for panel reconnect (browser restart handling comes in M3). */
export async function getCurrentRunId(): Promise<string | null> {
  const res = await browser.storage.session.get("ui:currentRunId");
  return (res["ui:currentRunId"] as string | undefined) ?? null;
}

export async function setCurrentRunId(runId: string | null): Promise<void> {
  await browser.storage.session.set({ ["ui:currentRunId"]: runId });
}

export async function appendLog(
  runId: string,
  events: TimelineEvent[],
): Promise<void> {
  if (events.length === 0) return;
  try {
    const d = await db();
    const tx = d.transaction("runlogs", "readwrite");
    for (const e of events) await tx.store.put({ ...e, runId });
    await tx.done;
  } catch (e) {
    logError("run log append failed", e);
  }
}

/** Promote a finished run to IndexedDB (durable) and clear its session copy. */
export async function finalizeRun(state: RunState): Promise<void> {
  try {
    const d = await db();
    await d.put("runs", state);
    await appendLog(state.id, state.steps);
  } catch (e) {
    logError("finalize failed", e);
  }
  try {
    await browser.storage.session.remove(`${RUN_SESSION_KEY_PREFIX}${state.id}`);
  } catch {
    // ignore
  }
}

/** Full session dump for the watchdog / cold-start resume path. */
export async function listRunningSessionRuns(): Promise<RunState[]> {
  try {
    const all = await browser.storage.session.get(null);
    const runs: RunState[] = [];
    for (const [key, value] of Object.entries(all ?? {})) {
      if (!key.startsWith(RUN_SESSION_KEY_PREFIX)) continue;
      const run = value as RunState;
      if (run && run.status === "running") runs.push(run);
    }
    return runs;
  } catch (e) {
    logError("list runs failed", e);
    return [];
  }
}

/** Dead sessions restored for the run state machine; runs whose SW died mid-step. */
export async function listInterruptedRuns(): Promise<{
  running: RunState[];
  awaitingApproval: RunState[];
}> {
  const all = (await browser.storage.session.get(null)) ?? {};
  const running: RunState[] = [];
  const awaitingApproval: RunState[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(RUN_SESSION_KEY_PREFIX)) continue;
    const run = value as RunState;
    if (!run) continue;
    if (run.status === "running") running.push(run);
    if (run.status === "awaiting_approval") awaitingApproval.push(run);
  }
  return { running, awaitingApproval };
}
