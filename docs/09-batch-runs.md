# 09 — Batch runs

Applies a workflow taught on one item to a user-approved list of targets (PRD §7.5). The agent
learns the **actions** from the demo; **targets** are a parameter.

## 9.1 Target selection modes (combinable)

| Mode | Flow | Storage |
| --- | --- | --- |
| **Pick on page** | Overlay injects checkboxes onto list items; captures each item's stable id | `Target { platformId?, name, url?, anchor }` |
| **Paste list** | Panel textarea accepts names/IDs per line; SW asks content script to match | `Target` list with `matchedBy: name\|id` |
| **Rule** | Rule DSL, e.g. `viewed < 7d`, `name starts-with "private-"`, auto-resolves via content script | saved with the run so it can be re-run |
| **Plain English** | SW asks planner, sees the page, proposes targets | always passes through approval |

Resolution flow → **Resolve, preview, approve.** No batch begins without the user approving the
exact final list in the panel, at which point `RUN_START_BATCH` receives target ids. The approval UI
shows name, id, and link, with checkbox remove (PRD §7.5).

## 9.2 Identity and per-item invariants

- Store targets by **platformId** when one exists (Discord channel id from URL, MEE6 ticket id);
  name is the secondary check; list positions never identity (PRD explicit).
- **Pre-action check per item** (content script): requested element's ID/name must equal target's
  approved values; mismatch ⇒ halt *before* acting, ask (PRD acceptance criterion).
- **Post-action verification per item**: expect clause from the workflow; result recorded
  pass\|fail\|skip per target; runs report shows the tally + downloadable log (PRD §7.5).
- **Stable across restarts**: `completedTargetIds` is id-based (never index-based), so interrupted
  batches resume **without repeating** completed items (PRD acceptance criterion).

## 9.3 Run modes and safety rails

| Rail | Default | Notes |
| --- | --- | --- |
| Canary first | **on for destructive** (`sensitive`-tagged workflows) | run item #1 → pause → auto-approve or stop |
| Max items | `safety.maxItemsPerBatch` (default 50) | |
| Inter-item delay | `safety.interItemDelayMs` (default 800ms + jitter) | reduces anti-bot flagging |
| Failure policy | `stop` (alt: `skip`) | workflow-level setting |
| Undo log | writes **before** every reversible change | one-click restore in run report; deletes are irreversible, require approval |
| Dry-run | panel toggle per batch | walks everything but the concrete act; reports planned actions (PRD §12 risk mitigation) |

## 9.4 Long and virtualized lists

Content script exposes a **find-by-identity** primitive: the SW asks "scroll/search and find item
with platformId X", content script drives keyboard search / incremental scroll (MutationObserver),
re-resolves on reload, and returns an anchor when found (or `not_found` after a bounded effort →
recorded as skipped, PRD acceptance: correct handling of "items shift").

## 9.5 Batch loop specifics

```
for each approved target (after cursor):
  navigate/locate item (find-by-identity)
  pre-action check (id/name equality) → mismatch? halt or skip per policy
  run the workflow body (steps) with target context injected into {{target.*}} params
  re-layout: re-locate list (SPA shifts happen)  / log + verify per target
  checkpoint: targetCursor++, completedTargetIds.append(targetId), undoLog entry
  wait inter-item delay
report: pass/fail/skipped tables + export JSON/CSV
```

The loop reuses the same generic action pipeline (docs/07) with a per-target context envelope; the
body planner sees `TARGET` metadata first so it cannot confuse list rows.
