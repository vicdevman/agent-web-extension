import { z } from "zod";

/** Run state (docs/03 §3.2) — M2 covers ad hoc runs; workflow/batch fields arrive in M4/M5. */

export const RunStatusSchema = z.enum([
  "running",
  "paused",
  "awaiting_approval",
  "completed",
  "failed",
  "stopped",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const TimelineEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  ts: z.number().int(),
  kind: z.enum(["observation", "plan", "action", "result", "approval", "error", "info"]),
  text: z.string(),
  detail: z.string().optional(),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const RunStateSchema = z.object({
  id: z.string().startsWith("run_"),
  kind: z.enum(["adhoc", "workflow", "batch"]),
  instruction: z.string(),
  status: RunStatusSchema,
  targetTabId: z.number().nullable(),
  startedAt: z.number().int(),
  endedAt: z.number().int().nullable(),
  steps: z.array(TimelineEventSchema),
  usage: z.object({ inTok: z.number(), outTok: z.number() }),
  stepAttempt: z.number().int().nonnegative(), // guards.maxSteps budget counter
  repeatSig: z.array(z.string()), // loop-detection window (docs/07 §7.1)
  provider: z.string(),
  modelStep: z.string(),
  error: z.string().nullable(),
});
export type RunState = z.infer<typeof RunStateSchema>;

export const RUN_SESSION_KEY_PREFIX = "run:";

/** Snapshot wire type shared between SW and content script (docs/05 §5.2). */
export const SnapshotSchema = z.object({
  gen: z.number().int(),
  snapshot: z.string(),
  url: z.string(),
  title: z.string(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export type ActionResult =
  | { ok: true; data?: string }
  | { ok: false; reason: string; code?: "STALE" | "NOTFOUND" | "UNTRUSTED" | "FAILED" };
