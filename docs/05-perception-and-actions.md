# 05 — Perception and actions

## 5.1 Philosophy

Numbers-as-handles: the model returns **element indices**, not selectors or coordinates. Compact,
cheap on tokens, robust, and the mapping index↔DOM lives only inside the content script for that
snapshot generation (PRD §9). No raw HTML dumps.

## 5.2 Snapshot format (wire string, designed ~≤4k tokens typical page)

```
PAGE url=https://app.example.com/reports title=Reports — Acme | heading=Reports
VIEWPORT scrollY=0 visible=true
BREADCRUMB path=/reports
[ 1] link   "Export CSV"           /reports/export
[ 2] button "Filter"               disabled=no
[ 3] list
[ 4]   combobox "Date range" value="Last 7 days" options="[ Last 24 hours | Last 7 days | … | ]"
[ 5]   textbox "Search" placeholder="Search…"
[ 6] grid rows=50 cols=8
[ 7]   row "INV-0421 Acme Ltd $1,204 pending"
...
[43] button "Submit" needs_confirm=maybe
FORM note action=/api/export method=post
```

Rules:
- Numbering restarts each snapshot; action tool calls carry `{ step, snapshotGen }` so the SW rejects
  stale indices.
- Only *interactive or meaningfully-text-bearing* elements are listed (PRD §9). Fully visible,
  above-the-fold and interactive first; virtualized lists surface only feasible items.
- Shadow DOM is pierced (composed traversal); same-origin iframes traversed inline with
  `IFRAME src=…` delimiter and sub-numbering.
- Long lists summarized; `grid`/`row` lines compress cell text.

## 5.3 Snapshot data shape (internal)

```ts
type IndexedElement = {
  index: number;          // 1-based
  rect: DOMRect;          // for overlay; never sent to LLM
  role: AriaRole;         // from computed semantics, not tag
  name: string;           // accName best effort: aria-label, alt, textContent, <label for>
  text?: string;          // truncated 80 chars
  value?: string;         // trunc 80; if sensitive → "<redacted>"
  states: ("disabled"|"checked"|"selected"|"expanded"|"required")[];
  anchor: Anchor          // for future recording hints
};
type Anchor = { selector: string; text?: string; role?: string; xpath?: string; nth?: number };
```

## 5.4 Action execution

```ts
type ActionOp =
  | { op:"click";       step:number; gen:number }
  | { op:"type";        step:number; gen:number; text:string; submit?:boolean }
  | { op:"select";      step:number; gen:number; value:string; by?: "label"|"value" }
  | { op:"scroll";      direction:"up"|"down"|"into"; step?:number; gen?:number }
  | { op:"navigate";    url:string }
  | { op:"wait_for";    condition: WaitForCondition; timeoutMs:number }
  | { op:"extract";     selector?:string; limit?:number }
  | { op:"open_tab";    url:string }
  | { op:"switch_tab";  tabId:number }
  | { op:"key";         key:string; index?:number; gen?:number }
```

- `click/type/select/key` resolve `gen+step` → `IndexedElement`, attempt actor in priority order:
  1. `DispatchEvent` with **PointerEvent + `isPrimary`** and short mouseover/mousemove dances to look
     legitimate. `isTrusted=false`, but many sites honor it.
  2. If the site rejects (detected via verification step not confirming e.g. a menu opened),
     **CDP fallback** via `chrome.debugger`: `Input.dispatchMouseEvent`, `Input.insertText`,
     `Input.dispatchKeyEvent`, `DOM.focus`. Banner trade-off per PRD §5; per-site toggle
     `sites[].cdpFallback` (default off), consent in settings.
- **`type` semantics**: focus → clear via `select()` on range where possible → `insertText` (CDP) or
  `beforeinput/afterinput` synthetic with `InputEvent` finally `change` + `input` events fired.
- **Event ordering** for buttons that expect real flows: pointerdown → pointerup → click, unless
  tests have shown keyboard-only activation necessary.
- After every action, executor re-checks `document.contains(el)` or an equivalent alive check, and
  returns `{ ok, elStillAlive, focused, scrollChanged }`.

## 5.5 Verification helpers

```ts
type VerifyObservation = {
  url: string; title: string; overlayVisible: boolean;
  history?: { msg:string }[];
  extracted?: Record<string, string>;   // when op was extract
  toast?: string;                       // common toast/banner text heuristics
};
```

`wait_for` conditions: `element(selector|text)`, `state(index, prop, value)`, `url(...)`,
`n_rows(>= n)`, `selector_gone(sel)`. Implemented as `MutationObserver` + explicit subscription not
`polling` (throttles background tabs). Timeout ⇒ `ok=false` and step marked for model fallback.

## 5.6 Resilience matrix (PRD §10 non-functional)

| Condition | Handling |
| --- | --- |
| SPA nav | `CS_URL_CHANGED` → SW re-permits, re-perceives; works without reload |
| iframe (same-origin) | traversed and acted inside with same messages |
| Shadow DOM | composed traversal; cannot be missed |
| Virtualized list | fetch via generator scrolling (`scroll into view`) |
| Site rejects synthetic events | CDP fallback per PRD with consent |
| Overlay/third-party iframes bot-ignore | treated as not-actionable; model told `[SKIP]` |
