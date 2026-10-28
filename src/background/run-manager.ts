import { browser } from "wxt/browser";
import { ids } from "@/core/id";
import { err, type Reply } from "@/core/schema/message";
import {
  RunStateSchema,
  type RunState,
  type TimelineEvent,
  type Snapshot,
  type ActionResult,
} from "@/core/schema/run";
import { isHttpUrl, opTargetHosts, type ActionOp } from "@/core/schema/action";
import { logError, logInfo } from "@/core/log";
import { createProvider } from "@/llm";
import { ACTION_TOOLS } from "@/llm/tools";
import { buildStepMessages } from "@/llm/prompts/planner";
import type { ChatMessage, StreamEvent } from "@/llm/types";
import { argsToActionOp } from "@/background/op-map";
import {
  ensureInjected,
  navigateTab,
  waitForTabComplete,
  withTimeout,
} from "@/background/tab-manager";
import {
  appendLog,
  checkpointRun,
  finalizeRun,
  setCurrentRunId,
} from "@/background/run-store";
import { ensureOffscreen, pacedDelay } from "@/background/keepalive";

/**
 * Run state machine + step loop (docs/07 §7.1 / §7.4).
 * M3 additions: resume-from-checkpoint on SW revival, discard-recovery (reload-and-resume),
 * offscreen keep-alive engagement, tab-closed/replaced handling.
 */

interface ActiveRun {
  state: RunState;
  abort: AbortController;
  paused: boolean;
  stopped: boolean;
  loopActive: boolean;
  pauseWaiters: Array<() => void>;
  approval: { id: string; summary: string; resolve: (approved: boolean) => void } | null;
  rejectedApproval: boolean;
}

const SESSIONS = new Map<string, ActiveRun>();

const PACE_MS = 180;
const REPEAT_LIMIT = 3;

// ─── public API ───────────────────────────────────────────────────────────────

export function startAdHocRun(input: {
  instruction: string;
  tabId: number;
  newWindow?: boolean;
}): { runId: string } {
  const runId = ids.run();
  void prepareAdHoc(runId, input);
  return { runId };
}

export function pauseRun(runId: string): void {
  const s = SESSIONS.get(runId);
  if (s && s.state.status === "running") {
    s.paused = true;
    setState(s, "paused");
    emit(s, { kind: "info", text: "Paused by user" });
    breakLoop(s); // loop exits; resume re-enters runLoop from the checkpoint
  }
}

export function resumeRun(runId: string): void {
  const s = SESSIONS.get(runId);
  if (!s) return;
  s.paused = false;
  s.rejectedApproval = false;
  setState(s, "running");
  emit(s, { kind: "info", text: "Resumed" });
  for (const w of s.pauseWaiters.splice(0)) w();
  if (!s.loopActive) void runLoop(s);
}

export function stopRun(runId: string): void {
  const s = SESSIONS.get(runId);
  if (!s) return;
  s.stopped = true;
  s.abort.abort();
  s.paused = false;
  breakLoop(s);
  if (s.approval) {
    s.approval.resolve(false);
    s.approval = null;
  }
  for (const w of s.pauseWaiters.splice(0)) w();
}

export function resolveApproval(runId: string, approvalId: string, approved: boolean): boolean {
  const s = SESSIONS.get(runId);
  if (!s || !s.approval || s.approval.id !== approvalId) return false;
  const a = s.approval;
  s.approval = null;
  setState(s, approved ? "running" : "paused");
  if (!approved) {
    s.paused = true;
    s.rejectedApproval = true;
  }
  emit(s, { kind: "info", text: approved ? "Approved; continuing" : "Rejected; paused" });
  a.resolve(approved);
  return true;
}

/** Cold-start/watchdog path: SW died mid-run; the last checkpoint holds all completed steps. */
export async function resumeRunFromCheckpoint(run: RunState): Promise<void> {
  if (SESSIONS.has(run.id)) return; // a live loop owns this run
  if (run.status !== "running") return;

  logInfo(`resuming ${run.id} from checkpoint (step ${run.stepAttempt})`);
  const s: ActiveRun = {
    state: run,
    abort: new AbortController(),
    paused: false,
    stopped: false,
    pauseWaiters: [],
    approval: null,
    rejectedApproval: false,
    loopActive: false,
  };
  SESSIONS.set(run.id, s);
  emit(s, {
    kind: "info",
    text: `Resumed from checkpoint (step ${run.stepAttempt}) — completed steps are not repeated`,
  });
  setBadge(true);
  void runLoop(s);
}

/** Target tab was closed → park the run as paused (user can reopen and resume). */
export function pauseRunOnTabClosed(tabId: number): void {
  for (const s of SESSIONS.values()) {
    if (s.state.targetTabId !== tabId) continue;
    s.paused = true;
    setState(s, "paused");
    breakLoop(s);
    emit(s, { kind: "error", text: "Target tab closed — run paused" });
    return;
  }
}

/** Tab was replaced (memory-saver discard) → retarget and continue (docs/07 §7.6). */
export function retargetRunTab(removedTabId: number, addedTabId: number): void {
  for (const s of SESSIONS.values()) {
    if (s.state.targetTabId !== removedTabId) continue;
    s.state.targetTabId = addedTabId;
    void checkpointRun(s.state);
    emit(s, { kind: "info", text: `Tab replaced (id ${removedTabId} → ${addedTabId}); continuing` });
    return;
  }
}

// ─── startup: session creation ────────────────────────────────────────────────

async function prepareAdHoc(
  runId: string,
  input: { instruction: string; tabId: number; newWindow?: boolean },
): Promise<void> {
  const settings = await getSettingsSafe();
  let tabId = input.tabId;

  if (input.newWindow) {
    // Dedicated automation window, unfocused (docs/02 §2.5 / ADR-08).
    try {
      const tab = await browser.tabs.get(input.tabId);
      const win = await browser.windows.create({
        url: tab.url ?? "about:blank",
        focused: false,
      });
      const wt = win?.tabs?.[0];
      if (wt?.id !== undefined) tabId = wt.id;
    } catch (e) {
      logError("dedicated window failed", e);
    }
  }

  const state = RunStateSchema.parse({
    id: runId,
    kind: "adhoc",
    instruction: input.instruction,
    status: "running",
    targetTabId: tabId,
    startedAt: Date.now(),
    endedAt: null,
    steps: [],
    usage: { inTok: 0, outTok: 0 },
    stepAttempt: 0,
    repeatSig: [],
    provider: settings?.activeProvider ?? "groq",
    modelStep: settings?.perRoleModel.step ?? "",
    error: null,
  });

  const s: ActiveRun = {
    state,
    abort: new AbortController(),
    paused: false,
    stopped: false,
    pauseWaiters: [],
    approval: null,
    rejectedApproval: false,
    loopActive: false,
  };
  SESSIONS.set(runId, s);
  await setCurrentRunId(runId);
  setBadge(true);
  emit(s, { kind: "info", text: "Run started" });

  try {
    await ensureOffscreen(); // docs/07 §7.3: keep-alive engagement for the lifetime of the run
    await checkpointRun(state);
    await runLoop(s);
  } catch (e) {
    finish(s, "failed", String((e as Error)?.message ?? e));
  } finally {
    SESSIONS.delete(runId);
  }
}

// ─── the loop ────────────────────────────────────────────────────────────────

async function runLoop(s: ActiveRun): Promise<void> {
  if (s.loopActive) return;
  s.loopActive = true;
  try {
    const settings = await getSettingsSafe();
    const tabId = s.state.targetTabId;
    if (tabId === null) throw new Error("No target tab");

    const injected = await ensureInjected(tabId);
    if (!injected.ok) {
      if (injected.reason === "NEEDS_GRANT") {
        throw new Error("Site access not granted — enable the site in the panel, then retry.");
      }
      throw new Error(`Content script not injectable: ${injected.reason}`);
    }
    await ensureOffscreen(); // keep-alive engagement for the lifetime of the run (docs/07 §7.3)

    const budget = settings?.safety.maxStepsPerRun ?? 60;

    while (!s.stopped && s.state.stepAttempt < budget) {
      await waitUnpaused(s);
      if (s.stopped) break;

      s.state.stepAttempt += 1;

      // 1) perceive (with one discard-recovery retry, docs/07 §7.6)
      let snap: Snapshot;
      try {
        snap = await perceive(s);
      } catch (e) {
        emit(s, {
          kind: "error",
          text: `Perceive failed: ${String((e as Error)?.message ?? e)} — attempting reload-and-resume`,
        });
        const recovered = await recoverTab(tabId);
        if (!recovered) throw new Error("Target tab unavailable after recovery");
        snap = await perceive(s);
      }
      const allowedHosts = [new URL(snap.url).host.toLowerCase()];

      // 2) plan (deterministic-first is a workflow-mode feature; ad hoc always models)
      const decision = await planStep(s, snap);
      emit(s, { kind: "plan", text: decision.text, detail: decision.detail });

      // 3) domain gate + approvals (docs/10 §10.1–10.2)
      if (await gate(s, decision.op, allowedHosts)) {
        if (s.rejectedApproval) {
          // User rejected → paused; resume re-enters from checkpoint.
          await checkpointRun(s.state);
          break;
        }
        continue;
      }

      // 4) act
      const result = await act(s, decision.op, snap);
      const outcome = await verifyAndFinish(s, decision.op, result);
      if (outcome === "end") break;

      // 5) pace (humanized jitter, docs/07 §7.4)
      await pacedDelay(PACE_MS);
    }

    if (s.stopped) {
      finish(s, "stopped", null);
    } else if (s.state.stepAttempt >= budget && s.state.status === "running") {
      finish(s, "failed", `Step budget of ${budget} exhausted`);
    } else if (s.state.status === "running") {
      // Pause broke the loop; the run remains checkpointed (resume continues it).
      await checkpointRun(s.state);
    }
  } catch (e) {
    finish(s, "failed", String((e as Error)?.message ?? e));
  } finally {
    s.loopActive = false;
  }
}

function breakLoop(s: ActiveRun): void {
  // Cooperative break: loop checks flags between steps; abort fires for mid-call kills.
  s.abort.abort();
  s.abort = new AbortController();
}

// ─── step pieces ─────────────────────────────────────────────────────────────

async function getSettingsSafe(): Promise<import("@/core/schema/settings").Settings | null> {
  try {
    const { getSettings } = await import("@/core/storage");
    return await getSettings();
  } catch (e) {
    logError("settings load failed", e);
    return null;
  }
}

async function getSecretsSafe(): Promise<import("@/core/schema/settings").Secrets> {
  try {
    const { getSecrets } = await import("@/core/storage");
    return await getSecrets();
  } catch {
    return {};
  }
}

async function perceive(s: ActiveRun): Promise<Snapshot> {
  const tabId = s.state.targetTabId;
  if (tabId === null) throw new Error("No target tab");
  const res = (await withTimeout(
    browser.tabs.sendMessage(tabId, {
      ns: "tba",
      v: 1,
      type: "CS_PERCEIVE",
      reqId: `p_${Date.now()}`,
      payload: null,
    }),
    8000,
  )) as Reply<Snapshot>;
  if (res?.ok) return res.data!;
  throw new Error(res?.error?.message ?? "perceive failed");
}

/** Discard/dead-tab recovery: reload, wait, re-inject (PRD §5 / docs/07 §7.6). */
async function recoverTab(tabId: number): Promise<boolean> {
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab) return false;
  } catch {
    return false; // genuinely closed
  }
  try {
    await browser.tabs.reload(tabId);
    await waitForTabComplete(tabId);
    return (await ensureInjected(tabId)).ok;
  } catch {
    return false;
  }
}

interface PlanDecision {
  text: string;
  detail?: string;
  op: ActionOp;
}

async function planStep(s: ActiveRun, snap: Snapshot): Promise<PlanDecision> {
  const settings = await getSettingsSafe();
  if (!settings) throw new Error("Settings unavailable");
  const secrets = await getSecretsSafe();
  const providerCfg = settings.providers[settings.activeProvider];
  const provider = createProvider(providerCfg, secrets, settings.activeProvider);
  if ("error" in provider) throw new Error(provider.error);

  const messages: ChatMessage[] = buildStepMessages({
    goal: s.state.instruction,
    snapshot: snap.snapshot,
    priorActions: s.state.steps.filter((e) => e.kind === "action" || e.kind === "result"),
    extraGuard: loopGuard(s),
  });

  const { call, toolName, argsJson, text } = await collectToolCall(
    provider.chat({
      messages,
      tools: ACTION_TOOLS,
      toolChoice: "auto",
      model: settings.perRoleModel.step,
      temperature: 0.2,
      signal: s.abort.signal,
    }),
  );
  s.state.usage.inTok += call.inTok;
  s.state.usage.outTok += call.outTok;
  await checkpointRun(s.state); // usage persists too (docs/03 §3.2)

  const mapped = toolName ? argsToActionOp(toolName, argsJson) : { error: "Model made no tool call" };
  if ("error" in mapped) {
    emit(s, { kind: "error", text: "Model returned an unusable action", detail: mapped.error });
    return {
      text: `Said: "${text.slice(0, 120)}" — unusable; retrying next step`,
      op: { op: "fail", reason: `unusable model output: ${mapped.error}` },
    };
  }
  const label = describeOp(mapped);
  return { text: label, detail: compactArgs(mapped), op: mapped };
}

function loopGuard(s: ActiveRun): string | undefined {
  const sig = s.state.repeatSig;
  if (sig.length >= REPEAT_LIMIT) {
    const last = sig[sig.length - 1];
    if (sig.slice(-REPEAT_LIMIT).every((x) => x === last)) {
      return `You have repeated the same action ${sig.length} times. Try a different approach, scroll, or call fail.`;
    }
  }
  return undefined;
}

function describeOp(op: ActionOp): string {
  switch (op.op) {
    case "click":
      return `Clicking element #${op.step}`;
    case "type":
      return `Typing into element #${op.step}${op.submit ? " + Enter" : ""}`;
    case "select":
      return `Selecting "${op.value}" on #${op.step}`;
    case "scroll":
      return `Scrolling ${op.direction}`;
    case "navigate":
      return `Navigating to ${op.url.slice(0, 60)}`;
    case "open_tab":
      return `Opening tab ${op.url.slice(0, 60)}`;
    case "switch_tab":
      return `Switching to tab ${op.tabId}`;
    case "wait_for":
      return `Waiting for ${op.kind} ${op.pattern.slice(0, 40)}`;
    case "extract":
      return "Extracting page summary";
    case "key":
      return `Pressing ${op.key}`;
    case "ask_user":
      return "Asking the user";
    case "request_approval":
      return "Requesting approval";
    case "done":
      return "Done";
    case "fail":
      return "Declared failure";
    default: {
      const never: never = op;
      return String(never);
    }
  }
}

function compactArgs(op: ActionOp): string | undefined {
  try {
    return JSON.stringify(op).slice(0, 160);
  } catch {
    return undefined;
  }
}

async function collectToolCall(gen: AsyncGenerator<StreamEvent>): Promise<{
  text: string;
  toolName: string | null;
  argsJson: string;
  call: { inTok: number; outTok: number };
}> {
  let text = "";
  let toolName: string | null = null;
  let argsJson = "";
  let inTok = 0;
  let outTok = 0;
  for await (const ev of gen) {
    switch (ev.type) {
      case "text-delta":
        text += ev.text;
        break;
      case "tool-call": {
        if (!toolName || ev.call.argsJson.length > argsJson.length) {
          toolName = ev.call.name;
          argsJson = ev.call.argsJson;
        }
        break;
      }
      case "usage":
        inTok = ev.inTok;
        outTok = ev.outTok;
        break;
      case "done":
      case "message":
        break;
      default: {
        const never: never = ev;
        void never;
      }
    }
  }
  return { call: { inTok, outTok }, text, toolName, argsJson };
}

/** Returns true when the step was gated (skipped; loop continues without acting). */
async function gate(s: ActiveRun, op: ActionOp, allowedHosts: string[]): Promise<boolean> {
  if (op.op !== "done" && op.op !== "fail") {
    const hosts = opTargetHosts(op);
    const outside = hosts.filter((h) => h && !allowedHosts.includes(h));
    if (outside.length > 0) {
      emit(s, {
        kind: "approval",
        text: `Off-script navigation to ${outside.join(", ")} (docs/10 gate)`,
      });
      const approved = await requestApproval(s, `Allow navigation to ${outside.join(", ")}?`);
      if (!approved) return true;
    }
  }
  if (op.op === "request_approval") {
    const approved = await requestApproval(s, op.summary);
    return !approved;
  }
  if (op.op === "ask_user") {
    emit(s, { kind: "approval", text: op.question });
    const approved = await requestApproval(s, op.question);
    return !approved;
  }
  return false;
}

async function requestApproval(s: ActiveRun, summary: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const approvalId = ids.approval();
    setState(s, "awaiting_approval");
    s.approval = {
      id: approvalId,
      summary,
      resolve: (approved: boolean) => {
        s.approval = null;
        setState(s, approved ? "running" : "paused");
        resolve(approved);
      },
    };
    emit(s, { kind: "approval", text: summary, detail: approvalId });
  });
}

async function act(s: ActiveRun, op: ActionOp, snap: Snapshot): Promise<ActionResult> {
  void snap;
  const tabId = s.state.targetTabId!;
  switch (op.op) {
    case "navigate": {
      if (!isHttpUrl(op.url)) return { ok: false, reason: "Refused non-http(s) URL", code: "FAILED" };
      emit(s, { kind: "action", text: `Navigate ${op.url.slice(0, 80)}` });
      const res = await navigateTab(tabId, op.url);
      if (res.ok) {
        const inject = await ensureInjected(tabId);
        return inject.ok
          ? { ok: true, data: `now on ${res.finalUrl ?? op.url}` }
          : { ok: false, reason: inject.reason, code: "FAILED" };
      }
      return { ok: false, reason: "Navigation failed", code: "FAILED" };
    }
    case "open_tab": {
      if (!isHttpUrl(op.url)) return { ok: false, reason: "Refused non-http(s) URL", code: "FAILED" };
      const tab = await browser.tabs.create({ url: op.url, active: false });
      if (tab.id !== undefined) s.state.targetTabId = tab.id;
      emit(s, { kind: "info", text: `Opened tab ${tab.id}` });
      const inject = await ensureInjected(s.state.targetTabId ?? tabId);
      return inject.ok
        ? { ok: true, data: "tab open" }
        : { ok: false, reason: inject.reason, code: "FAILED" };
    }
    case "switch_tab": {
      s.state.targetTabId = op.tabId;
      const inject = await ensureInjected(op.tabId);
      return inject.ok
        ? { ok: true, data: "switched" }
        : { ok: false, reason: inject.reason, code: "FAILED" };
    }
    case "wait_for": {
      const res = (await withTimeout(
        browser.tabs.sendMessage(tabId, {
          ns: "tba",
          v: 1,
          type: "CS_EXECUTE",
          reqId: `e_${Date.now()}`,
          payload: { action: op },
        }),
        op.timeoutMs + 5000,
      )) as Reply<ActionResult>;
      if (!res?.ok) return { ok: false, reason: res?.error?.message ?? "wait failed", code: "FAILED" };
      return res.data!;
    }
    case "ask_user":
    case "request_approval": {
      // Re-gated in gate(); reaching here means user already approved.
      return { ok: true, data: "acknowledged" };
    }
    case "done":
    case "fail": {
      return { ok: true, data: "acknowledged" };
    }
    default: {
      // Content-script ops
      const res = (await withTimeout(
        browser.tabs.sendMessage(tabId, {
          ns: "tba",
          v: 1,
          type: "CS_EXECUTE",
          reqId: `e_${Date.now()}`,
          payload: { action: op },
        }),
        60_000,
      )) as Reply<ActionResult>;
      if (!res?.ok) {
        return { ok: false, reason: res?.error?.message ?? "content-script error", code: "FAILED" };
      }
      return res.data!;
    }
  }
}

async function verifyAndFinish(
  s: ActiveRun,
  op: ActionOp,
  result: ActionResult,
): Promise<"continue" | "end"> {
  const text = result.ok
    ? `✓ ${describeOp(op)}${result.data ? ` — ${String(result.data).slice(0, 80)}` : ""}`
    : `✗ ${describeOp(op)} — ${result.reason}`;
  emit(s, {
    kind: result.ok ? "result" : "error",
    text,
    detail: result.ok ? undefined : result.reason,
  });

  const sig = opSignature(op);
  s.state.repeatSig = [...s.state.repeatSig.slice(-8), sig];

  if (op.op === "done") {
    finish(s, "completed", null, op.result);
    return "end";
  }
  if (op.op === "fail") {
    finish(s, "failed", op.reason);
    return "end";
  }
  await checkpointRun(s.state); // checkpoint AFTER verify: completed steps are never repeated
  if (s.stopped) {
    finish(s, "stopped", null);
    return "end";
  }
  return "continue";
}

function opSignature(op: ActionOp): string {
  const parts: string[] = [op.op];
  if ("step" in op && op.step !== undefined) parts.push(String(op.step));
  if ("url" in op) parts.push(op.url);
  return parts.join(":");
}

async function waitUnpaused(s: ActiveRun): Promise<void> {
  if (!s.paused) return;
  emit(s, { kind: "info", text: "Waiting to be resumed…" });
  await new Promise<void>((resolve) => {
    s.pauseWaiters.push(resolve);
  });
}

// ─── events and finish ───────────────────────────────────────────────────────

function setState(s: ActiveRun, status: RunState["status"]): void {
  s.state.status = status;
}

function setBadge(active: boolean): void {
  try {
    if (active) {
      void browser.action.setBadgeBackgroundColor({ color: "#6C5CE7" });
      void browser.action.setBadgeText({ text: "●" });
    } else {
      void browser.action.setBadgeText({ text: "" });
    }
  } catch {
    // ignore
  }
}

function emit(s: ActiveRun, e: { kind: TimelineEvent["kind"]; text: string; detail?: string }): void {
  const ev: TimelineEvent = { seq: s.state.steps.length, ts: Date.now(), ...e };
  s.state.steps.push(ev);
  try {
    browser.runtime.sendMessage({
      ns: "tba",
      v: 1,
      type: "RUN_EVENT",
      reqId: s.state.id,
      payload: {
        runId: s.state.id,
        event: ev,
        status: s.state.status,
        stepCount: s.state.stepAttempt,
        approval: s.approval ? { id: s.approval.id, summary: s.approval.summary } : null,
      },
    });
  } catch (zeroListeners) {
    void zeroListeners;
  }
  void appendLog(s.state.id, [ev]);
}

function finish(
  s: ActiveRun,
  status: RunState["status"] | null,
  error: string | null,
  resultText?: string,
): void {
  if (["completed", "failed", "stopped"].includes(s.state.status)) {
    // already terminal — keep the first outcome
  } else {
    s.state.status = (s.stopped ? "stopped" : (status ?? s.state.status)) as RunState["status"];
  }
  s.state.endedAt = Date.now();
  s.state.error = error;
  if (resultText) emit(s, { kind: "info", text: `Result: ${resultText}` });
  if (error) emit(s, { kind: "error", text: `Run failed: ${error}` });
  emit(s, {
    kind: "info",
    text:
      s.state.status === "completed"
        ? `Completed in ${s.state.stepAttempt} steps · in ${s.state.usage.inTok} tok / out ${s.state.usage.outTok} tok`
        : `Run ${s.state.status} after ${s.state.stepAttempt} steps`,
  });
  void finalizeRun(s.state);
  void setCurrentRunId(null);
  setBadge(false);
  logInfo(`run ${s.state.id} → ${s.state.status}`);
}
