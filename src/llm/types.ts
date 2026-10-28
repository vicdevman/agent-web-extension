/**
 * LLMProvider interface — PRD §7.4 verbatim contract:
 *   chat({ messages, tools, temperature, signal }) -> stream of { text | toolCall | usage }
 *   capabilities: { toolCalling, vision, jsonMode, maxContext }
 * Implementations: OpenAI-compatible (Groq/OpenAI/OpenRouter/Together/Ollama) in
 * openai-compatible.ts. Anthropic/Gemini native adapters deferred (docs/12 ADR/M6).
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content?: string | null;
  /** Assistant tool calls (when replaying a prior assistant turn). */
  toolCalls?: Array<{ id: string; name: string; argsJson: string }>;
  /** For role "tool": the originating tool_call id. */
  toolCallId?: string;
}

export interface ToolSpec {
  type: "function";
  function: { name: string; description?: string; parameters: unknown };
}

export interface ToolCall {
  id: string;
  name: string;
  argsJson: string;
}

export type StreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; call: ToolCall } // assembled full call (provider merges fragmented deltas)
  | { type: "message"; message: ChatMessage } // final assembled assistant message
  | { type: "usage"; inTok: number; outTok: number; inCostUsd?: number }
  | { type: "done" };

export interface ChatParams {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  toolChoice?: "auto" | "required" | { type: "function"; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: "json_object" };
  /** Overrides the per-role routing for this single call (docs/06 §6.2). */
  model?: string;
  signal?: AbortSignal;
}

export interface ProviderCapabilities {
  toolCalling: boolean;
  vision: boolean;
  jsonMode: boolean;
  maxContextTokens: number;
  maxOutputTokens?: number;
}

export interface LLMProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  chat(params: ChatParams): AsyncGenerator<StreamEvent>;
}
