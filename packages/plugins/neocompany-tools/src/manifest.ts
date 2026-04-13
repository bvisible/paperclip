import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { ALL_TOOLS } from "./tools/index.js";

export const PLUGIN_ID = "neocompany-tools";
const PLUGIN_VERSION = "0.1.0";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "NeoCompany Tools",
  description:
    "Business tools for NeoCompany agents: SEO (Google Search Console, GA4, PageSpeed), WordPress, social media, email, designer, and ad campaigns. Ported from the legacy Postiz stack.",
  author: "NeoCompany",
  categories: ["automation", "connector"],
  capabilities: [
    // Tools declared below + runtime handlers registered by the worker
    "agent.tools.register",
    // Plugin state for access-control toggles and per-tool config
    "plugin.state.read",
    "plugin.state.write",
    // Secret references for provider API keys / OAuth refresh tokens
    "secrets.read-ref",
    // Activity logs per tool invocation
    "activity.log.write",
    // Read agents to resolve per-agent email identity, allow-lists, etc.
    "agents.read",
    // Settings UI + sidebar launcher
    "ui.page.register",
    "ui.sidebar.register",
    // Email subsystem: IMAP polling + plugin-owned entity store + event
    // emission so paperclip-chat can wake on email.received. Also
    // agent.sessions.create so the poller can open a chat session with
    // the assigned agent directly (wake-on-mail).
    "jobs.schedule",
    "events.emit",
    "agent.sessions.create",
    "agent.sessions.send",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },

  // Every runtime-registered tool must be declared here. The ALL_TOOLS
  // barrel is the single source of truth, so new tools only need to be
  // added in one place.
  tools: ALL_TOOLS.map((t) => ({
    name: t.name,
    displayName: t.declaration.displayName,
    description: t.declaration.description,
    parametersSchema: t.declaration.parametersSchema,
  })),

  // Scheduled jobs declared by the plugin. The worker registers handlers
  // via `ctx.jobs.register("imap-poll", ...)` in `worker.ts`.
  jobs: [
    {
      jobKey: "imap-poll",
      displayName: "IMAP inbox poller",
      description:
        "Walks every enabled email_account entity and pulls new messages via IMAP. Runs every 5 minutes.",
      schedule: "*/5 * * * *",
    },
  ],

  // Platform-wide config (Google OAuth, PSI key, Resend key, Open PageRank)
  // has moved to `plugin_state` scope=instance and is written ONLY by the
  // super-admin bridge routes (`/api/plugins/neocompany-tools/bridge/*`).
  // Per-company config (GSC site URL, GA4 property, WordPress creds) lives
  // in `plugin_state` scope=company and is editable by any company user.
  //
  // Existing installs that had values in the legacy `instanceConfigSchema`
  // are migrated once at worker startup — see `migratePlatformConfigIfNeeded`
  // in `worker.ts`.
  instanceConfigSchema: {
    type: "object",
    properties: {},
  },

  launchers: [
    {
      id: "neocompany-tools-settings",
      displayName: "Tools",
      description: "Configure and toggle NeoCompany tools",
      placementZone: "sidebar",
      action: {
        type: "navigate",
        target: "plugins/neocompany-tools",
      },
    },
  ],

  ui: {
    slots: [
      {
        type: "page",
        id: "neocompany-tools-settings",
        displayName: "NeoCompany Tools",
        exportName: "SettingsPage",
      },
    ],
  },
};

export default manifest;
