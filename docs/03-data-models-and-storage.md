# 03 — Data models and storage

All schemas are defined once in `core/schema/` with zod; types are inferred from schemas. IDs are
prefixed nanoids (`wf_`, `run_`, `step_`, `trg_`).

## 3.1 Workflow (IndexedDB `workflows`)

```jsonc
{
  "id": "wf_wk9q2m",                       // wf_*
  "name": "Export weekly report",
  "description": "Export the last-7-days CSV from the dashboard",
  "allowedDomains": ["dashboard.example.com"],   // navigations-type actions gated by this list
  "parameters": [
    { "key": "range", "label": "Date range", "type": "string", "default": "7d" }
  ],
  "steps": [
    {
      "id": "st_a1b2",
      "intent": "Open the Reports page",
      "anchors": {                              // replace old 'hints' — resolvable descriptors
        "url": { "include": "/reports" },       // matched looser than taught: contains
        "selector": "nav a[href='/reports']",
        "text": "Reports",
        "role": "link"
      },
      "expected": "Heading 'Reports' visible",
      "sensitive": false,
      "action": "navigate"                     // optional: canonical action if deterministic
    }
  ],
  "sensitiveActionGate": "always",             // always|off|ask
  "version": 3,                                 // schema version for migrations
  "createdAt": 1730000000000,
  "updatedAt": 1730500000000,
  "stats": { "runs": 12, "successRate": 0.92, "medianSteps": 7, "medianCostUsd": 0.0031 }
}
```

Notes:
- `parameter` values can be referenced in step text as `{{range}}` and typed via `type` actions.
- Sensitive flags are *proposed by the generalizer*, always reviewed by the user in the editor.
- Position/index info is captured for hints only; **never used as identity** (PRD §7.5).

## 3.2 Run (IndexedDB `runs`, active copy in `chrome.storage.session`)

```jsonc
{
  "id": "run_k2j4x",
  "kind": "workflow" | "adhoc" | "batch",        // which mode started it
  "workflowId": "wf_wk9q2m" | null,
  "instruction": "…",                            // adhoc text or resolved batch overview
  "params": { "range": "7d" },
  "targets": ["trg_…", "trg_…"] | null,          // batch only, may only contain approved ids
  "state": "running" | "paused" | "awaiting_approval" | "completed" | "failed" | "stopped",
  "phase": "perceive" | "plan" | "act" | "verify",  // for resume mid-step
  "currentStepIndex": 4,                          // workflow mode
  "targetCursor": 19,                             // batch mode
  "completedTargetIds": ["trg_a", "trg_b"],        // batch resumability
  "perTargetChecks": { "trg_a": { "matched": true, "verified": "pass" } },
  "undoLog": [ { "targetId": "trg_a", "previousState": "/*** opaque JSON snapshot ***/", "ts": … } ],
  "attempts": [ { "stepIndex": 3, "actionOp": {…}, "result": {…}, "llmTrace": { ref } } ],  // last 10, full log in runs log store
  "guards": { "maxSteps": 60, "maxRepeat": 3, "repeatCount": 1, "stepBudgetUsed": 12 },
  "startedAt": …, "endedAt": …,
  "usage": { "inTok": 0, "outTok": 0, "costEstUsd": 0 },
  "provider": "groq", "modelPlanner": "…", "modelStep": "…"
}
```

Chapter 07 defines the state machine; chapter 09 lists batch-specific constraints.

## 3.3 Run log events (IndexedDB `runlogs`) — audit trail

Append-only per step: `{ runId, seq, ts, kind: observation|plan|action|result|approval|error,
payload }`. Written by the SW from its periodic checkpoint so no step result can be lost.

## 3.4 Settings and secrets (`chrome.storage.local`, single `settings` key + `secrets`)

```jsonc
{
  "version": 2,
  "providers": {                                  // provider-agnostic config (PRD §7.4)
    "groq":   { "baseUrl": "https://api.groq.com/openai/v1", "apiKeyRef": "key:groq", "modelPlanner": "llama-3.3-70b", "modelStep": "llama-3.1-8b", "modelVision": null, "jsonMode": true },
    "ollama": { "baseUrl": "http://localhost:11434/v1", "apiKeyRef": null, "modelPlanner": "llama3.2", "modelStep": "llama3.2", "jsonMode": true }
  },
  "activeProvider": "groq",
  "perRoleModel": { "planner": "llama-3.3-70b", "step": "llama-3.1-8b", "vision": null },
  "sites": [ { "host": "dashboard.example.com", "granted": true, "cdpFallback": false } ],
  "safety": { "maxStepsPerRun": 60, "maxItemsPerBatch": 50, "interItemDelayMs": 800,
              "canaryFirst": true, "failurePolicy": "stop" },
  "appearance": { "theme": "system", "overlayEnabled": true },
  "onboarded": true,
  "commandPaletteShortcut": "Ctrl+K"
}
```

`secrets` (separate key, never synced, behind optional passphrase): AES-GCM encrypted blobs of API
keys. See [10-security.md](10-security.md#secrets).

## 3.5 Recorder buffer

Raw recording lives only in the SW memory + session storage (`recording:{id}`) while recording;
compiled workflows live in IndexedDB only after the user reviews them.

## 3.6 IndexedDB layout (db `tba`, `idb` lib)

| Store | Key | Indexes | Notes |
| --- | --- | --- | --- |
| `workflows` | `wf_id` | `name`, `updatedAt` | full history kept, soft delete |
| `runs` | `run_id` | `workflowId`, `startedAt`, `state` | metrics derived by query |
| `runlogs` | keyPath auto | `runId+seq` compound | append-only; small shard per run |
| `secrets` | `provider` | — | encrypted blobs only |

Access rule: **only the SW reads/writes IndexedDB.** The panel and content scripts never touch it;
they go over messages. This removes races when the SW restarts.

## 3.7 Session storage key map

```
run:{runId} → RunState (steps above)     // survives SW death; cleared on browser restart
recording:{recId} → recorder outer buffer
paletteCache → last 5 workflows for instant palette
```

## 3.8 Versioning and migrations

All records carry `version`. Upgrade functions live in `core/schema/migrations.ts`: — `v1→v2` example:
anchors restructure, add `stats`. Run a lazy migration on first read-in-SW; keep a raw backup copy
in IndexedDB prior to rewriting. Never break the format without a new `version` bump.
