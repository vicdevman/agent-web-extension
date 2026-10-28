import { ActionOpSchema, type ActionOp } from "../core/schema/action";

/** Tool arg → ActionOp mapping (docs/06 §6.5 → docs/05 §5.4). */

export function argsToActionOp(
  name: string,
  argsJson: string,
): ActionOp | { error: string } {
  let args: Record<string, unknown>;
  try {
    args = (argsJson.trim() === "" ? {} : JSON.parse(argsJson)) as Record<string, unknown>;
  } catch {
    return { error: "Tool call arguments are not valid JSON" };
  }
  const num = (k: string): number | undefined =>
    args[k] === undefined || args[k] === null ? undefined : (args[k] as number);
  const str = (k: string): string | undefined =>
    args[k] === undefined || args[k] === null ? undefined : String(args[k]);

  let candidate: unknown;
  switch (name) {
    case "click":
      candidate = { op: "click", step: num("index"), gen: num("gen") };
      break;
    case "type":
      candidate = {
        op: "type",
        step: num("index"),
        gen: num("gen"),
        text: str("text") ?? "",
        submit: Boolean(args.submit),
      };
      break;
    case "select":
      candidate = { op: "select", step: num("index"), gen: num("gen"), value: str("value") ?? "", by: str("by") as "label" | "value" | undefined };
      break;
    case "scroll":
      candidate = {
        op: "scroll",
        direction: (str("direction") ?? "down") as "up" | "down" | "into",
        step: num("index"),
        gen: num("gen"),
      };
      break;
    case "navigate":
      candidate = { op: "navigate", url: str("url") ?? "" };
      break;
    case "wait_for":
      candidate = {
        op: "wait_for",
        kind: (str("kind") ?? "text") as "selector" | "text" | "url" | "gone",
        pattern: str("pattern") ?? "",
        timeoutMs: Math.min(num("timeoutMs") ?? 5000, 30_000),
      };
      break;
    case "extract":
      candidate = { op: "extract", limit: num("limit") };
      break;
    case "open_tab":
      candidate = { op: "open_tab", url: str("url") ?? "" };
      break;
    case "switch_tab":
      candidate = { op: "switch_tab", tabId: num("tabId") ?? -1 };
      break;
    case "key":
      candidate = { op: "key", key: str("key") ?? "", step: num("index"), gen: num("gen") };
      break;
    case "ask_user":
      candidate = { op: "ask_user", question: str("question") ?? "" };
      break;
    case "request_approval":
      candidate = { op: "request_approval", summary: str("summary") ?? "" };
      break;
    case "done":
      candidate = { op: "done", result: str("result") ?? "" };
      break;
    case "fail":
      candidate = { op: "fail", reason: str("reason") ?? "" };
      break;
    default:
      return { error: `Unknown tool "${name}"` };
  }
  const parsed = ActionOpSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      error: `Invalid tool arguments: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    };
  }
  return parsed.data;
}
