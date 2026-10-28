# 06 — LLM provider layer

## 6.1 `LLMProvider` interface (PRD §7.4 — verbatim contract)

```ts
export interface LLMProvider {
  readonly id: string;                        // "groq", "openai", "ollama", …
  readonly capabilities: {
    toolCalling: boolean; vision: boolean; jsonMode: boolean;
    maxContextTokens: number; maxOutputTokens?: number;
  };
  chat(params: ChatParams): Promise<ChatStream>;   // never a blocking full result
  embed?(params: { input:string[] }): Promise<number[][]>;  // optional, not used in v1
}

export type ChatParams = {
  messages: ChatMessage[];                    // { role, content?, toolCalls? , name? }
  tools?: ToolSpec[];                         // JSON-schema function-like
  toolChoice?: "auto" | "required" | { name: string };
  temperature?: number;
  maxTokens?: number; responseFormat?: { type: "json_object" };
  model?: string;                             // override per-role routing (bypasses default)
  signal?: AbortSignal;
};
export type ChatStream = AsyncIterable<StreamEvent>;
type StreamEvent =
  | { type:"text-delta"; text:string }
  | { type:"tool-call"; call: { id:string; name:string; argsJson:string } }   // may arrive split; provider assembles
  | { type:"usage"; inTok:number; outTok:number; inCostUsd?:number }
  | { type:"done" };
```

Implementations: `openai-compatible.ts` (Groq, OpenAI, OpenRouter, Together, Ollama/LM Studio),
which speaks SSE `chat/completions` including `tools`/`tool_calls` and streaming deltas. One adapter
for many providers, as PRD asks. Anthropic/Gemini native adapters deferred (M6 per PRD mins? — no:
PRD M6).

## 6.2 Config surface (saved in `settings.providers`)

```jsonc
{ "providers": {
    "groq":   { "baseUrl":"https://api.groq.com/openai/v1", "apiKeyRef":"key:groq",
                "modelSuggestions": ["qwen/qwen3.8-27b","qwen/qwen3.8-27b","meta-llama/llama-4-scout-17b-16e-instruct"] },
    "openai": { "baseUrl":"https://api.openai.com/v1", "apiKeyRef":"key:openai" },
    "ollama": { "baseUrl":"http://localhost:11434/v1", "apiKeyRef": null }
  },
  "activeProvider": "groq",
  "perRoleModel": { "planner": "…", "step": "…", "vision": null }
}
```

- Model names are plain strings, never hard-coded (PRD: "config, not hard-coded"). The settings UI
  fetches `/models` per provider when available and lets the user pick; unknown models are fine.
- There are two distinct call sites in the run loop: **plan/decide** and **step-execute**; each maps
  to `perRoleModel.*` (planner for stronger reasoning e.g. `llama-3.3-70b`, step for speed e.g.
  `llama-3.1-8b`). VisionModel only consulted when DOM-only perception won't reach the goal
  (v1: disabled by default).

## 6.3 Streaming lifecycle

```mermaid
sequenceDiagram
  participant SW as Service Worker
  participant P as Groq (OpenAI-compatible)
  SW->>P: POST /chat/completions (stream:true, tools)
  P-->>SW: SSE chunks
  SW->>SW: assemble text + tool_calls; forward deltas to panel (via port)
  SW->>SW: on finish_reason=tool_calls → parse args (zod) → execute op
```

- SSE parsed incrementally in the SW; deltas forwarded to the panel for the "reasoning" gutter
  (transparency, PRD §8) without storing raw stream blobs in IndexedDB logs (summarized only).
- `AbortController` kills provider calls on RUN_STOP and per-step timeout (config; default 60s).

## 6.4 Model errors and backoff

```ts
retry(status): status 429 → honor `Retry-After`; else exponential 250ms *1.8^n + jitter, max 4 tries.
status 400 …: keep open: Surface readable "system says model X doesn't support tool calling" to UI.
```

- On `404 model-not-found` → automatically mark provider capability map degraded and point the
  settings UI at it.
- On provider outage (network error, `5xx` × 2) → run **pauses automatically** with message
  "provider unreachable"; run resumes on retry (still holds reservations).

## 6.5 Tool calling deployment (action tools)

`llm/tools.ts` exports JSON-schema definitions matching `ActionOp` (docs/05). Deterministic-first
routing (workflow with matching anchor) bypasses planner; otherwise the SW calls the *step* model
with `tools` and `tool_choice:auto`; the **system** prompt includes the hardening rules in
[10-security.md](10-security.md#prompt-injection-defense).

## 6.6 Cost and usage tracking

- Every ChatStream yields a `usage` event; the SW accumulates `usage` counters into RunState,
  persisted per checkpoint. Median cost per run computed at run completion (pricing table in
  settings, model → $/M tokens; editable, default Groq listing).

## 6.7 Secrets are never sent to providers

Only page content from per-*snapshot* requests. Page content sent: tool schema requires page
message strings only; immutable redaction pass runs in the SW before `chat()`:
mask `input[value]` from `type="password"`, name matches `/card|ccn|cvc|cvv|ssn|token|secret|api[-_]?key/i`
in content-bound perception payloads (PRD §7.3). See 10-security.
