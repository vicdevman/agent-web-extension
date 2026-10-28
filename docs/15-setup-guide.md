# 15 — Setup & running guide

How to install, configure, and run the Teachable Browser Agent extension. This is the manual for
daily use; `13-implementation-plan.md` is the engineering plan.

---

## 1. Prerequisites

| Requirement | Version | Why |
| --- | --- | --- |
| Node.js | ≥ 20 (tested on 22/24) | build tooling |
| npm | ≥ 10 | package manager. **Note:** on some Windows setups `npm.ps1` is blocked by execution policy; use `npm.cmd …` instead, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Browser | Chromium 120+: Chrome, Edge, Brave, or Arc | side panel, alarms 30s, offscreen, debugger-on-demand APIs |
| A model API key | Groq by default | [console.groq.com](https://console.groq.com) → API Keys. Free tier works |

> Your browser keeps all data local: workflows, run history, and API keys stay in `chrome.storage`
> / IndexedDB of this extension. Nothing is sent anywhere except the model provider you configure
> (`https://api.groq.com/openai/v1` by default).

---

## 2. Install and build

```bash
git clone <repo> agent-web-extension     # or use the existing folder
cd agent-web-extension
npm install        # installs deps and runs `wxt prepare` (generates .wxt/ types)
```

Useful commands (run one, not all):

| Command | What it does |
| --- | --- |
| `npm run build` | production build → `.output/chrome-mv3/` |
| `npm run dev` | watch mode with auto-reload of the extension in the browser |
| `npm run compile` | strict TypeScript check only (`tsc --noEmit`) |
| `npm test` | unit tests (vitest) |
| `npm run gen:icons` | regenerate the toolbar icons into `public/icons/` |

---

## 3. Load the extension into your browser

1. Run `npm run build` (or `npm run dev`).
2. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the folder
   `agent-web-extension/.output/chrome-mv3`.
5. Pin the extension in the toolbar (puzzle-piece menu).

> **When you change code**: `npm run build` then click the circular ↻ (reload) icon on the
> extension card in `chrome://extensions`. With `npm run dev`, WXT reloads it automatically.

---

## 4. First-run setup (2 minutes)

1. **Open the panel** — click the toolbar icon (the side panel opens) or use the popup's
   "Open agent panel".
2. **Add your API key** — Settings tab → *Provider* section:
   - Keep `groq` selected (default).
   - Base URL is prefilled: `https://api.groq.com/openai/v1`.
   - API key → paste your Groq key → **Save**. The key is stored locally, shown as
     masked, and never injected into web pages.
3. **Models** — section *Models per role*:
   - *Planner*: stronger reasoning model (default `qwen/qwen3.8-27b`).
   - *Step execution*: fast model (default `qwen/qwen3.8-27b`).
   - Check [console.groq.com/docs/models](https://console.groq.com/docs/models) for the current
     model names — model names are **config, not code**.
4. **Test** — click *Test provider*. Expect `✅ OK` (or the model's reply) within a couple of
   seconds. A red message here explains the actual problem (bad key, wrong URL, 429 …).
5. **Enable a site** — section *Sites*: with the target site's tab focused, the input shows
   `https://app.example.com`. Click **Enable site** and Chrome will ask to allow access. Click
   **Allow scope**. The site now appears as a green chip (click the chip to revoke).

> In the future, runs also stop with the explicit message `Site access not granted` when the
> site isn't enabled — the fix is always: Settings → Sites → Enable site.

---

## 5. Running the agent

Open the tab you want the agent to work in (any tab of an enabled site), open the side panel:

### Ad hoc instruction (works from day 1)
1. Chat tab → type an instruction, e.g.
   *"Find the search box, type 'reports', press Enter, wait, then click Export."*
2. Press **▶ Run** (not Send). The view switches to **Runs**.
3. Watch the timeline. On page affordances you'll see the highlight ring and a status chip.
4. Important distinction:
   - **Send** = talk to the assistant (a plain LLM chat; it does NOT act on pages).
   - **▶ Run** = execute the instruction as an agent (perceive → plan → act → verify loop).

### During a run you can
| Control | Where | Effect |
| --- | --- | --- |
| **Pause** | Runs tab | finishes the current step, then parks (checkpoint is kept) |
| **Resume** | Runs tab | continues from the last checkpoint — completed steps are NOT repeated |
| **Stop** | Runs tab (red) | aborts the in-flight model call and ends the run |
| **Approve / Reject** | approval card | appears when the agent asks (e.g. off-script navigation) — Reject pauses the run |
| **Reload the extension/tab** | — | do it — a revived service worker resumes the run automatically |

### Background behavior (project's core promise)
- Switch to another tab: the run keeps going (event-driven waits, no polling).
- Minimize the window: the run keeps going.
- Chrome's memory saver discards the tab: the agent reloads it, re-injects, and continues.
  (For long sessions, add the site to Memory Saver's "keep active" list.)
- If the service worker is terminated mid-run (normal MV3 behavior), the alarm watchdog revives
  it within ≤30s and resumes from the last checkpoint.

### Approval gates
Sensitive or off-script actions (navigating to a new domain, anything the model flags) pause the
run and show an **Approval needed** card. Approve to let the step through, reject to pause.
Timeouts are inert — nothing is auto-approved.

---

## 6. What's implemented today vs. coming

| Capability | Status |
| --- | --- |
| Provider layer (Groq default, OpenAI-compatible), per-role models, streaming | ✅ M1 |
| Perceive snapshot (index-based, shadow DOM, iframes, ≤~4k tokens) + actions | ✅ M2 |
| Ad hoc natural-language runs with stop/pause/approvals | ✅ M2 |
| Offscreen keep-alive, watchdog, checkpoint & resume, reload-and-resume | ✅ M3 |
| **Teach mode** (record → generalize → edit → save → run saved workflow) | M4 — next |
| Batch runs (approve-list, canary, undo log) | M5 |
| CDP trusted-input fallback, extra providers | M6 |

Until M4 lands, the *Library* tab is intentionally a stub — recording isn't wired yet. Run mode
(ad hoc instructions) is fully usable.

---

## 7. Troubleshooting

| Symptom | Cause → fix |
| --- | --- |
| ❌ Test provider: `API key for "groq" is missing` | Settings → API key wasn't saved. Re-enter and Save. |
| ❌ Test provider: HTTP 401/403 | Wrong/revoked key, or wrong provider selected. |
| ❌ Test provider: HTTP 404 model not found | Model name outdated — update *Models per role* (Groq renames models; check their docs). |
| ❌ Test provider: HTTP 429 | Rate limited — automatic backoff already applies; wait or change model. |
| Run says `Site access not granted` | Settings → Sites → Enable site (with the site's tab focused). |
| Run says `Content script not injectable` | The tab is a chrome:// page, PDF viewer, or the Chrome Web Store — those can't be scripted. Use a normal http(s) page. |
| Run says `Resumed from checkpoint …` out of nowhere | The MV3 service worker was killed — this is expected; the alarm watchdog revived the run. Nothing to do. |
| Run says `…timed out` in an element step | The site changed under the agent; it re-perceives and retries once, then self-corrects or fails. If a specific site ignores synthetic clicks, CDP fallback comes in M6. |
| Timeline frozen at `Waiting to be resumed…` | The run is paused — press Resume. |
| Panel shows no permission prompt on "Enable site" | Focus any tab of that site, reopen Settings; the origin field autofills from the active tab. |
| `wxt prepare` fails: "No entrypoints found" | You ran it before files existed or from the wrong directory — run it in the repo root after `npm install`. |

**Debug tools**
- `chrome://extensions` → extension card → **Inspect views**: `service worker` and `sidepanel`
  consoles show `[tba]`-prefixed logs.
- `chrome://serviceworker-internals` — Stop the extension's worker to rehearse resume behavior.
- The run's audit trail lives in IndexedDB (`tba` → `runlogs`) — inspect via DevTools ▸ Application
  ▸ IndexedDB inside the service worker or panel context.

---

## 8. Data & privacy map

| Data | Where | Leaves the browser? |
| --- | --- | --- |
| API keys | `chrome.storage.local` (masked in UI) | never in page content; only provider calls |
| Settings | `chrome.storage.local` | no |
| Workflows / run history / audit logs | IndexedDB (`tba`) | no |
| In-flight run checkpoints | `chrome.storage.session` | no (cleared on browser restart) |
| Page content | only snapshot strings, in-memory per step | **only** to the configured model provider as part of the step prompt |
| Passwords/secret fields | masked before any model call | never (password-type, `pass|token|card|ssn|api key` name patterns) |

No analytics, no remote fonts/scripts, no sync — unless you deliberately change the provider
Base URL in settings.

---

## 9. Updating models when Groq renames them

1. Open the panel → Settings → *Models per role*.
2. Replace the model id with the new name from Groq's model docs.
3. Press **Test provider** to confirm.

Nothing else — model names are data (PRD §7.4: "config, not hard-coded").
