import { browser } from "wxt/browser";

/**
 * Tab management (docs/02 §2.5): acquire/verify the run's target tab, ensure the content
 * script is injected (PING → scripting.executeScript → PING), report needs-grant situations.
 */

export const CONTENT_SCRIPT_PATH = "/content-scripts/content.js";

async function ping(tabId: number): Promise<boolean> {
  try {
    const res = await withTimeout(
      browser.tabs.sendMessage(tabId, {
        ns: "tba",
        v: 1,
        type: "CS_PING",
        reqId: "ping",
        payload: null,
      }),
      1500,
    );
    return Boolean((res as { ok?: boolean })?.ok);
  } catch {
    return false;
  }
}

export async function ensureInjected(tabId: number): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  // Fast path: already injected (e.g. manifest-injected on page load).
  if (await ping(tabId)) return { ok: true };

  let tab;
  try {
    tab = await browser.tabs.get(tabId);
  } catch {
    return { ok: false, reason: "NOT_INJECTABLE" };
  }
  const url = tab.url ?? "";
  const allowed =
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("file://") ||
    url.startsWith("about:");
  if (!allowed) return { ok: false, reason: "NOT_INJECTABLE" };

  const granted = await browser.permissions.contains({ origins: [originPattern(url)] });
  if (!granted) return { ok: false, reason: "NEEDS_GRANT" };

  try {
    await browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_PATH] });
  } catch (e) {
    return { ok: false, reason: `NOT_INJECTABLE: ${String((e as Error)?.message ?? e)}` };
  }
  if (await ping(tabId)) return { ok: true };
  return { ok: false, reason: "NOT_INJECTABLE" };
}

export function originPattern(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return "<non-url>";
  }
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    return tab ?? null;
  } catch {
    return null;
  }
}

export async function navigateTab(
  tabId: number,
  url: string,
): Promise<{ ok: boolean; finalUrl?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (finalUrl?: string) => {
      if (settled) return;
      settled = true;
      browser.tabs.onUpdated.removeListener(onUpdated);
      resolve({ ok: true, finalUrl });
    };
    const timeout = setTimeout(() => finish(), 15_000);
    const onUpdated = (updatedTabId: number, info: { status?: string; url?: string }) => {
      if (updatedTabId !== tabId) return;
      if (info.status === "complete" && info.url?.startsWith("http")) {
        clearTimeout(timeout);
        finish(info.url);
      }
    };
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.update(tabId, { url }).catch(() => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        browser.tabs.onUpdated.removeListener(onUpdated);
        resolve({ ok: false });
      }
    });
  });
}

/** Wait (with a cap) for a tab to finish loading — used by reload-and-resume (docs/07 §7.6). */
export function waitForTabComplete(tabId: number, timeoutMs = 20_000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      browser.tabs.onUpdated.removeListener(onUpdated);
      resolve(ok);
    };
    const timeout = setTimeout(() => done(false), timeoutMs);
    const onUpdated = (updatedTabId: number, info: { status?: string }) => {
      if (updatedTabId !== tabId) return;
      if (info.status === "complete") {
        clearTimeout(timeout);
        done(true);
      }
    };
    browser.tabs.onUpdated.addListener(onUpdated);
    void browser.tabs.get(tabId).then((t) => {
      if (settled) return;
      if (t.status === "complete") {
        clearTimeout(timeout);
        done(true);
      }
    });
  });
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
