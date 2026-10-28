import { browser } from "wxt/browser";

/** Thin launcher (docs/02 §2.1): open the side panel; quick actions land in M2. */

const root = document.getElementById("root") as HTMLElement;

const title = document.createElement("div");
title.className = "title";
title.textContent = "Teachable Browser Agent";
root.appendChild(title);

const openBtn = document.createElement("button");
openBtn.textContent = "Open agent panel";
openBtn.addEventListener("click", async () => {
  const win = await browser.windows.getCurrent();
  await browser.sidePanel.open({ windowId: win.id as number });
  window.close();
});
root.appendChild(openBtn);

const s = document.createElement("div");
s.className = "sep";
root.appendChild(s);

const stopBtn = document.createElement("button");
stopBtn.textContent = "Stop all runs (M2)";
stopBtn.disabled = true;
root.appendChild(stopBtn);

row("Coming with M2: Record a workflow");
function row(label: string): void {
  const b = document.createElement("button");
  b.textContent = label;
  b.disabled = true;
  root.appendChild(b);
}
