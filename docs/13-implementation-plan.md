# 13 — Implementation plan (phased)

Maps PRD §13 milestones into concrete, sequenced engineering phases with deliverables and
acceptance criteria. Each phase ends "demo-able": runnable in the browser, not a stub pile.

## Phase 0 — Bootstrap (0.5 day) — ✅ DONE

- [ ] `npm create wxt@latest`, TypeScript strict, React 18 + Tailwind v4, Zustand, zod, idb, nanoid.
- [ ] Manifest surface via WXT config: background SW, side panel default path, thin popup,
      content script (background-registered `runAt:"document_idle"` on demand), offscreen html,
      `optional_host_permissions: ["<all_urls>"]`, `commands` (Ctrl+K, stop-run).
- [ ] `core/schema/*` initial: message envelope, settings, workflow, run state (docs 03/04).
- [ ] CI-less local quality bar: `tsc --noEmit`, ESLint (no-innerHTML rule → docs/10).
- ✅ *Done when* the unpacked extension loads, side panel opens on toolbar click, panel↔SW ping
      round-trip works.

## Phase 1 — M1 Foundation (days 1–3) — ✅ DONE (build verified: MV3 output, tsc strict, 13/13 unit tests)

- [ ] Settings model + Settings UI: provider config (baseUrl/apiKey/model-per-role), safety limits.
- [ ] `llm/openai-compatible.ts` streaming chat client + zod boundary + abort + backoff (docs 06).
- [ ] Groq as active provider default; `/models` fetch in settings; `LLM_TEST` ping message.
- [ ] Secrets storage local-only + optional passphrase encryption (docs 10 §10.3).
- [ ] Panel: routes skeleton, theme tokens, empty states, onboarding checklist UI (no recorder yet).
- ✅ *DONE when* panel can chat with a configured provider and stream text live; key persists
      locally; provider swap requires only settings (PRD FR8, FR1).

## Phase 2 — M2 Perceive & act (days 4–8) — ✅ CODE COMPLETE (pending live browser verification)

- [ ] Content script bootstrap + PING/READY + port wiring (docs 04).
- [ ] Perception: IndexedElement compiler + string snapshot renderer with budget (docs 05 §5.2–5.3);
      shadow DOM + same-origin iframes; virtualized-list truncation rules.
- [ ] Action executor: click/type/select/scroll/key/navigate/open_tab/wait_for; synthetic events
      first; per-op success reports (docs 05 §5.4).
- [ ] Overlay: highlight ring + status chip (docs 11 §11.3).
- [ ] Run state machine (docs 07 §7.1) + run-manager loop (docs 07 §7.4) driven by **step model**.
- [ ] Tools JSON schemas (docs 06 §6.5); deterministic-first uses planner in workflow mode only.
- [ ] Panel: live run view (timeline, current-action sentence, reasoning gutter), Stop/Pause.
- ✅ *DONE when* ad-hoc English instruction executes on the current tab: perceive→LLM→act→verify,
      medium latency ≤ 2s on Groq steps; Stop aborts mid-LLM before any further action (PRD FR4).

## Phase 3 — M3 Background reliability (days 9–11) — ✅ CODE COMPLETE (pending live browser verification)

- [ ] Offscreen keep-alive port + alarm watchdog (docs 07 §7.3, verified Chrome APIs).
- [ ] Checkpointing to `storage.session` after every step; promote-to-IndexedDB; on SW cold start,
      resume-at-checkpoint path.
- [ ] Tab manager: dedicated-window option; tab-closed/discarded/replaced handling;
      Memory-Saver guidance overlay.
- [ ] Humanized pacing (inter-action delays) default-on, config per run.
- ✅ *DONE when* a 15-step run completes with the tab backgrounded AND the window minimized;
      killing the SW manually mid-run resumes correctly without repeating a completed step
      (PRD FR5, FR6-adjacent acceptance).

## Phase 4 — M4 Teach mode (days 12–17)

- [ ] Recorder content script capture-phase events + stream to SW + live step list in panel (docs 08).
- [ ] Narration notes + event merging; sensitive-value masking for recorded `type` steps.
- [ ] Generalizer prompt + zod WorkflowDraft validation (docs 08 §8.2); parameters with `{{param}}`.
- [ ] Workflow library CRUD in IndexedDB (docs 03 stores + queries), reopen, duplicate, delete.
- [ ] Workflow editor: step cards, anchors editor, expect, sensitive toggle, params, drag-reorder,
      test-single-step dry run.
- [ ] Workflow runs: deterministic-first loop + self-healing anchor refresh (docs 07 §7.2).
- ✅ *DONE when* the <5-minute gate passes: record a real workflow → review → run → succeed on the
      current site; re-running passes on a *different target* item without re-teaching (PRD §7.5
      acceptance #1), and after a week the anchors still resolve (eval harness in docs/14).

## Phase 5 — M5 Safety, batch, polish (days 18–24)

- [ ] Per-site permissions UX + enforcement in SW validators (docs 10 §10.1–10.2).
- [ ] Sensitive-step gates: approval cards panel + `chrome.notifications` deep-link; timeout-inert.
- [ ] Batch: target pick overlay, paste-list matcher, rule resolution, plain-English proposal;
      approve-list UI; canary mode; per-item pre/post checks; undo log; failure policies; report
      + log export (docs 09).
- [ ] Prompt-injection tests (docs/14 §5) — page-content "instructions" must never execute.
- [ ] Run history with audit trail + export JSON/CSV (FR10).
- [ ] UI polish + accessibility pass (11.6), reduced-motion, keyboard-only, a11y labels,
      empty states, error cards "what it tried / saw / Retry·TakeOver·Teach fix".
- ✅ *DONE when* batch acceptance criteria in PRD §7.5 pass verbatim (mismatch halts before action;
      no unapproved item touched; interrupted batch resumes with no repeats).

## Phase 6 — M6 Hardening and extras (days 25–30+, parallelizable)

- [ ] CDP trusted-input fallback via `chrome.debugger` per-site opt-in (+ detach discipline so
      banner goes away; debugger keeps SW alive ≥ Chrome 118 — use it, don't fight it).
- [ ] Self-healing scorecard from eval backlog (docs/14); anchor scorer tuning (selector→text→role).
- [ ] Extra providers: settings presets for OpenRouter/OpenAI/Together/Ollama via the same adapter
      (docs 06 §6.1); per-provider auth quirks; model-suggestion driven `/models` fetch.
- [ ] Scheduling (chrome.alarms) stretch (ADR-06) if M1–M5 velocity allows.
- [ ] Workflow export/import JSON (FR9) + run-log export.
- ✅ *DONE when* a site that ignores synthetic events works via CDP; ≥90% replay reliability on
      eval set; provider swap demonstrated live to a non-Groq provider.

## Standing rules during build

1. No feature merges without the corresponding docs section updated same-PR (docs are config).
2. Every new zod schema lands in `core/schema` once; import — never duplicate.
3. Content script stays under ~80KB gz; perception must stream strings, not giant objects.
4. Any PRD acceptance criterion discovered infeasible gets documented + PRD amendment note in
   `docs` the same day, not deferred silently.

## Open risks → named mitigations (PRD §12 mapped to phases)

| Risk | Mitigation source | Phase |
| --- | --- | --- |
| SW killed mid-run | checkpoint+alarm (docs/07 §7.3) | P3 |
| Sites reject synthetic events | CDP fallback per-site | P6 |
| Prompt injection | envelope + hard gates (docs/10) | P2→P5 enforced |
| Groq 429/deprecation | backoff + config-not-code models | P1 |
| Timers throttled background | event-driven waits, no polling | P2 |
| Batch misfires | approve-list, pre-checks, canary, caps | P5 |
