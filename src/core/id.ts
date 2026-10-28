/** Prefixed nanoid factory — ids are formatted `wf_*`, `run_*`, `st_*` etc. (docs/03). */

export function newId(prefix: string): string {
  const alphabet = "23456789abcdefghijkmnpqrstuvwxyz";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${prefix}_${out}`;
}

export const ids = {
  workflow: () => newId("wf"),
  run: () => newId("run"),
  step: () => newId("st"),
  target: () => newId("trg"),
  approval: () => newId("apv"),
  message: () => newId("msg"),
};
