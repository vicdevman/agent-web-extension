# 01 — Overview

## What we are building

A Manifest V3 Chromium extension that:

1. **Teach mode** — records the user demonstrating a workflow (clicks, typing, selects, navigation)
   plus optional narration, then uses an LLM to compile that raw recording into a *generalized,
   parameterized workflow definition* (not a brittle macro).
2. **Run mode** — executes saved workflows or ad-hoc English instructions inside the user's real
   browser tabs, reusing their logged-in sessions, working in background tabs and minimized windows.
3. **Batch mode** — applies a taught workflow to a user-approved list of targets with per-item
   verification, canary mode, and an undo log.

Provider layer is abstract (`LLMProvider`); Groq is the default via its OpenAI-compatible endpoint.

## Non-goals (v1) — restated for scoping discipline

- No cloud browsers, no Firefox/Safari, no marketplace, no CAPTCHA/2FA/payment handling, no
  execution while the machine sleeps or the browser is closed.

## Why it can work (feasibility summary)

| Scenario | Works? | Technique |
| --- | --- | --- |
| Background tab | ✅ | DOM read/write unaffected; event-driven waits (MutationObserver), never tight timers |
| Minimized window | ✅ | DOM actions fine; avoid render-dependent checks; prefer DOM/a11y perception over screenshots |
| Memory-saver discard | ⚠️ | Instruction to exempt site + reload-and-resume from last checkpoint |
| Browser closed / asleep | ❌ | Out of scope |

## Core loop

```
perceive (compact indexed snapshot) → decide (LLM tool call OR deterministic hint match)
→ act (content script / CDP) → verify (expected outcome) → checkpoint → repeat
```

## Success criteria (from PRD §11)

- ≥80% unattended success on 10 real workflows by end of v1.
- ≥90% replay reliability after a week without edits (self-healing).
- Teach → first successful run < 5 min.
- Median step latency < 2s on Groq for model-driven steps (near-instant for deterministic steps).
- Perception payload < ~4k tokens per step in typical pages.
- Template workflows succeed on **different targets than taught** without re-teaching.
- Interrupted runs resume without repeating completed steps/items.

## Definition of v1 done (mapped to PRD FRs)

FR1–FR10 in the PRD are all in scope for v1; CDP trusted-input fallback, extra provider adapters,
and export/import are allowed to land in the M6 hardening phase rather than M1–M5.
See [13-implementation-plan.md](13-implementation-plan.md).
