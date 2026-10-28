/**
 * On-page affordances (docs/11 §11.3): highlight ring on the acted element + a floating
 * status chip. Built in a shadow-DOM root, pointer-events:none, dismissible (Esc hides chip),
 * reduced-motion respected, never invisible in the toolbar-observed chrome.
 */

const HOST_ID = "tba-overlay-root";

interface OverlayHandles {
  host: HTMLDivElement;
  root: ShadowRoot;
  ring: HTMLDivElement;
  chip: HTMLDivElement;
}

let handles: OverlayHandles | null = null;

const ACCENT = "var(--tba-accent, #6C5CE7)";

export function ensureOverlay(): OverlayHandles {
  if (handles && handles.host.isConnected) return handles;
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.dataset.tba = "overlay";
  const style = host.style;
  style.cssText = "all:initial; position:fixed; inset:0; z-index:2147483647; pointer-events:none;";
  const root = host.attachShadow({ mode: "closed" });
  const ring = document.createElement("div");
  const chip = document.createElement("div");
  ring.style.cssText = `position:fixed; display:none; border:2px solid ${ACCENT};
    border-radius:8px; box-shadow:0 0 0 3px rgba(108,92,231,0.25);
    background:rgba(108,92,231,0.08); transition:${reduceMotion ? "none" : "all 120ms ease"};`;
  chip.style.cssText = `position:fixed; right:14px; bottom:14px; display:none;
    max-width:320px; padding:8px 10px; border-radius:10px; font:12px/1.4 system-ui;
    color:#fff; background:rgba(22,22,29,0.92); border:1px solid ${ACCENT};
    pointer-events:none;`;
  root.append(ring, chip);
  document.documentElement.appendChild(host);
  handles = { host, root, ring, chip };
  // Esc hides the chip (docs/11: overlay always dismissible)
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") hideRing(), hideChip();
    },
    true,
  );
  return handles;
}

export function flashRing(el: Element): void {
  const { ring } = ensureOverlay();
  const r = (el as HTMLElement).getBoundingClientRect();
  const pad = 4;
  ring.style.display = "block";
  ring.style.left = `${r.left - pad}px`;
  ring.style.top = `${r.top - pad}px`;
  ring.style.width = `${r.width + pad * 2}px`;
  ring.style.height = `${r.height + pad * 2}px`;
}

export function hideRing(): void {
  if (handles) handles.ring.style.display = "none";
}

export function showChip(text: string): void {
  const { chip } = ensureOverlay();
  chip.style.display = "block";
  chip.textContent = text;
}

export function hideChip(): void {
  if (handles) handles.chip.style.display = "none";
}

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function teardown(): void {
  handles?.host.remove();
  handles = null;
}
