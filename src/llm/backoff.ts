/** Retry with exponential backoff + jitter, honoring Retry-After (docs/06 §6.4). */

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = "HttpError";
  }
}

export class NetworkError extends Error {
  constructor(public readonly cause: unknown) {
    super(String((cause as Error)?.message ?? cause));
    this.name = "NetworkError";
  }
}

export interface BackoffOptions {
  maxRetries?: number; // default 4 (docs/06 §6.4)
  baseDelayMs?: number; // default 250ms
  factor?: number; // default 1.8
  maxDelayMs?: number; // default 30_000
  jitterMs?: number; // default 250
  signal?: AbortSignal;
}

/** Retries only transient conditions: 429, 5xx, network errors. Retries on HttpError and
 * NetworkError, always honoring Retry-After when present, else 250 * 1.8^n + jitter. */
export async function withBackoff<T>(fn: () => Promise<T>, opts: BackoffOptions = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? 4;
  const base = opts.baseDelayMs ?? 250;
  const factor = opts.factor ?? 1.8;
  const maxDelay = opts.maxDelayMs ?? 30_000;
  const jitter = opts.jitterMs ?? 250;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const transient = e instanceof HttpError && (e.status === 429 || e.status >= 500);
      const network = e instanceof NetworkError;
      if (!(transient || network) || attempt >= maxRetries) {
        if ((transient || network) && attempt >= maxRetries) {
          throw e instanceof Error ? e : new Error(String(e));
        }
        throw e;
      }
      attempt += 1;
      const backoff =
        e instanceof HttpError && e.retryAfterMs !== null
          ? e.retryAfterMs
          : Math.min(base * Math.pow(factor, attempt - 1) + Math.random() * jitter, maxDelay);
      await sleep(backoff, opts.signal);
    }
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Parse a Retry-After header: seconds or HTTP-date. */
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const asSeconds = Number(header);
  if (!Number.isNaN(asSeconds) && asSeconds >= 0) return Math.min(asSeconds * 1000, 30_000);
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) return Math.max(0, Math.min(asDate - Date.now(), 30_000));
  return null;
}
