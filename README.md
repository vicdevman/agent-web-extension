# Teachable Browser Agent Extension

A Chromium (Manifest V3) extension: teach an AI agent a workflow once, then let it run that
workflow inside your real browser, using your logged-in sessions. Groq by default, any
OpenAI-compatible provider behind settings.

**Read `docs/README.md` first** — the engineering documentation is the implementation contract.

## Quick start

```bash
npm install        # also runs `wxt prepare` (generates typed APIs + tsconfig)
npm run dev        # watch mode; load .output/chrome-mv3 as unpacked extension
npm run build      # production build in .output/chrome-mv3
npm run compile    # tsc --noEmit strict check
npm test           # vitest unit tests
npm run gen:icons  # regenerate toolbar/panel icons into public/icons
```

- Dev build output: `.output/chrome-mv3` (load via chrome://extensions → Developer mode →
  "Load unpacked").
- Stack: WXT + TypeScript + React 18 + Tailwind 4 + Zustand + zod (see `docs/12-tech-decisions.md`).
- No code, data, or analytics leaves the browser except calls to the model provider you configure.
