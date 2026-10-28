/** Minimal logger — noop in content scripts, console in SW/panel. Swap for structured logging
 * if debugging needs it; keep zero egress (docs/10 §10.5). */

const PREFIX = "tba";

export function logInfo(...parts: unknown[]): void {
  console.info(`[${PREFIX}]`, ...parts);
}

export function logWarn(...parts: unknown[]): void {
  console.warn(`[${PREFIX}]`, ...parts);
}

export function logError(...parts: unknown[]): void {
  console.error(`[${PREFIX}]`, ...parts);
}
