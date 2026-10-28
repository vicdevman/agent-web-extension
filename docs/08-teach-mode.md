# 08 — Teach mode

## 8.1 Recording pipeline

1. User hits **Record** in the side panel (or command palette).
2. SW asks permissions (`PERMS_REQUEST` if the site isn't granted) → injects recorder content
   script (`chrome.scripting.executeScript`) into the current tab.
3. Recorder listens with **capture-phase** listeners so page handlers run first but can't block us:
   `pointerdown/up/click`, `input`, `change`, `submit`, `keydown` (Enter only + special case), scroll
   (passive, throttled), and SPA `history`/`pushState` hooks.
4. On each user event, the recorder resolves the element → `IndexedElement`+`Anchor` (docs/05) plus:
   - `accName`, role, tag, inner text
   - for `input`: `type`/`value` (masked when sensitive), `placeholder`
   - for `click`: pointer coords ← only as a hint for ambiguity resolution, never identity.
5. Events stream to the SW (`CS_EVENT`) → SW buffers → **live step list** in the panel (PRD §8
   requires visible list while recording) merging consecutive events (typing into one field = one
   `type` step with final text unless narration anchors it earlier).

**Narration:** a panel text box (v1 keyboard-only; dictation via web SpeechRecognition API behind a
flag — Chrome ships it, but keep it off path for privacy/permission scope), attached to the last
event; becomes the step `intent` when no clear accName exists (PRD: "this is the filter dropdown…").

## 8.2 From recording → generalized workflow (the "compile" step)

The SW batches events + narration → **generalizer LLM** (planner role model) with this prompt brief
in `llm/prompts/generalizer.ts`:

- Input: the merged event stream (with anchors), narration notes, final URL/page description,
  and the user's *purpose* note if they typed one.
- Output (zod-validated): a **WorkflowDraft** (docs/03): named steps, parameter candidates, expect,
  sensitive flags. The generalizer must:
  - prefer role+accessible-name anchors over CSS selectors; selectors as *secondary* hints only;
  - infer parameters when values look environment-specific (dates, IDs, search terms) with sane
    defaults, exposing `{{param}}` references (PRD §7.1 "parameters I can change per run");
  - propose `sensitive` for submit/send/delete/purchase actions (PRD §7.3);
  - draft `expect` for each step in one clause ("Page heading says Reports");
  - pick `allowedDomains` from the observed hosts, intersected with what the user hasn't disabled.
- **Model never gets a green-light authority** — the user must review everything (panel's Review &
  Edit step always shows drafts before save, PRD §7.1).

## 8.3 Review & edit UX contract

Panel's editor shows steps as cards (docs/11): intent, anchors summary, expect, sensitive toggle,
param markers, drag handle to reorder (reordering triggers a re-validation of *expect* chains).
"Test run" button available on single steps — dry-runs that step only (uses the same pipeline with
a checkpoint-into-runlog "dry" flag). Save → `WORKFLOW_UPSERT`.

## 8.4 Teach-by-correction (during run)

While a run is paused/stuck (PRD: "if the agent gets stuck, I take over, fix it…"):
1. `RUN_TAKEOVER` stops automation; overlay opens "correction recording" mode in the same tab.
2. New user gestures are captured as a diff anchored to the aborted step.
3. Panel shows "Update workflow with this correction?" — on accept, the SW sends the workflow JSON
   plus the correction event-stream to the generalizer, which rewrites only the affected step(s), and
   the editor opens pre-focused on changed steps.

## 8.5 Minimum teach-to-run UX path

< 5 minutes gate (PRD §11): key + site grant + Record + natural task + [Compile] + Review +
[Save ▸ Run]. Any design divergence from this path must justify itself against the metric.
