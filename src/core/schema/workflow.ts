import { z } from "zod";

/**
 * Workflow definition — generalized, parameterized (PRD §7.1, §9 sketch).
 * Full data-model rationale lives in docs/03-data-models-and-storage.md §3.1.
 */
export const AnchorSchema = z
  .object({
    selector: z.string().optional(),
    text: z.string().optional(),
    role: z.string().optional(),
    name: z.string().optional(),
    urlInclude: z.string().optional(),
  })
  .refine((a) => Object.values(a).some((v) => v !== undefined), { message: "empty anchor" });
export type Anchor = z.infer<typeof AnchorSchema>;

export const WorkflowStepSchema = z.object({
  id: z.string(),
  intent: z.string().min(1), // natural-language step description
  anchors: AnchorSchema.optional(), // deterministic-first hints (docs/07 §7.2)
  expected: z.string().optional(),
  sensitive: z.boolean().default(false),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowParameterSchema = z.object({
  key: z.string(),
  label: z.string().default(""),
  type: z.enum(["string", "number", "boolean"]).default("string"),
  default: z.string().default(""),
});

export const WorkflowSchema = z.object({
  id: z.string().startsWith("wf_"),
  name: z.string().min(1),
  description: z.string().default(""),
  allowedDomains: z.array(z.string()).default([]), // gate for navigation-type actions (docs/10 §10.1)
  parameters: z.array(WorkflowParameterSchema).default([]),
  steps: z.array(WorkflowStepSchema).min(1),
  sensitiveActionGate: z.enum(["always", "ask", "off"]).default("ask"),
  version: z.literal(3),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type Workflow = z.infer<typeof WorkflowSchema>;
