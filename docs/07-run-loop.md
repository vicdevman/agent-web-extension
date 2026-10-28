# 07 — Run loop, reliability, resumability

## 7.1 Run state machine

```
idle → preparing → (perceiving → planning → acting → verifying)* → done | scheduled
                ↘ awaiting_approval (sensitive gate / mismatch / batch mismatch)
                ↘ paused (user, provider outage, tab missing) → resume from last checkpoint
                ↘ failed | stopped | completed
```

Guards evaluated by the SW before every step: step budget, max-followed repeat count (same element,
same op ≥ `maxRepeat`(default 3) → escalate to planner with a "you are looping" note), sensitive
gate, per-site domain allowlist.

## 7.2 Deterministic-first rule (PRD FR3)

Workflow-mode step resolution, in order:
1. Step is ≤ 1 step from prior deterministic execution and the snapshot shows an element whose
   `Anchor` scores ≥ 0.8 (selector exact → text+role → name+role fuzzy) → execute directly, no LLM.
2. If the anchor is ambiguous or verification outcome ≠ expected ('fuzzy match' with L1 fallback):
   planner LLM now *targets the step's intent*, not just the page goal.
3. After the model acts and verification passes, the SW *records* a refreshed anchor back into the
   workflow (self-healing — this is what makes ≥90% replay reliability achievable per PRD §11).

## 7.3 Keep-alive strategy (researched, with Chrome versions)

Facts (Chrome ≥ 120 assumed baseline):
- SW idles after **~30s** of no events. `fetch` responses over 30s also don't hold it (so slow LLM
  answers can outlive the worker unless another event resets the timer).
- Messages from an **offscreen document** (since Chrome 109) and other extension API calls reset the
  idle timer; long-lived port messaging also qualifies (Chrome 114+).
- Active `chrome.debugger` sessions keep the SW alive (Chrome 118+).
- `chrome.alarms` minimum period 30s (Chrome 120+), wakes a terminated SW.

Therefore the layering below (from fast path to GFI, keeping checkpointing as the *actual* guarantee):

1. **Offscreen keep-alive port**: offscreen doc sends `tick` ≤ every 20s while a run is active.
   Verified `periodInMinutes:0.5` corresponds to accepted `alarm` behaviour for the alarm fallback.
   (Not our primary accelerator because alarms are ≥30s minimum; only assures wake.)
2. **Alarm fallback** `sw_watchdog` every 30s to revive the SW after an unclean kill.
3. **Checkpointing** — after *every step*, the SW commits the RunState blob to
   `chrome.storage.session`; every 10 steps and before/after sensitive steps, promote to IndexedDB.
   On SW start (`onStartup`, `onIdle` handlers), read `run:{activeId}`. If `state === running`,
   resume (re-verify target tab alive). This makes SW death a non-event per PRD §5 table ("service
   worker killed mid-run: keepalive, checkpointing, resumable runs").
- Async long operations (e.g. `wait_for`) re-arm the keepalive just before starting them.

## 7.4 Step loop details

```ts
// pseudo — run-manager.ts
while (budgetLeft) {
  const snapshot = await callCS({ type:"CS_PERCEIVE", ...perceptionBudget });
  const decision = await decide(snapshot);    // deterministic-first → else LLM step model
  if (decision.kind === "approve") { setState("awaiting_approval"); continue; }  // gate
  const result = await callCS({ type:"CS_EXECUTE", action: decision.op });
  const verified = verify(result, decision.expectation);
  await checkpoint({ state, snapshotRef, decision, result, verified });
  emit("RUN_EVENT", { step, text, detail });
  if (decision.on === "done") { return finish(verified.ok ? "completed" : "failed"); }
  if (decision.on === "fail") { return fail(decision.reason); }
  // scheduling: small humanized jitter (either model's `waitLess:n`) optional, default off
}
```

- Every LLM call includes: system prompt (hardened, docs/10), the run's goal, the workflow's current
  step intent (workflow mode), the snapshot string, last-3 step summaries as compact history
  (keeps context small & cheap, per PRD §7.4).
- Decisions arrive as **exactly one tool call**; anything else → model retry once with explicit
  schema reminder, then fail step.

## 7.5 Pause/resume semantics

- **User pause**: SW sets `state=paused`; stops after the *current* action completes; keeps target
  page as-is. Panel shows resume point.
- **Hard stop**: abort current provider call, CDP debugger detach sends `chrome.debugger.detach` on
  curves — otherwise CDP sessions keep SW alive (which we want only during an action).
- **Takeover** (PRD §7.1 "Teach by correction"): marks workflow step, disables model for this run,
  switches off overlay; while the user operates, the recorder can capture a corrective demo which
  the panel offers to save as an edit ("Update workflow with this correction") — see docs/08.

## 7.6 Crash/edge matrix

| Situation | Behavior |
| --- | --- |
| SW killed mid LLM call | checkpoint holds last verified state; alarm revives; resumes current step |
| Tab closed mid-run | tab-manager sees missing tab; if reload-resume permitted (workflow has anchors) reload it; else pause and ask |
| Tab discarded (memory saver) | detect discards via `chrome.tabs.onReplaced`, reload, resume |
| Provider 429 storms | backoff per docs/06; auto-pause after 5 failures within 60s |
| Approval timeout (tab in background) | stays paused until read; browser notification via `chrome.notifications` points back to panel |
| Extension update mid-run | zod envelope version skew → migrate known shas; else fail gracefully with message |
