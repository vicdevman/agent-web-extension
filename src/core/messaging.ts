import type { MsgEnvelope, Reply } from "./schema/message";
import { makeMsg } from "./schema/message";
import type { ErrBody } from "./schema/message";

/**
 * Thin typed wrapper over one-shot runtime messaging (docs/04).
 * Port helpers live in the panel/background styles themselves.
 */

export function send<T = void>(
  type: string,
  payload?: unknown,
  timeoutMs = 20_000,
): Promise<Reply<T>> {
  const msg: MsgEnvelope = makeMsg(type, payload);
  return new Promise<Reply<T>>((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, error: { code: "NOT_READY", message: `No reply to ${type} (timeout)` } });
    }, timeoutMs);
    chrome.runtime.sendMessage(msg, (res: Reply<T> | undefined) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: { code: "NOT_READY", message: chrome.runtime.lastError.message ?? "Unknown runtime error" } });
        return;
      }
      resolve(res ?? { ok: false, error: { code: "NOT_READY", message: "No handler" } });
    });
  });
}

/** Register a background handler. The listener returns true (async reply) when handled. */
export type MessageHandler = (
  payload: unknown,
) => Promise<{ data?: unknown } | { error: ErrBody }>;

export function neverReply(): boolean {
  return false;
}
