# 04 — Message protocol

All cross-context traffic goes through the service worker (single bus). Every message is a
`Msg<T>` envelope; schemas live in `core/schema/message.ts` and are the contract for every subsystem.

```ts
type Msg<K, T> = { ns: "tba", v: 1, type: K, reqId: string, payload: T };
type Reply<R, E = Err> = { ok: true, data: R } | { ok: false, error: E };
```

`reqId` lets the sender correlate replies; helpers `send()` (one-shot) and `openChannel(name)`
(long-lived port) wrap `chrome.runtime.sendMessage` / `connect`.

## 4.1 Panel → SW

| Type | Payload | Notes |
| --- | --- | --- |
| `PANEL_READY` | `{ panelInstanceId }` | SW answers with `STATE_SYNC` snapshot |
| `RUN_START_ADHOC` | `{ tabId?, newTab?, url?, instruction, dryRun? }` | |
| `RUN_START_WORKFLOW` | `{ workflowId, tabId?, newTab?, params }` | |
| `RUN_START_BATCH` | `{ runId, targets: TargetId[], canary }` | batch created via pipeline below |
| `RUN_PAUSE` / `RUN_RESUME` / `RUN_STOP` | `{ runId }` | stop is hard; pause is soft (finish current step) |
| `RUN_APPROVE` / `RUN_REJECT` | `{ runId, approvalId, edits? }` | approval gates |
| `RUN_TAKEOVER` | `{ runId }` | stops automation; user takes over; enables "Teach fix" |
| `BATCH_RESOLVE` | `{ mode: rule/list/plain, query, workflowId }` | SW + panel preview loop → returns candidates |
| `WORKFLOW_UPSERT` | `{ workflow }` | from editor; zod-validated server-side |
| `WORKFLOW_DELETE` / `WORKFLOW_EXPORT` | id | export returns full JSON |
| `RECORDER_START` / `RECORDER_PAUSE` / `RECORDER_RESUME` / `RECORDER_STOP` | `{ tabIds? }` | |
| `RECORDER_ADD_NOTE` | `{ recordingId, note, at }` | |
| `SETTINGS_UPDATE` | partial settings | |
| `PERMS_REQUEST` | `{ origins: string[] }` | SW triggers optional_permissions request (user gesture required — panel click provides it) |
| `LLM_TEST` | provider config | emits test result back |

## 4.2 SW → Panel (streaming, on the run port `run:{runId}`)

| Type | Payload |
| --- | --- |
| `RUN_EVENT` | step timeline event (tier): `{ runId, seq, kind, phase, text, detail?, ts }` |
| `RUN_UPLOAD_PATCH` | compact RunState patch (zustand store diffs) |
| `APPROVAL_REQUEST` | `{ approvalId, runId, summary, step, diff?, sensitive }` |
| `RUNTERMINAL` | final state + report summary |
| `STATE_SYNC` | full snapshot for late-joining panels |

Panel also subscribes to a global port `state` for library/settings changes
(`WORKFLOW_SAVED`, `SETTINGS_APPLIED`, `RUN_LIST_CHANGED`).

## 4.3 SW → Content (per-tab, port `tab:{tabId}` preferred)

| Type | Payload | Notes |
| --- | --- | --- |
| `CS_PING` | — | readiness check |
| `CS_PERCEIVE` | `{ maxTokens?: 4000, needRoles?: boolean, viewportOnly? }` | heavier mode uses a11y-ish tree |
| `CS_EXECUTE` | `{ seq, action: ActionOp }` | see 05 |
| `CS_WAIT_FOR` | `{ condition, timeoutMs }` | MutationObserver-based |
| `CS_OVERLAY` | `{ show: bool, chip?: string, highlightIndex?: number, palette? }` | |
| `CS_RECT_FOR_INDEX` | `{ index }` | for overlay placement |
| `RECORDER_ON` / `OFF` / `PAUSE` | — | |
| `PICK_TARGETS_ON` / `OFF` / `CAPTURE` | rules | batch target selection overlay |

Content → SW: `CS_RESULT`, `CS_ERROR`, `CS_URL_CHANGED` (SPA nav), `CS_EVENT` (recorder), `CS_PICK`.

## 4.4 Content → SW

| Type | Payload |
| --- | --- |
| `CS_RESULT` | `{ seq, ok, data?, escalate?: 'untrusted'|'notfound'|'no_detached' }` |
| `CS_URL_CHANGED` | `{ url }` | SW re-permits or pauses run |
| `CS_EVENT` | recorder event (click/type/select/scroll/navigate) |
| `CS_PICK` | batch target capture: `{ id, name, index, anchor }` |

## 4.5 Offscreen ↔ SW

Offscreen doc holds an open port `keepalive` and `postMessage`s a tick every ≤ 25s. A `tick`
received in the SW resets the 30s idle timer (verified Chrome 109+ behavior). Fallback alarm
`sw_keepalive` every 30s wakes the SW even if the port dies.

## 4.6 Error shape

```ts
type Err = {
  code: "NOT_READY" | "DENIED_SITE" | "APPROVAL_REQUIRED" | "NO_LLM" | "LIMIT"
      | "EXEC_FAILED" | "CS_DEAD" | "BAD_REQUEST",
  message: string,          // human readable, rendered as "what it tried / what it saw"
  retryable?: boolean
};
```

## 4.7 Conventions

- No content-script ↔ panel direct messages, ever.
- Ports used for streams; one-shots for commands; both funnel through the SW.
- All payload types validated in zod *both* at send and receive boundaries (defensive against
  version skew after an extension update while a run is in progress).
