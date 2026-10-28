import { SnapshotEngine, resolveElement } from "../perception/snapshot";
import type { ActionOp } from "@/core/schema/action";
import type { ActionResult } from "@/core/schema/run";

/**
 * Action executor (docs/05 §5.4): synthetic DOM events first. opTargetHosts domains are
 * validated SW-side (docs/10 §10.1) — content script trusts SW-routed ops only.
 * CDP fallback (chrome.debugger) is per-site M6 (settings.sites[].cdpFallback).
 */

const nativeInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
const nativeTextareaValue = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "value",
)?.set;

export async function executeAction(
  engine: SnapshotEngine,
  op: ActionOp,
): Promise<ActionResult> {
  switch (op.op) {
    case "click":
      return runIndexed(engine, op.step, op.gen, (el) => click(el));
    case "type":
      return runIndexed(engine, op.step, op.gen, (el) => type(el, op.text, op.submit === true));
    case "select":
      return runIndexed(engine, op.step, op.gen, (el) => select(el, op.value, op.by ?? "label"));
    case "key":
      if (op.step !== undefined && op.gen !== undefined) {
        return runIndexed(engine, op.step, op.gen, (el) => key(el, op.key));
      }
      return key(document.activeElement, op.key)
        ? ok("key pressed")
        : { ok: false, reason: "No focused element", code: "FAILED" };
    case "scroll":
      return scroll(op.direction, op.step !== undefined ? resolveElement(engine, op.gen ?? -1, op.step) ?? null : null);
    case "wait_for":
      return waitForever(op.kind, op.pattern, op.timeoutMs);
    case "extract":
      return ok(`TITLE: ${document.title} | URL: ${location.href}`);
    case "ask_user":
    case "request_approval":
    case "done":
    case "fail":
    case "navigate":
    case "open_tab":
    case "switch_tab":
      // Handled at SW layer before reaching the content script (docs/05 §5.4).
      return { ok: false, reason: `${op.op} is executed by the orchestrator`, code: "FAILED" };
    default: {
      const never: never = op;
      return { ok: false, reason: `Unknown op ${JSON.stringify(never)}`, code: "FAILED" };
    }
  }
}

async function runIndexed(
  engine: SnapshotEngine,
  step: number,
  gen: number,
  fn: (el: Element) => boolean,
): Promise<ActionResult> {
  const resolved = resolveElement(engine, gen, step);
  if (typeof resolved !== "object" || "error" in resolved) {
    const e = resolved as { error: string };
    return {
      ok: false,
      reason: e.error === "STALE" ? "Snapshot generation is stale — re-perceived" : "Element not found",
      code: e.error as "STALE" | "NOTFOUND",
    };
  }
  const el = resolved as Element;
  el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
  const okRes = fn(el);
  await microDelay(120); // settle event handlers (human-like pacing, docs/09 §9.3)
  return okRes
    ? { ok: true, data: describe(el) }
    : { ok: false, reason: "Dispatch succeeded but element did not respond (isTrusted=false risk)", code: "UNTRUSTED" };
}

function describe(el: Element): string {
  const role = el.getAttribute("role") ?? "";
  const name = el.getAttribute("aria-label") ?? (el as HTMLElement).innerText?.slice(0, 30) ?? "";
  return `${el.tagName.toLowerCase()}${role ? `[role=${role}]` : ""} "${name.trim()}"`;
}

function click(el: Element): boolean {
  const foc = el as HTMLElement;
  foc.focus?.();
  const rect = (el as HTMLElement).getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const base: PointerEventInit & MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    isPrimary: true,
    clientX: cx,
    clientY: cy,
    button: 0,
    buttons: 1,
  };
  el.dispatchEvent(new PointerEvent("pointerdown", base));
  el.dispatchEvent(new MouseEvent("mousedown", base));
  el.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0 }));
  el.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
  el.dispatchEvent(new MouseEvent("click", base));
  return true;
}

function type(el: Element, text: string, submit: boolean): boolean {
  const input = el as HTMLInputElement | HTMLTextAreaElement;
  if (tag(input) !== "input" && tag(input) !== "textarea" && input.getAttribute("contenteditable") === null) {
    input.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    return true; // opened a picker via click; the select flow handles value
  }
  input.focus?.();
  // Select-all + replace via native setter so React/angular controlled inputs update.
  const isInput = tag(input) === "input";
  (isInput ? nativeInputValue : nativeTextareaValue)?.call(input, "");
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  // Insert text progressively via beforeinput/input pair with insertText behavior.
  document.execCommand?.("selectAll", false); // harmless if unselected
  document.execCommand?.("insertText", false, text) ||
    (() => {
      (isInput ? nativeInputValue : nativeTextareaValue)?.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    })();
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

  if (submit) {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, composed: true }),
    );
    const form = (input as HTMLInputElement).form;
    if (form) {
      form.requestSubmit?.();
      return true;
    }
    input.dispatchEvent(
      new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true, composed: true }),
    );
  }
  return true;
}

function select(el: Element, value: string, by: "label" | "value"): boolean {
  const s = el as HTMLSelectElement;
  if (tag(el) !== "select") {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    return true; // custom combobox — Flow continues with click-option steps
  }
  const idx = Array.from(s.options).findIndex((o) =>
    by === "label" ? (o.label || o.value) === value : o.value === value,
  );
  if (idx === -1) return false;
  s.value = s.options[idx].value;
  s.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  s.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  return true;
}

function key(el: Element | null, k: string): boolean {
  if (!el) return false;
  el.dispatchEvent(
    new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, composed: true }),
  );
  el.dispatchEvent(
    new KeyboardEvent("keyup", { key: k, bubbles: true, cancelable: true, composed: true }),
  );
  return true;
}

function scroll(direction: "up" | "down" | "into", el: Element | { error: string } | null): ActionResult {
  if (direction === "into" && el && !("error" in el)) {
    (el as HTMLElement).scrollIntoView({ block: "center" });
    return ok("scrolled into view");
  }
  window.scrollBy({ top: direction === "down" ? 400 : -400 });
  return ok(`scrolled ${direction}`);
}

async function waitForever(
  kind: "selector" | "text" | "url" | "gone",
  pattern: string,
  timeoutMs: number,
): Promise<ActionResult> {
  const matches = (): boolean => {
    switch (kind) {
      case "selector":
        return !!document.querySelector(pattern);
      case "text":
        return document.body?.innerText.includes(pattern) ?? false;
      case "url":
        return location.href.toLowerCase().includes(pattern.toLowerCase());
      case "gone":
        return !document.querySelector(pattern);
      default:
        return false;
    }
  };
  // MutationObserver-based, not polling (background tabs throttle timers — docs/05 §5.5).
  if (matches()) return ok("already satisfied");
  return new Promise<ActionResult>((resolve) => {
    const obs = new MutationObserver(() => {
      if (matches()) {
        obs.disconnect();
        resolve(ok("condition met"));
      }
    });
    obs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    setTimeout(() => {
      obs.disconnect();
      resolve({ ok: false, reason: `wait_for(${kind}) timed out`, code: "FAILED" });
    }, timeoutMs);
  });
}

function ok(data: string): ActionResult {
  return { ok: true, data };
}

function tag(el: Element): string {
  return el.tagName.toLowerCase();
}

function microDelay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
