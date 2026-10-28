import { describe, expect, it } from "vitest";
import { SettingsSchema, DEFAULT_SETTINGS, PROVIDER_PRESETS } from "../core/schema/settings";
import { WorkflowSchema } from "../core/schema/workflow";
import { MsgEnvelopeSchema, makeMsg } from "../core/schema/message";
import { isCompleteJson, toWireMessages, buildRequestBody } from "../llm/openai-compatible";

describe("settings schema", () => {
  it("parses the defaults", () => {
    const s = SettingsSchema.parse(structuredClone(DEFAULT_SETTINGS));
    expect(s.activeProvider).toBe("groq");
    expect(Object.keys(s.providers)).toContain("groq");
  });

  it("rejects unknown provider role models types", () => {
    const bad = { ...structuredClone(DEFAULT_SETTINGS), perRoleModel: { planner: 1, step: 2 } };
    expect(() => SettingsSchema.parse(bad)).toThrow();
  });

  it("official preset urls are valid", () => {
    expect(PROVIDER_PRESETS.groq.baseUrl).toMatch(/^https:\/\/api\.groq\.com/);
  });
});

describe("workflow schema", () => {
  it("requires wf_ id and ≥1 step", () => {
    const wf = {
      id: "wf_test1",
      name: "T",
      steps: [{ id: "st_1", intent: "do the thing" }],
      version: 3,
      createdAt: 1,
      updatedAt: 2,
    };
    const parsed = WorkflowSchema.parse(wf);
    expect(parsed.steps[0].sensitive).toBe(false); // default applied
    expect(() => WorkflowSchema.parse({ ...wf, steps: [] })).toThrow();
    expect(() => WorkflowSchema.parse({ ...wf, id: "run_bad" })).toThrow();
  });
});

describe("message envelope", () => {
  it("round-trips", () => {
    const msg = makeMsg("SETTINGS_GET", {});
    expect(MsgEnvelopeSchema.parse(msg).type).toBe("SETTINGS_GET");
  });
});

describe("llm wire helpers", () => {
  it("detects complete json", () => {
    expect(isCompleteJson('{"a": 1}')).toBe(true);
    expect(isCompleteJson('{"a": "x{y}z"}')).toBe(true);
    expect(isCompleteJson('{"a": 1')).toBe(false);
    expect(isCompleteJson('{"a": [1, 2')).toBe(false);
  });

  it("converts tool messages", () => {
    expect(toWireMessages([{ role: "tool", toolCallId: "t1", content: "done" }])).toEqual([
      { role: "tool", tool_call_id: "t1", content: "done" },
    ]);
  });

  it("builds a streaming body with usage", () => {
    const body = buildRequestBody(
      { messages: [{ role: "user", content: "hi" }] },
      "qwen/qwen3.8-27b",
    );
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.model).toBe("qwen/qwen3.8-27b");
  });
});
