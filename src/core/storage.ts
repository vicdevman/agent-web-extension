import { browser } from "wxt/browser";
import {
  DEFAULT_SETTINGS,
  SECRETS_KEY,
  SecretsSchema,
  SettingsSchema,
  type Secrets,
  type Settings,
} from "./schema/settings";

/**
 * Settings + secrets storage (chrome.storage.local). Per docs/02 §2.1 only the SW and the
 * panel read settings; content scripts never receive them (docs/10 §10.3).
 */

const SETTINGS_KEY = "settings";

export async function getSettings(): Promise<Settings> {
  try {
    const raw = await browser.storage.local.get(SETTINGS_KEY);
    const parsed = SettingsSchema.safeParse(raw[SETTINGS_KEY]);
    if (parsed.success) return parsed.data;
    // Migrate forward by merging defaults (zod refinement failures → fallback below).
  } catch {
    // storage read failed — fall through to defaults
  }
  return structuredClone(DEFAULT_SETTINGS);
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = SettingsSchema.parse({ ...current, ...patch });
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function resetSettings(): Promise<Settings> {
  const fresh = structuredClone(DEFAULT_SETTINGS);
  await browser.storage.local.set({ [SETTINGS_KEY]: fresh });
  return fresh;
}

export async function getSecrets(): Promise<Secrets> {
  try {
    const raw = await browser.storage.local.get(SECRETS_KEY);
    const parsed = SecretsSchema.safeParse(raw[SECRETS_KEY]);
    if (parsed.success) return parsed.data;
  } catch {
    // ignore
  }
  return {};
}

export async function setSecret(providerId: string, apiKey: string | null): Promise<void> {
  const secrets = await getSecrets();
  if (apiKey === null) delete secrets[providerId];
  else secrets[providerId] = apiKey;
  await browser.storage.local.set({ [SECRETS_KEY]: secrets });
}

/** Resolve an apiKeyRef like "key:groq" into a concrete API key, or null when unconfigured. */
export async function resolveApiKey(apiKeyRef: string | null | undefined): Promise<string | null> {
  if (!apiKeyRef || !apiKeyRef.startsWith("key:")) return null;
  const secrets = await getSecrets();
  return secrets[apiKeyRef.slice(4)] ?? null;
}
