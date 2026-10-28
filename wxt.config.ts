import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  entrypointsDir: "entrypoints",
  modules: [],
  manifest: {
    name: "Teachable Browser Agent",
    description:
      "Teach an AI agent a workflow once, then have it run that workflow inside your real browser.",
    permissions: [
      "sidePanel",
      "storage",
      "alarms",
      "offscreen",
      "notifications",
      "scripting",
      "tabs",
      "activeTab",
    ],
    // PRD §7.3: per-site enablement via runtime requests; no host grants at install.
    optional_host_permissions: ["<all_urls>"],
    action: {
      default_title: "Open Teachable Browser Agent",
      default_icon: {
        "16": "/icons/icon-16.png",
        "32": "/icons/icon-32.png",
        "48": "/icons/icon-48.png",
        "128": "/icons/icon-128.png",
      },
    },
    icons: {
      "16": "/icons/icon-16.png",
      "32": "/icons/icon-32.png",
      "48": "/icons/icon-48.png",
      "128": "/icons/icon-128.png",
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
