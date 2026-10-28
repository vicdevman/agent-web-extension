/**
 * Perception — DOM → indexed element list, rendered as the compact string format in
 * docs/05 §5.2. Numbers are the ONLY handles the model gets (docs/05 §5.1); the index↔DOM
 * mapping lives here for the lifetime of one snapshot generation.
 *
 * Resilience per docs/05 §5.6 / PRD §10: pierces shadow DOM, traverses same-origin iframes,
 * truncates virtualized lists, masks secret input values.
 */

export interface IndexedElement {
  el: Element;
  role: string;
  name: string;
  href?: string;
  options?: string[];
}

export interface SnapshotData {
  gen: number;
  snapshot: string;
  url: string;
  title: string;
}

const INTERACTIVE_SELECTORS = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "textarea",
  "select",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="combobox"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="menuitem"]',
  '[role="searchbox"]',
  '[role="textbox"]',
  '[contenteditable="true"]',
].join(",");

const TEXT_ROLE_TAGS = new Set(["H1", "H2", "H3", "FORM", "NAV"]);

const BUDGET = {
  maxElements: 120, // M2 heuristic; M6 tunes against token telemetry (docs/14 §6)
  maxChars: 15_000, // ~4k tokens
  maxTextLen: 80,
};

export class SnapshotEngine {
  private gen = 1;
  private last: IndexedElement[] = [];

  current(): { gen: number; elements: IndexedElement[] } {
    return { gen: this.gen, elements: this.last };
  }

  register(elements: IndexedElement[]): number {
    this.gen += 1;
    this.last = elements;
    return this.gen;
  }
}

/** Build the snapshot string AND register the index↔DOM map for this generation. */
export function captureSnapshot(engine: SnapshotEngine): SnapshotData {
  const elements: IndexedElement[] = [];
  collectInto(document.body ?? document.documentElement, elements, 0);

  const lines: string[] = [];
  const url = location.href;
  const title = document.title;
  lines.push(`PAGE url=${url} title=${title.slice(0, 100)}`);

  let count = 0;
  let chars = 0;
  for (const e of elements) {
    if (count >= BUDGET.maxElements) {
      lines.push(`… +${elements.length - BUDGET.maxElements} more (scroll to reveal more)`);
      break;
    }
    const line = render(e, count + 1);
    if (chars + line.length > BUDGET.maxChars) {
      lines.push(`… truncated at ${count} elements (token budget)`);
      break;
    }
    lines.push(line);
    count += 1;
    chars += line.length;
  }

  const gen = engine.register(elements.slice(0, BUDGET.maxElements));
  return { gen, snapshot: lines.join("\n"), url, title };
}

/** Resolve a (step, gen) pair back to its element (docs/05 §5.4). */
export function resolveElement(
  engine: SnapshotEngine,
  gen: number,
  step: number,
): Element | { error: "STALE" | "NOTFOUND" } {
  const cur = engine.current();
  if (gen !== cur.gen) return { error: "STALE" };
  const e = cur.elements[step - 1];
  if (!e) return { error: "NOTFOUND" };
  if (!e.el.isConnected) return { error: "NOTFOUND" };
  return e.el;
}

/** Recursive collector: regular DOM + shadow roots + same-origin iframes. */
function collectInto(root: HTMLElement | Document, out: IndexedElement[], depth: number): void {
  if (depth > 4) return; // nesting guard
  for (const el of Array.from(root.querySelectorAll(INTERACTIVE_SELECTORS))) {
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) collectInto(shadow as unknown as HTMLElement, out, depth + 1);

    if (el.tagName === "IFRAME") {
      const f = el as HTMLIFrameElement;
      try {
        const doc = f.contentDocument;
        if (doc?.body) {
          out.push({
            el: f,
            role: "iframe",
            name: `IFRAME src=${f.src ? f.src.slice(0, 60) : "same-origin"}`,
          });
          collectInto(doc.body as HTMLElement, out, depth + 1);
        }
      } catch {
        out.push({ el: f, role: "iframe", name: "IFRAME (cross-origin, skipped)" });
      }
      continue;
    }

    if (!visible(el)) continue;
    const c = classify(el);
    if (!c) continue;
    const e: IndexedElement = { el, role: c.role, name: c.name };
    if (c.href) e.href = c.href;
    if (c.options) e.options = c.options;
    out.push(e);
  }
}

function classify(el: Element): null | {
  role: string;
  name: string;
  href?: string;
  options?: string[];
} {
  const tag = el.tagName.toUpperCase();
  const ariaRole = el.getAttribute("role") ?? "";
  const label = accName(el);

  if (tag === "INPUT") {
    const input = el as HTMLInputElement;
    if (input.type === "hidden") return null;
    const role = input.type === "checkbox" || input.type === "radio" ? input.type : "input";
    // Secret masking is a hard rule (docs/10 §10.2): never put secret values in snapshots.
    const value =
      input.type === "password" || looksSecret(input)
        ? ""
        : ` value="${input.value.slice(0, BUDGET.maxTextLen)}"`;
    return {
      role,
      name: `${label || input.placeholder || input.name || "(no label)"}${value}`,
    };
  }
  if (tag === "TEXTAREA") {
    const t = el as HTMLTextAreaElement;
    return {
      role: "textbox",
      name: `${label || t.placeholder || t.name || "(no label)"} value="${t.value.slice(0, BUDGET.maxTextLen)}"`,
    };
  }
  if (tag === "SELECT") {
    const s = el as HTMLSelectElement;
    return {
      role: ariaRole || "select",
      name:
        `${label || "(no label)"} value="${s.selectedOptions[0]?.label ?? ""}"` +
        ` options="[ ${Array.from(s.options).slice(0, 12).map((o) => o.label || o.value).join(" | ")} ]"`,
    };
  }
  if (tag === "A") {
    const text = (label || (el as HTMLAnchorElement).textContent || "").trim().slice(0, BUDGET.maxTextLen);
    if (!text) return null;
    return { role: "link", name: text, href: (el as HTMLAnchorElement).href };
  }
  if (TEXT_ROLE_TAGS.has(tag)) {
    const text = (el.textContent ?? "").trim().slice(0, BUDGET.maxTextLen);
    if (!text) return null;
    return { role: ariaRole || tag.toLowerCase(), name: text };
  }

  // Generic interactive element (button, [role], contenteditable)
  const text = (label || el.textContent || "").trim().slice(0, BUDGET.maxTextLen);
  if (!text && el.getAttribute("contenteditable") !== "true") return null;
  return { role: ariaRole || tag.toLowerCase(), name: text };
}

function accName(el: Element): string {
  return (
    el.getAttribute("aria-label")?.trim().slice(0, BUDGET.maxTextLen) ||
    (el as HTMLElement).innerText?.trim?.().slice(0, BUDGET.maxTextLen) ||
    ""
  );
}

function looksSecret(input: HTMLInputElement): boolean {
  return /pass(word)?|token|secret|cvc|cvv|card|ssn|bearer|api[-_ ]?key/i.test(
    `${input.name} ${input.id} ${input.autocomplete}`,
  );
}

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 && r.height <= 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

function render(e: IndexedElement, index: number): string {
  const href = e.role === "link" && e.href ? ` -> ${trimHref(e.href)}` : "";
  return `[${index}] ${e.role} "${e.name}"${href}`;
}

function trimHref(href: string): string {
  try {
    const u = new URL(href);
    return `${u.host}${u.pathname}`;
  } catch {
    return href.slice(0, 40);
  }
}

function statesOf(el: Element): string {
  const parts: string[] = [];
  const a = el as HTMLButtonElement | HTMLInputElement;
  if ("disabled" in a && a.disabled) parts.push("disabled");
  if ("checked" in a && a.checked) parts.push("checked");
  if (el.getAttribute("aria-expanded") === "false") parts.push("collapsed");
  return parts.length ? ` [${parts.join(",")}]` : "";
}

// secret-name check exported for potential reuse in recording (M4) and tests
export function secretNameRe(name: string): boolean {
  const probe = document.createElement("input");
  probe.name = name;
  return looksSecret(probe);
}

export { statesOf };
