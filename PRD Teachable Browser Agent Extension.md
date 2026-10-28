# PRD: Teachable Browser Agent Extension

**Author:** Victor Adeiza · **Status:** Draft v0.1 · **Date:** October 25, 2026

## 1. Summary

A Chromium (Manifest V3) browser extension that lets me **teach an AI agent a workflow once, then have it run that workflow inside my real browser**, using my already logged-in sessions. It keeps working in background tabs and minimized windows. Groq is the first model provider, behind a provider-agnostic interface so any OpenAI-compatible or other provider can be swapped in.

## 2. Problem

Most browser agents run in a cloud browser or a fresh profile. That means re-authenticating, hitting bot detection, and having no access to my real accounts. Most extensions that automate pages need me to keep the tab focused and babysit them. I want an agent that lives in *my* browser, learns repetitive tasks from me, and does them without needing my attention.

## 3. Goals

1. Run as a browser extension inside my own profile, reusing existing logins and cookies.
2. **Teach mode:** I demonstrate or describe a workflow once, and the agent saves it as a reusable, editable workflow.
3. **Run mode:** the agent executes saved workflows (or ad hoc instructions) on the current page or a specified tab.
4. Keep working when the tab is in the background or the window is minimized.
5. Groq as default provider; swapping providers requires config, not code changes.
6. A modern, fast, minimal UI that stays out of the way.

## 4. Non-Goals (v1)

- No cloud-hosted browser or remote execution.
- No Firefox or Safari support (Chromium only: Chrome, Brave, Edge, Arc).
- No workflow marketplace or sharing.
- No handling of CAPTCHAs, 2FA prompts, or payment confirmations autonomously.
- No work while the computer is asleep or the browser is closed.

## 5. Feasibility: can it work while I'm not on the page or the browser is minimized?

**Yes, with caveats.** Chrome extensions can drive any open tab, including background tabs and tabs in minimized windows.

| Scenario | Works? | Notes |
| --- | --- | --- |
| Tab in background (another tab focused) | Yes | Content scripts and DOM reads/writes still work. Timers are throttled (about 1s minimum, harsher after \~5 min), so use event-driven waits (MutationObserver) instead of tight polling. |
| Window minimized | Yes | Tab is treated as hidden. Layout and paint can be suspended. Reading and clicking via DOM works; anything depending on rendering (screenshots, visibility checks) may fail. |
| Different virtual desktop or app focused | Yes | Same as minimized. |
| Tab discarded by Chrome memory saver | No (by default) | Exempt target sites from Memory Saver, or the agent reloads the tab and resumes from the last checkpoint. |
| Computer asleep or browser closed | No | Out of scope. |

**Key technical constraints:**

- **Service worker lifetime.** MV3 service workers are killed after about 30s idle. Long runs must keep the worker alive (open port from an offscreen document or side panel, `chrome.alarms` heartbeat) and persist run state to `chrome.storage.session` / IndexedDB after every step so a run can resume.
- **Trusted input.** Synthetic events dispatched from content scripts have `isTrusted: false`, and some sites ignore them. Fallback: `chrome.debugger` (Chrome DevTools Protocol) for real input events. Trade-off: Chrome shows a persistent "debugging this browser" banner. Use DOM actions first; escalate to CDP only when needed, per site.
- **Hidden-tab rendering.** Minimized windows may pause rendering. Prefer DOM and accessibility-tree perception over screenshots in v1; use vision only as a fallback and only when the tab can be rendered.
- **Dedicated window option.** Running automation in a separate (unfocused or minimized) window keeps my main browsing undisturbed and avoids focus-stealing.

## 6. Users and Core Use Cases

**Primary user:** me, a developer who is logged into many dashboards and tools and has repetitive multi-step tasks.

Example workflows:

- Open a dashboard, filter to last 7 days, export CSV, rename and download.
- Fill the same form across several pages with data from a spreadsheet or clipboard.
- Go through a list of items in an admin panel and apply an action (tag, approve, archive).
- Monitor a page and notify me when something changes.

## 7. Key Features

### 7.1 Teach mode (record and describe)

- **Demonstrate:** I hit Record and perform the workflow normally. The extension captures a stream of events (click, type, select, navigate, scroll) with rich element context: accessible name, role, text, stable selectors, surrounding DOM, URL pattern.
- **Narrate (optional):** I can type or speak notes alongside the recording ("this is the filter dropdown, always pick Last 7 days").
- **Generalize:** the model turns the raw recording into a **workflow definition**: named steps in natural language, parameters (inputs I can change per run), expected outcomes per step, and fallback hints. It does not just replay brittle selectors.
- **Review and edit:** I see the generated workflow as an editable step list before saving.
- **Teach by correction:** during a run, if the agent gets stuck or does the wrong thing, I take over, fix it, and choose "Update workflow with this correction."

### 7.2 Run mode

- Run a saved workflow on the current tab, a chosen tab, or a new tab/window.
- Run ad hoc instructions in plain English without saving.
- **Observe, plan, act loop:** each step perceives the page (compact DOM / accessibility snapshot), asks the model for the next action as a structured tool call, executes it, verifies the result, repeats.
- **Deterministic first:** where a recorded selector still matches and the expected outcome is met, execute without calling the model (faster, cheaper, more reliable). Fall back to the model on mismatch (self-healing).
- **Parameters:** prompt for inputs at run time or accept them from clipboard/CSV.
- **Background execution:** runs continue when I switch tabs or minimize (see Section 5), with a status badge on the toolbar icon.

### 7.3 Safety and control

- **Per-site permissions:** the agent only acts on sites I have explicitly enabled (use optional host permissions, requested at runtime).
- **Confirmation gates:** steps tagged as sensitive (submit, send, delete, purchase, anything irreversible) pause for my approval. The agent proposes the tag; I can override.
- **Always-visible stop:** a Pause/Stop control in the side panel, toolbar badge, and keyboard shortcut.
- **Step limits and loop detection:** max steps and max repeated-action guard per run.
- **Prompt-injection defense:** page content is treated as untrusted data, never as instructions. System prompt says so; sensitive actions that were not part of the workflow or my instruction always require approval; the agent cannot navigate to or send data to domains outside the workflow's allowed domain list without approval.
- **Local-first data:** workflows, run logs, and API keys stay in the browser (`chrome.storage` / IndexedDB). Nothing is sent anywhere except the model provider call. Page content sent to the model is minimized and I can mask fields (passwords, tokens, card numbers are never sent).
- **Run log and replay:** every run records steps, observations, and outcomes so I can audit what happened.

### 7.4 Model providers

- **Groq first.** Groq's API is OpenAI-compatible, supports tool/function calling, streaming, and JSON output, and is very fast, which suits a many-small-steps agent loop.
- **Provider abstraction:** a single `LLMProvider` interface:
  - `chat({ messages, tools, temperature, signal }) -> stream of { text | toolCall | usage }`
  - `capabilities: { toolCalling, vision, jsonMode, maxContext }`
  - Config per provider: `baseUrl`, `apiKey`, `model`, headers.
- Adapters: OpenAI-compatible (covers Groq, OpenAI, OpenRouter, Together, local Ollama / LM Studio) as the default adapter. Separate adapters later for Anthropic and Gemini native APIs.
- **Per-role model settings:** let me pick a model for *planning/teaching* (needs stronger reasoning) versus *step execution* (needs speed), plus an optional vision model.
- **Bring your own key**, stored locally. Optional encryption with a passphrase. Handle rate limits (429) with backoff and surface clear errors.
- Model names are config, not hard-coded, because available Groq models change over time.

### 7.5 Batch runs (apply a taught workflow to a chosen set of items)

A workflow taught on one item (make one Discord channel private, delete one MEE6 ticket) can run over many items, but only the exact set I approve. The agent learns the *actions* from the demo and takes the *targets* as a parameter.

**Target selection modes** (can be combined):

| Mode | How it works | Example |
| --- | --- | --- |
| Pick on page | "Select targets" overlay adds a checkbox to each item in the list; the agent captures each item's stable ID | Tick 8 ticket rows in the MEE6 dashboard |
| Paste a list | Names or IDs, one per line, matched to items on the page | A list of channel names or IDs |
| Rule | A filter the agent resolves to a concrete list | Tickets closed over 7 days ago; channels starting with `private-` |
| Plain English | The agent converts the description into a list and shows it | "All tickets opened by users X and Y" |

**Run requirements:**

- **Resolve, preview, approve.** Before any step runs, the agent shows the final target list (name, ID, link) and the action to be applied. I can remove items, add items, or cancel. Nothing runs until I approve the exact list.
- **Stable identifiers.** Targets are stored by platform ID where one exists (for example the channel ID in a Discord URL, the ticket ID in MEE6), with the name as a secondary check. Positions in a list are never used as identity.
- **Pre-action check per item.** Before acting, the agent confirms it is on the right item (ID or name matches the approved target). On mismatch it stops and asks.
- **Post-action verification per item.** The agent checks the expected result (ticket gone, channel shows private, permission toggle saved) and records pass or fail.
- **Canary first.** Optional "run on the first item, then pause" mode so I can check the result before the rest proceed. On by default for destructive actions.
- **Caps and pacing.** Configurable maximum items per run and human-like delay between items, to limit damage from mistakes and reduce the chance of the site flagging automation.
- **Handling long and virtualized lists.** The agent scrolls and searches to bring each target into view, and re-resolves the list if the page reloads or items shift.
- **Failure policy.** Per workflow: stop on first failure (default), or skip failed items and report them at the end.
- **Undo log.** For reversible actions (permission changes), the agent records each item's previous state before changing it, so one click can restore the batch. Deletes are flagged irreversible and always require approval.
- **Resumable.** If the run is interrupted (worker killed, tab closed, browser restarted), it resumes from the first item not yet verified.
- **Report.** After the run: items succeeded, failed, skipped, and a downloadable log.

**Acceptance criteria:**

- A workflow taught on one item runs correctly on a different item without re-teaching.
- A batch never touches an item that is not on the approved list.
- A mismatch at any item halts the run before any action on that item.
- An interrupted batch resumes without repeating completed items.

## 8. UX and UI

Principles: **fast, calm, transparent, and keyboard-friendly.** The agent should feel like a capable assistant sitting beside the page, not a popup fighting it.

- **Side panel as the main surface** (`chrome.sidePanel`): persists across tab switches, never covers the page. Toolbar popup is just a quick launcher.
- **Command palette** (Cmd/Ctrl+K style, or a global shortcut): search workflows, run by name, start Record, ad hoc prompt.
- **Live run view:** step timeline with status icons (pending, running, done, needs approval, failed), the current action in plain language ("Clicking 'Export CSV'"), and a collapsible reasoning/observation detail.
- **On-page affordances:** a subtle highlight ring on the element being acted on, plus a small floating status chip (can be disabled for background runs). Never blocks interaction.
- **Approval cards:** inline in the side panel and as a browser notification when the panel is not visible. Approve / Edit / Skip / Stop.
- **Recording UI:** clear red recording state, live step list building as I act, one-click pause/resume, add-note button.
- **Workflow editor:** drag to reorder steps, edit step text, mark parameters, set sensitive flag, test a single step.
- **Modern visual design:** light and dark themes following system, tight 4/8px spacing scale, a single accent color, rounded cards, smooth micro-transitions (under 150ms), accessible contrast (WCAG AA), full keyboard navigation and screen-reader labels, reduced-motion support.
- **Empty states and onboarding:** a 60-second first-run flow: add API key, enable a site, record a sample workflow.
- **Errors that help:** every failure says what it tried, what it saw, and offers Retry, Take over, or Teach fix.

## 9. Architecture (high level)

- **Service worker (background):** orchestrator. Owns run state machine, provider calls, tab/window management, alarms, permissions.
- **Content script (per tab):** perception (DOM/accessibility snapshot, element indexing), action execution (click, type, select, scroll, key), recorder, on-page overlay.
- **Offscreen document:** keep-alive channel and heavy work that needs DOM APIs.
- **Side panel (React or Svelte + Tailwind):** UI for chat, recorder, library, run view, settings.
- **Storage:** `chrome.storage.local` for settings, IndexedDB for workflows and run logs, `chrome.storage.session` for in-flight run state.
- **Optional CDP layer:** `chrome.debugger` for trusted input, network waits, and screenshots when needed.

**Perception format.** Convert the page into a compact, numbered list of interactive and key text elements (role, name, text, state, index). The model returns actions by element index, which is cheaper, faster on Groq, and more reliable than raw HTML or pixel coordinates.

**Action tool schema (initial):** `click(index)`, `type(index, text, submit?)`, `select(index, value)`, `scroll(direction|index)`, `navigate(url)`, `wait_for(condition, timeout)`, `extract(schema)`, `open_tab(url)`, `switch_tab(id)`, `ask_user(question)`, `request_approval(summary)`, `done(result)`, `fail(reason)`.

**Workflow schema (sketch):**

```json
{
  "id": "wf_123",
  "name": "Export weekly report",
  "allowedDomains": ["dashboard.example.com"],
  "parameters": [{ "key": "range", "default": "7d" }],
  "steps": [
    {
      "intent": "Open the Reports page",
      "hints": { "url": "/reports", "selector": "a[href='/reports']", "text": "Reports" },
      "expect": "Page heading says Reports",
      "sensitive": false
    }
  ],
  "version": 3
}
```

## 10. Requirements

### Functional

- **FR1** Install and run in Chromium browsers on my existing profile with existing sessions.
- **FR2** Record a workflow by demonstration with optional notes; generate an editable, parameterized workflow.
- **FR3** Execute a workflow on a target tab with deterministic-first, model-fallback behavior.
- **FR4** Execute ad hoc natural-language instructions.
- **FR5** Continue running when the tab is backgrounded or the window is minimized.
- **FR6** Pause, resume, stop, and take over at any time; resume from last checkpoint.
- **FR7** Per-site enablement, confirmation gates for sensitive steps, step limits.
- **FR8** Provider-agnostic LLM layer with Groq as the default; swap via settings.
- **FR9** Local storage of workflows, logs, and keys; export/import workflows as JSON.
- **FR10** Run history with step-level audit trail.

### Non-functional

- Step latency (perceive to action) under 2s median on Groq for model-driven steps; near-instant for deterministic steps.
- Perception payload under about 4k tokens per step in typical pages (truncate and prioritize visible, interactive elements).
- No data leaves the browser except provider API calls.
- Minimal permissions at install; sensitive host access requested per site.
- Resilient to SPA navigation, iframes (same-origin first), shadow DOM, and dynamic content.

## 11. Success Metrics

- **Task success rate** on a set of 10 of my own real workflows: at least 80% unattended by end of v1.
- **Replay reliability:** at least 90% of recorded workflows still pass after a week without edits (self-healing working).
- **Teach-to-first-successful-run time:** under 5 minutes.
- **Median cost per run** and **median steps per run** tracked per workflow.
- **Interventions per run** trending down over time.

## 12. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Prompt injection from page content | Treat page as untrusted, domain allowlists, approval for off-script actions, never send secrets |
| Agent takes irreversible action wrongly | Sensitive-step gates, dry-run mode, step limits, full audit log |
| Sites reject synthetic events | CDP fallback via `chrome.debugger` per site |
| Service worker killed mid-run | Keep-alive, checkpointing, resumable runs |
| Background tab throttling or discard | Event-driven waits, dedicated window, Memory Saver exemptions, reload-and-resume |
| Site terms of service / anti-bot flags | Human-like pacing, personal-use scope, user responsibility noted in settings |
| Groq rate limits or model deprecations | Backoff, configurable models, easy provider swap |
| API key exposure | Local-only storage, never injected into page context, optional passphrase encryption |

## 13. Milestones

1. **M1: Foundation (week 1):** MV3 scaffold, side panel, settings, provider interface + Groq adapter, API key storage.
2. **M2: Perceive and act (week 2):** content-script snapshot and element indexing, action tools, ad hoc run loop with streaming and stop control.
3. **M3: Background reliability (week 3):** service-worker keep-alive, checkpointing, background/minimized testing, dedicated window mode.
4. **M4: Teach mode (weeks 4-5):** recorder, generalization prompt, workflow editor, parameters, library.
5. **M5: Safety and polish (week 6):** per-site permissions, approval gates, injection defenses, run history, onboarding, UI polish and accessibility pass.
6. **M6: Hardening (week 7+):** CDP fallback, self-healing, additional providers (OpenRouter, Ollama, Anthropic, Gemini), export/import.

## 14. Open Questions

- Which browser is the primary target (Chrome, Brave, Arc, Edge)? This affects side panel and debugger behavior.
- Is a vision model needed in v1, or is DOM/accessibility perception enough?
- Should runs be schedulable (recurring via `chrome.alarms`), or on-demand only for v1?
- How should secrets used inside workflows (e.g. a value to type) be handled: never stored, or an encrypted local vault?
- Dedicated automation window by default, or run in the tab I'm viewing?
- Framework preference for the side panel UI (React vs Svelte) and build tooling (Vite + CRXJS / WXT)?
