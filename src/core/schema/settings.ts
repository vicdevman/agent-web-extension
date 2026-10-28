import { z } from "zod";

/** Secrets live in a separate chrome.storage.local key, never synced, never in settings. */
export const SECRETS_KEY = "secrets";
export const SecretsSchema = z.record(z.string(), z.string().min(1)); // providerId -> apiKey plaintext (M1; passphrase encryption = P5, docs/10 §10.3)
export type Secrets = z.infer<typeof SecretsSchema>;

export const ProviderConfigSchema = z.object({
  baseUrl: z.string().min(1),
  /** Reference into `secrets`, e.g. "key:groq". null = local provider without auth (Ollama). */
  apiKeyRef: z.string().nullable(),
  headers: z.record(z.string()).optional(),
});

export const PROVIDER_PRESETS = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", apiKeyRef: "key:groq" },
  openai: { baseUrl: "https://api.openai.com/v1", apiKeyRef: "key:openai" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", apiKeyRef: "key:openrouter" },
  ollama: { baseUrl: "http://localhost:11434/v1", apiKeyRef: null },
} as const;

export const SettingsSchema = z.object({
  version: z.literal(2),
  /**
   * FR8: provider-agnostic, swap via settings. Model names are plain strings (config,
   * not hard-coded) — PRD §7.4.
   */
  providers: z.record(z.string(), ProviderConfigSchema),
  activeProvider: z.string().min(1),
  /** PRD §7.4: per-role models — stronger reasoning for planning/teaching, speed for steps. */
  perRoleModel: z.object({
    planner: z.string(),
    step: z.string(),
    vision: z.string().nullable(),
  }),
  /** Per-site enablement, PRD §7.3 — optional host permissions requested at runtime. */
  sites: z.array(
    z.object({
      host: z.string(),
      granted: z.boolean(),
      cdpFallback: z.boolean(), // M6: trusted-input fallback toggle, docs/05 §5.4
    }),
  ),
  safety: z.object({
    maxStepsPerRun: z.number().int().positive(),
    maxItemsPerBatch: z.number().int().positive(),
    interItemDelayMs: z.number().int().nonnegative(),
    canaryFirst: z.boolean(),
    failurePolicy: z.enum(["stop", "skip"]),
  }),
  appearance: z.object({
    theme: z.enum(["system", "light", "dark"]),
    overlayEnabled: z.boolean(),
  }),
  onboarded: z.boolean(),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const DEFAULT_SETTINGS: Settings = {
  version: 2,
  providers: {
    groq: { ...PROVIDER_PRESETS.groq },
    openai: { ...PROVIDER_PRESETS.openai },
    openrouter: { ...PROVIDER_PRESETS.openrouter },
    ollama: { ...PROVIDER_PRESETS.ollama },
  },
  activeProvider: "groq",
  perRoleModel: {
    planner: "qwen/qwen3.8-27b", // strong reasoning for planning/teaching (verify against /models at runtime)
    step: "qwen/qwen3.8-27b", // speed for step execution
    vision: null,
  },
  sites: [],
  safety: {
    maxStepsPerRun: 60,
    maxItemsPerBatch: 50,
    interItemDelayMs: 800,
    canaryFirst: true,
    failurePolicy: "stop",
  },
  appearance: { theme: "system", overlayEnabled: true },
  onboarded: false,
};
