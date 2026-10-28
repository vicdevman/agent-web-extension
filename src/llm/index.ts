import { openAICompatible } from "./openai-compatible";
import type { LLMProvider } from "./types";
import type { ProviderConfig } from "../core/schema/settings";
import type { Secrets } from "../core/schema/settings";

/** Factory: settings + secrets → provider instance (docs/06 §6.2). Per-role models live in
 * settings; callers pass `params.model` per call site (planner vs step, docs/06 §6.2). */

export function createProvider(
  config: ProviderConfig,
  secrets: Secrets,
  providerId: string,
): LLMProvider | { error: string } {
  if (!config?.baseUrl) return { error: `Provider "${providerId}" is not configured` };

  let apiKey: string | null = null;
  if (config.apiKeyRef) {
    const keyId = config.apiKeyRef.startsWith("key:") ? config.apiKeyRef.slice(4) : null;
    if (!keyId) return { error: `Bad apiKeyRef on provider "${providerId}"` };
    const secret = secrets[keyId];
    if (!secret) return { error: `API key for "${keyId}" is missing — add it in Settings` };
    apiKey = secret;
  }

  return openAICompatible({
    id: providerId,
    baseUrl: config.baseUrl,
    apiKey,
    headers: config.headers,
  });
}
