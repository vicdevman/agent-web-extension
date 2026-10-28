import { HttpError, NetworkError, parseRetryAfter, withBackoff } from "./backoff";
import type {
  ChatMessage,
  ChatParams,
  LLMProvider,
  ProviderCapabilities,
  StreamEvent,
  ToolCall,
  ToolSpec,
} from "./types";

/**
 * OpenAI-compatible streaming adapter — one implementation for Groq, OpenAI, OpenRouter,
 * Together, Ollama/LM Studio (docs/06 §6.1). Speaks SSE `chat/completions` with tools,
 * assembling fragmented tool_call deltas into single ToolCall events.
 */

export interface OpenAICompatibleConfig {
  id: string;
  baseUrl: string;
  apiKey: string | null;
  headers?: Record<string, string>;
  capabilities?: Partial<ProviderCapabilities>;
  /** Per-provider client hints; harmless unknown headers are tolerated by these APIs. */
}

const DEFAULT_CAPS: ProviderCapabilities = {
  toolCalling: true,
  vision: false,
  jsonMode: true,
  maxContextTokens: 32_000,
};

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly extraHeaders: Record<string, string>;

  constructor(cfg: OpenAICompatibleConfig) {
    this.id = cfg.id;
    this.baseUrl = stripTrailingSlash(cfg.baseUrl);
    this.apiKey = cfg.apiKey;
    this.extraHeaders = cfg.headers ?? {};
    this.capabilities = { ...DEFAULT_CAPS, ...(cfg.capabilities ?? {}) };
  }

  async *chat(params: ChatParams): AsyncGenerator<StreamEvent> {
    const res = await openStream(this.baseUrl, this.apiKey, this.extraHeaders, params);
    if (!res.ok || res.body === null) {
      const text = await res.text().catch(() => "");
      throw new HttpError(res.status, text, parseRetryAfter(res.headers.get("Retry-After")));
    }
    if (res.headers.get("Content-Type")?.includes("text/event-stream")) {
      yield* parseSSE(res, params.signal);
      return;
    }
    // Provider answered non-streaming (e.g. misconfigured or stream rejected) — parse JSON body.
    const bodyText = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      throw new HttpError(res.status, bodyText);
    }
    if (res.status >= 400) throw new HttpError(res.status, bodyText);
    yield* emitFromCompletion(parsed);
  }
}

type CompletionChoiceMessage = {
  role?: string;
  content?: string | null;
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
};

/** Convert our ChatMessages into OpenAI wire format. */
export function toWireMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.toolCallId, content: m.content ?? "" };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content ?? null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.argsJson },
        })),
      };
    }
    return { role: m.role, content: m.content ?? null };
  });
}

export function buildRequestBody(params: ChatParams, model: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: toWireMessages(params.messages),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (params.tools?.length) {
    body.tools = params.tools;
    if (params.toolChoice) body.tool_choice = params.toolChoice;
  }
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
  if (params.responseFormat) body.response_format = params.responseFormat;
  return body;
}

async function openStream(
  baseUrl: string,
  apiKey: string | null,
  extraHeaders: Record<string, string>,
  params: ChatParams,
): Promise<Response> {
  const model =
    params.model ??
    "qwen/qwen3.8-27b"; // caller must pass model; this fallback keeps old callers alive

  return withBackoff(async () => {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...extraHeaders,
        },
        body: JSON.stringify(buildRequestBody(params, model)),
        signal: params.signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new NetworkError(e); // 429-class/5xx/network → retried per docs/06 §6.4
    }
    return res;
  }, { signal: params.signal });
}

/** Read an SSE stream, yield assembled StreamEvents. */
async function* parseSSE(
  res: Response,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let usage: { inTok: number; outTok: number } | null = null;

  // Tool-call assembly across chunked deltas (OpenAI wire format).
  const pendingCalls = new Map<number, { id: string; name: string; argsJson: string }>();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        let line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line.startsWith("data:")) line = line.slice(5).trim();
        if (!line || line === "[DONE]") continue;
        let chunk: {
          choices?: Array<{
            delta?: { content?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
            finish_reason?: string | null;
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        } | null = null;
        try {
          chunk = JSON.parse(line);
        } catch {
          continue; // keepalive/comment lines from some providers
        }
        if (chunk?.usage) {
          usage = {
            inTok: chunk.usage.prompt_tokens ?? 0,
            outTok: chunk.usage.completion_tokens ?? 0,
          };
        }
        const delta = chunk?.choices?.[0]?.delta;
        if (delta?.content) yield { type: "text-delta", text: delta.content };

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const cur = pendingCalls.get(tc.index) ?? { id: "", name: "", argsJson: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name += tc.function.name;
            if (tc.function?.arguments) cur.argsJson += tc.function.arguments;
            pendingCalls.set(tc.index, cur);
            // Groq/OpenAI stream tool calls fragment-by-fragment; full call emitted when the
            // underlying call object reaches a complete JSON document.
            if (isCompleteJson(cur.argsJson)) {
              pendingCalls.delete(tc.index);
              yield { type: "tool-call", call: cur as ToolCall };
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Emit any calls left over (stream ended before a clean fragment boundary).
  for (const call of pendingCalls.values()) {
    yield { type: "tool-call", call };
  }
  if (usage) yield { type: "usage", inTok: usage.inTok, outTok: usage.outTok };
  yield { type: "done" };
  void 0;
}

/** Soft JSON completeness check used to flush tool-call deltas mid-stream. */
export function isCompleteJson(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  // count unescaped braces/brackets outside strings
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  return depth === 0 && !inStr && (t.charCodeAt(0) === 0x7b || t.charCodeAt(0) === 0x5b);
}

function* emitFromCompletion(parsed: unknown): Generator<StreamEvent> {
  const body = parsed as {
    choices?: Array<CompletionChoiceMessage extends never ? never : { message?: CompletionChoiceMessage }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const msg = body.choices?.[0]?.message;
  const calls: ToolCall[] = (msg?.tool_calls ?? []).map((tc, i) => ({
    id: tc.id ?? `call_${i}`,
    name: tc.function?.name ?? "",
    argsJson: tc.function?.arguments ?? "{}",
  }));
  yield {
    type: "message",
    message: {
      role: "assistant",
      content: msg?.content ?? "",
      toolCalls: calls.length ? calls : undefined,
    },
  };
  for (const c of calls) yield { type: "tool-call", call: c };
  if (body.usage) {
    yield {
      type: "usage",
      inTok: body.usage.prompt_tokens ?? 0,
      outTok: body.usage.completion_tokens ?? 0,
    };
  }
  yield { type: "done" };
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Helper for the factory in llm/index.ts. */
export function openAICompatible(cfg: OpenAICompatibleConfig): LLMProvider {
  return new OpenAICompatibleProvider(cfg);
}

/** ToolSpec passthrough for consumers constructing tool definitions (docs/06 §6.5). */
export type { ToolSpec };
