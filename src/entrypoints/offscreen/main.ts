/**
 * Offscreen document (docs/02 §2.1 / docs/07 §7.3): its messages reset the service worker's
 * 30s idle timer (Chrome 109+), which is what keeps a run's LLM/model activity from
 * timing out the worker mid-flight. It holds an open port as a second keep-alive signal.
 */

const PORT_NAME = "keepalive";
const TICK_MS = 20_000; // < 30s idle timeout, with margin

try {
  chrome.runtime.connect({ name: PORT_NAME });
} catch {
  // SW may not be listening yet; messages below still reset the timer.
}

setInterval(() => {
  try {
    chrome.runtime.sendMessage({
      ns: "tba",
      v: 1,
      type: "KEEPALIVE_TICK",
      reqId: "offscreen",
      payload: null,
    });
  } catch {
    // SW restarting; it will wake via the sw_watchdog alarm.
  }
}, TICK_MS);
