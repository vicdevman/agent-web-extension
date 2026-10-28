import { z } from "zod";

/** Cross-context message envelope. Every message type validates its payload with zod. */
export const MsgEnvelopeSchema = z.object({
  ns: z.literal("tba"),
  v: z.literal(1),
  type: z.string().min(1),
  reqId: z.string().min(1),
  payload: z.unknown(),
});
export type MsgEnvelope = z.infer<typeof MsgEnvelopeSchema>;

export interface Reply<R = unknown> {
  ok: boolean;
  data?: R;
  error?: ErrBody;
}

export interface ErrBody {
  code:
    | "NOT_READY"
    | "DENIED_SITE"
    | "APPROVAL_REQUIRED"
    | "NO_LLM"
    | "LIMIT"
    | "EXEC_FAILED"
    | "CS_DEAD"
    | "BAD_REQUEST";
  message: string;
  retryable?: boolean;
}

export function err(code: ErrBody["code"], message: string, retryable = false): ErrBody {
  return { code, message, retryable };
}

export function makeMsg<K extends string>(type: K, payload: unknown): MsgEnvelope {
  return { ns: "tba", v: 1, type, reqId: `req_${rndId()}`, payload };
}

function rndId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Channel names for long-lived ports. Ports carry the same envelope types as one-shots
 * but stream multiple events. Names follow docs/04-message-protocol.md §4. */
export const PORT = {
  chat: "chat", // panel ⇄ SW: streaming LLM test/chat (M1)
  run: (runId: string) => `run:${runId}`, // panel ⇄ SW: run event stream (M2)
  tab: (tabId: number) => `tab:${tabId}`, // SW ⇄ content script (M2)
  state: "state", // panel ⇄ SW: library/settings change broadcast
  keepalive: "keepalive", // offscreen ⇄ SW (M3)
} as const;
