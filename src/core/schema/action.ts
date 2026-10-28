import { z } from "zod";

/**
 * ActionOp — the canonical action vocabulary (docs/05 §5.4).
 * The LLM addresses elements by INDEX only, and must echo back the snapshot
 * generation (gen) it was acting on — stale generations are rejected (docs/05 §5.3).
 */

export const ActionOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("click"), step: z.number().int().nonnegative(), gen: z.number().int() }),
  z.object({
    op: z.literal("type"),
    step: z.number().int().nonnegative(),
    gen: z.number().int(),
    text: z.string(),
    submit: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("select"),
    step: z.number().int().nonnegative(),
    gen: z.number().int(),
    value: z.string(),
    by: z.enum(["label", "value"]).optional(),
  }),
  z.object({
    op: z.literal("scroll"),
    direction: z.enum(["up", "down", "into"]),
    step: z.number().int().nonnegative().optional(),
    gen: z.number().int().optional(),
  }),
  z.object({ op: z.literal("navigate"), url: z.string().min(1) }),
  z.object({
    op: z.literal("wait_for"),
    kind: z.enum(["selector", "text", "url", "gone"]),
    pattern: z.string().min(1),
    timeoutMs: z.number().int().min(100).max(30_000),
  }),
  z.object({ op: z.literal("extract"), limit: z.number().int().min(1).max(50).optional() }),
  z.object({ op: z.literal("open_tab"), url: z.string().min(1) }),
  z.object({ op: z.literal("switch_tab"), tabId: z.number().int() }),
  z.object({
    op: z.literal("key"),
    key: z.string().min(1),
    step: z.number().int().nonnegative().optional(),
    gen: z.number().int().optional(),
  }),
  z.object({ op: z.literal("ask_user"), question: z.string().min(1) }),
  z.object({ op: z.literal("request_approval"), summary: z.string().min(1) }),
  z.object({ op: z.literal("done"), result: z.string().default("") }),
  z.object({ op: z.literal("fail"), reason: z.string().min(1) }),
]);

export type ActionOp = z.infer<typeof ActionOpSchema>;

/** Ops the SW executes itself (tab/window management) vs ops delegated to the content script. */
export const SW_OPS = ["navigate", "open_tab", "switch_tab"] as const;

/** PRD §7.3: the agent cannot act on domains outside the allowlist without approval.
 * ad hoc runs get the target tab's origin; workflow runs get workflow.allowedDomains. */
export function opTargetHosts(op: ActionOp): string[] {
  switch (op.op) {
    case "navigate":
    case "open_tab": {
      const host = safeHost(op.url);
      return host ? [host] : [];
    }
    default:
      return [];
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

export function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
