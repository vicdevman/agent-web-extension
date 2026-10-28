/**
 * LLM-facing action tools (docs/06 §6.5) — JSON schemas matching ActionOp vocabulary.
 * Element addressing is by INDEX only; every index-based tool requires `gen` (the snapshot
 * generation) so stale indices can be rejected by the content script (docs/05 §5.3).
 */

import type { ToolSpec } from "./types";

const gen = {
  step: { type: "integer", minimum: 1, description: "The 1-based element index from the snapshot." },
  gen: { type: "integer", description: "The snapshot 'gen' number you are acting on." },
};

export const ACTION_TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "click",
      description: "Click the element with the given snapshot index.",
      parameters: { type: "object", required: ["index", "gen"], properties: { index: gen.step, gen: gen.gen } },
    },
  },
  {
    type: "function",
    function: {
      name: "type",
      description: "Focus a text field and replace its content with `text`. Set submit=true to press Enter after typing.",
      parameters: {
        type: "object",
        required: ["index", "gen", "text"],
        properties: { index: gen.step, gen: gen.gen, text: { type: "string" }, submit: { type: "boolean" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "select",
      description: "Choose an option of a select element (by visible label or value).",
      parameters: {
        type: "object",
        required: ["index", "gen", "value"],
        properties: { index: gen.step, gen: gen.gen, value: { type: "string" }, by: { enum: ["label", "value"] } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scroll",
      description: "Scroll up/down, or scroll an element (by index) into view.",
      parameters: {
        type: "object",
        properties: {
          direction: { enum: ["up", "down", "into"] },
          index: { type: "integer" },
          gen: gen.gen,
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate",
      description: "Navigate the current tab to an absolute http(s) URL.",
      parameters: { type: "object", required: ["url"], properties: { url: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "wait_for",
      description: "Wait for a selector/text/url condition before continuing (max 30s).",
      parameters: {
        type: "object",
        required: ["kind", "pattern", "timeoutMs"],
        properties: {
          kind: { enum: ["selector", "text", "url", "gone"] },
          pattern: { type: "string" },
          timeoutMs: { type: "integer", minimum: 100, maximum: 30000 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "extract",
      description: "Extract the page title/URL summary (cheap perception-only probe).",
      parameters: { type: "object", properties: { limit: { type: "integer" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "open_tab",
      description: "Open a new background tab with an http(s) URL.",
      parameters: { type: "object", required: ["url"], properties: { url: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "switch_tab",
      description: "Switch the run's target to an existing tab id.",
      parameters: { type: "object", required: ["tabId"], properties: { tabId: { type: "integer" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "key",
      description: "Press a special key on the focused element (e.g. Escape, ArrowDown, Tab, Enter).",
      parameters: {
        type: "object",
        required: ["key"],
        properties: { key: { type: "string" }, index: { type: "integer" }, gen: { type: "integer" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_user",
      description: "Ask the user a question and pause the run for their answer.",
      parameters: { type: "object", required: ["question"], properties: { question: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "request_approval",
      description: "Pause for explicit human approval before an out-of-plan or sensitive action.",
      parameters: { type: "object", required: ["summary"], properties: { summary: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "done",
      description: "Declare the task complete with a one-line human-readable result.",
      parameters: { type: "object", required: ["result"], properties: { result: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "fail",
      description: "Give up with a reason the user can read (what you tried, what you saw).",
      parameters: { type: "object", required: ["reason"], properties: { reason: { type: "string" } } },
    },
  },
];
