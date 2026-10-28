# 11 — UI/UX

Principles from PRD §8: **fast, calm, transparent, keyboard-friendly.** Capable assistant beside the
page, not a popup fighting it.

## 11.1 Information architecture (side panel routes)

```
Chat/Run          ← default: command input, active run timeline, approvals
Library           ← workflow cards: name, last run, success rate, ▸ Run / Edit / Duplicate / Delete
Editor            ← step list, drag reorder, params, sensitive toggles, step tests
Runs History      ← run list → run detail (timeline + audit trail + export JSON/CSV)
Recorder          ← recording banner (red dot), live step list, notes, pause/resume
Settings          ← providers & models per role, API keys, sites & permissions, safety limits,
                    appearance (system/light/dark), shortcuts
```

Toolbar popup = thin launcher: last 3 workflows, Record button, open panel, stop-all button.
Also: `chrome.action.setBadgeText` "●" while any run is active (PRD §7.2), red dot while recording,
"!" badge when an approval is waiting.

## 11.2 Live run view

- Step timeline: statuses `pending · running · done · needs approval · failed` (PRD).
- Current action sentence: "Clicking 'Export CSV'" — from the step intent + resolved element name.
- Collapsible "What it saw / reasoning" per step (snapshot excerpt + tool args + verification result).
- Footer controls: Pause ▸ Resume ▸ Take Over ▸ Stop; step counter and elapsed.

## 11.3 On-page affordances

- Highlight ring: 2px accent outline (well outside click handler z-order, `pointer-events:none`,
  `position:fixed` coords from `CS_RECT_FOR_INDEX`). Animated scale ~ 150ms max (PRD micro-transitions
  cap ≤ 150ms), respects `prefers-reduced-motion`.
- Status chip (bottom-right): "Agent · step 4/12 · Export CSV" + inline Stop button. Disable toggle
  for background runs (chip can be noisy in minimized states).
- "Select targets" overlay for batch — adds labels + checkboxes without changing handlers.
  Overlay is a shadow-DOM root appended after content-script bootz, an overlay that is always
  dismissible via Esc.

## 11.4 Command palette (headless UX)

`:Ctrl+K` opens a modal over the side panel: type to filter: workflows, "record", "ad hoc", "stop
run". Enter runs. Also works from popup hint and the global `command` shortcut
(`commands` in manifest so it works when panel is closed).

## 11.5 Approval cards

Inline card in the run view + browser notification when panel is not focused. Actions:
**Approve / Edit / Skip / Stop** (PRD §7.3). Notifications deep-link to open the panel.

## 11.6 Design system

- Tokens: spacing 4/8, radius 10/14, single accent (`#6C5CE7` pending review), neutrals,
  semantic `success/warn/danger`, light/dark via `prefers-color-scheme` + manual override,
  WCAG AA (≥4.5:1 body, ≥3:1 large).
- Type: system stack (Inter first? no — bundled stack: `system-ui, -apple-system, Segoe UI, Roboto`),
  no webfont fetch (privacy, docs/10 §10.5).
- Micro-transitions: opacity/transform only, 120–150ms, disabled under reduced-motion.
- Keyboard: full tab order, visible focus, panel shortcuts (`Ctrl+K`, `Esc`, `Enter` on cards);
  screen-reader labels via aria-live for step events.
- Empty states & 60-second onboarding (PRD §8): key → enable site → record sample → succeed; each
  state must be skippable and truncatable.

## 11.7 Errors that help (PRD §8)

Every failure renders three lines: **what it tried** (the op), **what it saw** (key evidence from
the snapshot / verification), and three buttons: **Retry · Take over · Teach fix**.

## 11.8 Onboarding flow

Run once before batch feature; content: (1) what this is/not (privacy line), (2) Groq key,
(3) enable site, (4) 60-sec sample record.
