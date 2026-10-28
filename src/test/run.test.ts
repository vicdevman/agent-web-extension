import { describe, expect, it } from "vitest";
import { ActionOpSchema, opTargetHosts, isHttpUrl } from "../core/schema/action";
import { argsToActionOp } from "../background/op-map";
import { buildStepMessages } from "../llm/prompts/planner";

describe("ActionOp schema", () => {
  it("accepts a click with index + generation", () => {
    const op = ActionOpSchema.parse({ op: "click", step: 3, gen: 7 });
    expect(op.op).toBe("click");
  });

  it("rejects index-based ops without gen", () => {
    expect(() => ActionOpSchema.parse({ op: "click", step: 3 })).toThrow();
  });

  it("allows done without gen", () => {
    expect(ActionOpSchema.parse({ op: "done", result: "ok" }).op).toBe("done");
  });

  it("clamps wait_for timeout range", () => {
    expect(ActionOpSchema.parse({ op: "wait_for", kind: "text", pattern: "x", timeoutMs: 100 })).toBeDefined();
    expect(() =>
      ActionOpSchema.parse({ op: "wait_for", kind: "text", pattern: "x", timeoutMs: 99_999 }),
    ).toThrow();
  });
});

describe("opTargetHosts (domain gate)", () => {
  it("extracts hosts from navigate ops", () => {
    const op = ActionOpSchema.parse({ op: "navigate", url: "https://example.com/x" });
    expect(opTargetHosts(op)).toEqual(["example.com"]);
  });

  it("returns empty for index ops", () => {
    const op = ActionOpSchema.parse({ op: "click", step: 1, gen: 1 });
    expect(opTargetHosts(op)).toEqual([]);
  });

  it("ignores non-urls", () => {
    const op = ActionOpSchema.parse({ op: "navigate", url: "javascript:alert(1)" });
    expect(opTargetHosts(op)).toEqual([]);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("http://example.com")).toBe(true);
  });
});

describe("argsToActionOp (model tool calls → validated ops)", () => {
  it("maps click with index/gen", () => {
    const r = argsToActionOp("click", '{"index":4,"gen":9}');
    expect(r).toEqual({ op: "click", step: 4, gen: 9 });
  });

  it("rejects bad json and missing args", () => {
    expect(argsToActionOp("click", "{oops")).toHaveProperty("error");
    expect(argsToActionOp("click", '{"index":4}')).toHaveProperty("error"); // no gen
    expect(argsToActionOp("unknown_tool", "{}")).toHaveProperty("error");
  });

  it("maps wait_for with clamped timeout", () => {
    const r = argsToActionOp("wait_for", '{"kind":"text","pattern":"done","timeoutMs":60000}');
    expect(r).toMatchObject({ op: "wait_for", timeoutMs: 30000 });
  });

  it("maps done", () => {
    expect(argsToActionOp("done", '{"result":"exported"}')).toEqual({
      op: "done",
      result: "exported",
    });
  });
});

describe("step prompt hardening (docs/10 §10.2)", () => {
  it("wraps snapshot in untrusted delimiters and ships the injection rules", () => {
    const msgs = buildStepMessages({
      goal: "export the report",
      snapshot: "[1] button \"Export\"",
      priorActions: [],
    });
    const user = msgs.find((m) => m.role === "user")?.content ?? "";
    expect(user).toContain("PAGE_BEGIN");
    expect(user).toContain("GOAL: export the report");
    const sys = msgs.find((m) => m.role === "system")?.content ?? "";
    expect(sys).toContain("untrusted visitor data");
    expect(sys).toContain("NEVER invent element indices");
  });

  it("includes the last 3 prior actions (docs/07 §7.4)", () => {
    const prior = [1, 2, 3, 4, 5].map((n) => ({
      seq: n,
      ts: n,
      kind: "action" as const,
      text: `action ${n}`,
    }));
    const msgs = buildStepMessages({ goal: "g", snapshot: "s", priorActions: prior });
    const user = msgs[1].content ?? "";
    expect(user).toContain("action 3");
    expect(user).toContain("action 5");
    expect(user).not.toContain("action 1");
  });
});
