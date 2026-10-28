# Teachable Browser Agent Extension — Engineering Docs

Documentation for building the extension described in `PRD Teachable Browser Agent Extension.md`
(author: Victor Adeiza, Draft v0.1, Oct 25 2026). Docs are the source of truth for how we build it;
the PRD is the source of truth for **what** we build.

## Reading order

| Doc | What it covers |
| --- | --- |
| [01-overview.md](01-overview.md) | One-page summary, scope, success criteria |
| [02-architecture.md](02-architecture.md) | Processes, components, module map, data flow diagrams |
| [03-data-models-and-storage.md](03-data-models-and-storage.md) | Workflow / run / settings schemas, IndexedDB + storage design, migration/versioning |
| [04-message-protocol.md](04-message-protocol.md) | Typed message contracts between every process |
| [05-perception-and-actions.md](05-perception-and-actions.md) | DOM snapshot → indexed element list, element resolution, action execution, CDP fallback |
| [06-llm-provider-layer.md](06-llm-provider-layer.md) | `LLMProvider` interface, Groq adapter, streaming, tool calling, rate limits |
| [07-run-loop.md](07-run-loop.md) | Run state machine, deterministic-first logic, keep-alive, checkpointing, resume |
| [08-teach-mode.md](08-teach-mode.md) | Recorder event capture, generalization prompt, workflow editor |
| [09-batch-runs.md](09-batch-runs.md) | Target selection, approve-list, canary, undo log, resumability |
| [10-security.md](10-security.md) | Permission model, prompt-injection defense, secrets handling |
| [11-ui-ux.md](11-ui-ux.md) | Side panel IA, components, design tokens, accessibility |
| [12-tech-decisions.md](12-tech-decisions.md) | ADRs — stack choices and resolved PRD open questions |
| [13-implementation-plan.md](13-implementation-plan.md) | Phased build plan with tasks, file map, acceptance criteria |
| [14-testing-and-evals.md](14-testing-and-evals.md) | Unit/integration/E2E strategy + the 10-workflow eval harness |
| [15-setup-guide.md](15-setup-guide.md) | Install, configure, site grants, running/controlling the agent, troubleshooting |

## Conventions

- Target baseline: **Chromium 120+** (Chrome, Brave, Edge, Arc).
- All code TypeScript, strict mode. All runtime data boundaries validated with **zod**.
- Diagrams use Mermaid and render in GitHub/VS Code.
- Status markers in docs: `DECIDED`, `OPEN`, `ASSUMED`.
