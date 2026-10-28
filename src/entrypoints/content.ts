import { defineContentScript } from "wxt/utils/define-content-script";
import type { MsgEnvelope, Reply } from "@/core/schema/message";
import { err } from "@/core/schema/message";
import { SnapshotEngine, captureSnapshot } from "@/content/perception/snapshot";
import { executeAction } from "@/content/actions/executor";
import { flashRing, hideRing, showChip, hideChip, teardown } from "@/content/overlay";
import { logError } from "@/core/log";
import { ActionOpSchema } from "@/core/schema/action";
import type { Snapshot } from "@/core/schema/run";

/**
 * Content script entrypoint (docs/04 §4.3): perception, action execution, overlay.
 * Injected by manifest on future page loads of granted hosts; SW also executes the same
 * bundle into already-open tabs via chrome.scripting (docs/02 §2.1).
 */

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    if ((window as unknown as { __tbaReady?: boolean }).__tbaReady) return;
    (window as unknown as { __tbaReady?: boolean }).__tbaReady = true;

    const engine = new SnapshotEngine();

    chrome.runtime.onMessage.addListener((msg: MsgEnvelope, _s, sendReply: (r: Reply) => void) => {
      if (!msg || msg.ns !== "tba") return false;
      void handle(msg, sendReply);
      return true; // async reply
    });

    async function handle(msg: MsgEnvelope, sendReply: (r: Reply) => void): Promise<void> {
      try {
        switch (msg.type) {
          case "CS_PING": {
            sendReply({ ok: true, data: { ready: true } });
            return;
          }
          case "CS_PERCEIVE": {
            const snap = captureSnapshot(engine);
            const res: Snapshot = {
              gen: snap.gen,
              snapshot: snap.snapshot,
              url: snap.url,
              title: snap.title,
            };
            sendReply({ ok: true, data: res });
            return;
          }
          case "CS_EXECUTE": {
            const parsed = ActionOpSchema.safeParse((msg.payload as { action?: unknown })?.action ?? msg.payload);
            if (!parsed.success) {
              sendReply({ ok: false, error: err("BAD_REQUEST", "Invalid ActionOp") });
              return;
            }
            const op = parsed.data;
            const result = await executeAction(engine, op);
            if (result.ok && "step" in op && typeof op.step === "number") {
              const elRes = elOf(engine, op.step, op.gen ?? -1);
              if (elRes) flashRing(elRes);
            }
            sendReply({ ok: true, data: result });
            return;
          }
          case "CS_OVERLAY": {
            const p = (msg.payload ?? {}) as { chip?: string | null; hide?: boolean };
            if (p.hide) {
              teardown();
            } else {
              if (p.chip) showChip(p.chip);
              else hideChip();
            }
            sendReply({ ok: true, data: {} });
            return;
          }
          case "CS_HIGHLIGHT_OFF": {
            hideRing();
            sendReply({ ok: true, data: {} });
            return;
          }
          default: {
            sendReply({ ok: false, error: err("BAD_REQUEST", `Unknown content message "${msg.type}"`) });
          }
        }
      } catch (e) {
        logError("content handler failed", e);
        sendReply({ ok: false, error: err("EXEC_FAILED", String((e as Error)?.message ?? e)) });
      }
    }

    function elOf(engine: SnapshotEngine, step: number, gen: number): Element | null {
      const cur = engine.current();
      if (gen !== cur.gen) return null;
      return cur.elements[step - 1]?.el ?? null;
    }
  },
});
