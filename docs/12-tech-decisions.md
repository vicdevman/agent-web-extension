# 12 — Technology decisions (ADRs)

Status markers: **DECIDED** / **OPEN** / **ASSUMED**.

## ADR-00 — Repo layout: docs-first ✅

`docs/` precedes code. All engineering decisions trace to a PRD line here.

## ADR-01 — Framework: **WXT** (DECIDED)

Chosen over Vite+CRXJS and rollup-manual because WXT is MV3-native: generates the manifest from
typed config (`defineBackground`, `defineContentScript`), handles HMR into MV3 (unbuildable in bare
Vite, since SW termination breaks Vite WS), clean dev/prod modes. Same DX quality as Next-style
embeddings for extensions. Alternative considered: CRXJS (maintenance slowed down), manual
(no HMR; risk of manifest drift).

## ADR-02 — Side panel framework: **React 18 + Tailwind + Zustand** (DECIDED)

PRD lists React or Svelte and leaves it open. Chosen React because: larger ecosystem for sidepanel
components, our agent work shares mental model with typical LLM UIs, HMR is WXT-supported.
Zustand instead of Redux: minimal, plays cleanly with SW-subscription patches. Tailwind for the
design-token workflow (11.6). Svelte remains viable later but consistency wins.

## ADR-03 — Language: **TypeScript strict** (DECIDED, given PRD is silent)

All subsystems (content/SW/panel) share `core/`. zod schemas double as runtime validators and
typescript-first source of truth. No JS modules.

## ADR-04 — Target browser: **Chromium 120+** (DECIDED — resolves PRD open question)

Baseline chosen ≥120 to lock in: alarms 30s min (Chrome 120), debugger-keeps-worker-alive
(118+), sidePanel stable (114+), MV3+offscreen mature. PRD asked which is primary; answer: **Chrome**,
tested also on Brave/Edge (identical baseline; Arc = Chrome forks).

## ADR-05 — Perception: DOM-traversal based indexed list, **a11y tree not used as primary in v1** (ASSUMED → verify in M2)

`window.getComputedAccessibleNode` is not reliably available; building our own semantic pass on DOM
(-role from tag/aria, accName from aria-label/label-for/alt/text) is deterministic and returns the
same compact list the model needs. Accessibility-tree perception (CDP Accessibility.getFullAXTree) is
the fallback if our heuristic misses contexts in M2 testing. Vision optional and off per PRD §5
("Prefer DOM and accessibility-tree perception over screenshots in v1").

## ADR-06 — Scheduling: runs **on demand only in v1** (DECIDED — resolves PRD open question)

`chrome.alarms` scheduling (recurring runs) is classified as M6 stretch: data model already stores
run definitions so adding schedules later doesn't break anything.

## ADR-07 — Secrets: local plaintext + optional passphrase encryption (DECIDED)

Per PRD §7.4: "Bring your own key, stored locally. Optional encryption with a passphrase." Plaintext
is the default state (all browser storage is user-readable), passphrase-encryption offered at
onboarding for TLS-fear users. Encrypted vault never leaves the browser (docs 10 §10.3).

## ADR-08 — Dedicated automation window default: **off** (ASSUMED until M3 testing)

Runs happen in the current tab by default (matches the mental model of "activate and watch"), but a
one-click toggle in the run card moves the run to a dedicated minimized window (their usefulness
proves out in M3, where PRD suggests option; in that case the default flips to dedicated with the
user's consent at the run-start panel prompt). Final answer decided by M3 benchmarks.

## ADR-09 — Storage layer per role (DECIDED, see docs/03):

- `chrome.storage.local` → settings, secrets, content.small caches.
- `chrome.storage.session` → in-flight run state (survives SW death, cleared on browser restart).
- IndexedDB → workflows, run history, batch undo log (browser-restart durable).
- Never `chrome.storage.sync` for secrets or workflows >8KB quota risk.

## ADR-10 — Package manager: **npm**, Node ≥ 20 (DECIDED)

WXT-friendly, zero-config on Windows (PRD owner uses Windows).

## ADR-11 — Test framework: **Vitest** (unit + contracts) and **Playwright-with-MV3** (E2E) (DECIDED)

Playwright loads unpacked MV3; we own a small harness to bootstrap a side panel + a local test site
(`docs/14` details). Evals (10 workflows) recorded as JSON fixtures.
