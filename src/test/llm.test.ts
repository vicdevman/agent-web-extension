import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "../llm/openai-compatible";
import { HttpError, withBackoff } from "../llm/backoff";

const enc = new TextEncoder();

function sseResponse(lines: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const BASE = { id: "test", baseUrl: "https://api.test/v1", apiKey: "sk-x" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAICompatibleProvider.chat (SSE)", () => {
  it("assembles text deltas, tool calls and usage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":" there"}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"click","arguments":"{\\"step\\""}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":": 1}"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
          'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
    );
    const p = new OpenAICompatibleProvider(BASE);
    const events: string[] = [];
    const texts: string[] = [];
    const stream = await p.chat({
      messages: [{ role: "user", content: "click it" }],
      model: "m1",
    });
    for await (const ev of stream) {
      if (ev.type === "text-delta") texts.push(ev.text);
      if (ev.type === "tool-call") events.push(`${ev.call.name}${ev.call.argsJson}`);
      if (ev.type === "usage") events.push(`usage:${ev.inTok}/${ev.outTok}`);
      if (ev.type === "done") events.push("done");
    }
    expect(texts.join("")).toBe("Hi there");
    expect(events).toContain("click{\"step\": 1}");
    expect(events).toContain("usage:10/5");
    expect(events).toContain("done");
  });

  it("throws HttpError with Retry-After parsed on 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "2" },
        }),
      ),
    );
    const p = new OpenAICompatibleProvider(BASE);
    let caught: unknown;
    try {
      const stream = await p.chat({ messages: [], model: "m" });
      for await (const _ of stream) void _;
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ status: 429, retryAfterMs: 2000 });
  });
});

describe("withBackoff", () => {
  it("retries transient 429 and succeeds", async () => {
    let calls = 0;
    const out = await withBackoff(
      async () => {
        calls++;
        if (calls < 3) throw new HttpError(429, "slow down");
        return "ok";
      },
      { baseDelayMs: 1, jitterMs: 1, maxRetries: 4 },
    );
    expect(out).toBe("ok");
    expect(calls).toBe(3);
  });

  it("does not retry 4xx", async () => {
    let calls = 0;
    await expect(
      withBackoff(
        async () => {
          calls++;
          throw new HttpError(400, "bad");
        },
        { baseDelayMs: 1, jitterMs: 1 },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(1);
  });

  it("gives up after maxRetries", async () => {
    let calls = 0;
    await expect(
      withBackoff(
        async () => {
          calls++;
          throw new HttpError(429, "slow");
        },
        { baseDelayMs: 1, jitterMs: 1, maxRetries: 2 },
      ),
    ).rejects.toBeInstanceOf(HttpError);
    expect(calls).toBe(3); // 1 try + 2 retries
  });
});
