# 14 — Testing and evaluation

Three layers: **unit / integration (in-Vitest)**, **E2E browser (Playwright + MV3)**, and
**evaluations (real-workflow scorecard)**.

## 1. Unit tests (Vitest)

| Target | Cover |
| --- | --- |
| `core/schema/*` | zod round-trip: valid/invalid payloads, version migration paths |
| `perception` compiler | fixture DOM strings → indexed snapshot: shadow DOM, iframes, virtualized truncation, ordering stability, ≤ 4k tokens |
| anchor scorer | selector/text/role matching ranking, stale-gen rejection |
| `openai-compatible` | SSE parsing (incl. split tool_call deltas), 429 Retry-After handling, abort |
| backoff policy | jitter bounds, max retries, hard-pause after 5 fails/60s |
| run-manager pure fns | guard evaluation (budget, repeat detection, domain allowlist) |
| generalizer | sample recordings → WorkflowDraft validation, sensitive tagging proposals |

DOM fixtures live as raw HTML strings; jsdom where cheap, real Chromium where jsdom diverges
(e.g. `getComputedAccessibleNode`-adjacent, pointer event paths).

## 2. E2E (Playwright, `chromium.launchPersistentContext` with `--load-extension`)

- Harness boots: extension unpacked → open side panel page URL directly → drive panel UI.
- Local test site (`testing/fixtures/site/` static pages): a form, an export button, a list,
  a settings page — no cloud dependencies; the same fixtures run in CI.
- Threads to verify:
  - chat roundtrip with a **mock provider** (local SSE server) so E2E never touches the network;
  - ad-hoc run on the fixture site end-to-end;
  - teach → save → run (the 5-minute gate automated);
  - background-run test: switch focus/minimize window via CDP, assert run completes.
- SW lifecycle chaos test: `chrome://serviceworker-internals → Stop` mid-run (or programmatic
  `worker.terminate()` equivalent), then resume-from-checkpoint must complete the run.

## 3. Evaluation harness (drives PRD §11 metrics)

- `evals/workflows/*.json` — 10 real workflows captured by the owner up-front as fixtures with
  per-step expectations; replayed on schedule (manual M2+; later, optional alarm-triggered).
- Scorecard CLI (`scripts/eval.ts`): runs each workflow N times, emits markdown report:
  success %, unattended %, steps, latency p50/p95, token cost, fallback rate (deterministic vs LLM),
  interventions per run. Trend tracked across phases; the P4 replay-reliability gate (≥90% after
  one week) and P6 self-healing targets are read from this report.

## 4. Security test checklist (must be manual-auditable)

- [ ] Page containing `<script>`-like instructions + a "click approve" message — must surface as
      `request_approval`, never execute (docs/10 §10.2, prompt-injection).
- [ ] Workflow domain allowlist — agent cannot navigate to a URL outside of it even when the
      snapshot suggests it (SW validator in chain-of-custody).
- [ ] Snapshot redaction — password/autocomplete-cc/regex-named values masked before any LLM call;
      run-log contains the masked form too.
- [ ] API key never present in: content script world, panel bundle, IndexedDB plaintext.
- [ ] No remote code: bundle grep for `http(s)://` script/CSS/font references → zero.

## 5. Browser-compatibility smoke matrix (per PRD §4)

| Browser | Side panel | SW keepalive | debugger banner |
| --- | --- | --- | --- |
| Chrome 120+ | ✅ required | ✅ | ✅ |
| Edge | ✅ | ✅ | ✅ |
| Brave (shield mode) | ⚠️ test | ✅ | ✅ |
| Arc | ⚠️ visual | ✅ | ✅ |

## 6. Quality gates to v1

| Metric (PRD §11) | Where measured | Gate |
| --- | --- | --- |
| ≥80% unattended success | eval scorecard | P5 |
| ≥90% replay-after-week | eval scorecard | P6 |
| Teach→run < 5min | onboarding instrumentation + manual | P4 |
| Median step latency < 2s (model steps) | run usage telemetry (local) | P2 |
| Perception ≤ ~4k tokens | unit fixture test | P2 |
| 0 non-provider egress | security checklist | P5 |
