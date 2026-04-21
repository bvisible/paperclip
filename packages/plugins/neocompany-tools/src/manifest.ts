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
    // Read company metadata (logo URL, brand color) for image generation
    "companies.read",
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
    {
      jobKey: "social-publisher",
      displayName: "Social publisher",
      description:
        "Publishes approved social_post entities whose scheduledAt <= now via the corresponding social provider. Runs every minute.",
      schedule: "* * * * *",
    },
    {
      jobKey: "pixel-autopilot",
      displayName: "Pixel autopilot",
      description:
        "Keeps each company's draft queue filled according to its editorial strategy. Runs every 15 minutes.",
      schedule: "*/15 * * * *",
    },
  ],

  // Platform-wide config. These fields are declared here so the
  // plugin-secrets-handler knows which refs to allow the worker to
  // resolve via ctx.secrets.resolve(). BUT writes to this config are
  // super-admin only — gated by the `/api/plugins/neocompany-tools/
  // bridge/platform` route which calls assertInstanceAdmin before
  // patching plugin_config. Regular company users never see this
  // schema in any writable form; the plugin's Settings UI hides the
  // provider credentials section unless isInstanceAdmin.
  //
  // Per-company config (GSC site URL, GA4 property, WordPress creds)
  // lives in `plugin_state` scope=company and is editable by any
  // company user via the regular Settings UI.
  instanceConfigSchema: {
    type: "object",
    properties: {
      googleClientId: {
        type: "string",
        title: "Google OAuth Client ID",
        description: "OAuth 2.0 client ID used for Google Search Console + GA4.",
        default: "",
      },
      googleClientSecretRef: {
        type: "string",
        title: "Google OAuth Client Secret",
        description: "Secret reference to the Google OAuth client secret.",
        format: "secret-ref",
      },
      googleRefreshTokenRef: {
        type: "string",
        title: "Google OAuth Refresh Token",
        description: "Secret reference to a long-lived refresh token (GSC + GA4 scopes).",
        format: "secret-ref",
      },
      googlePsiApiKeyRef: {
        type: "string",
        title: "Google PageSpeed Insights API Key (optional)",
        description: "Optional secret reference — lifts the public quota.",
        format: "secret-ref",
      },
      openPageRankApiKeyRef: {
        type: "string",
        title: "Open PageRank API Key (optional)",
        description: "Optional secret reference for Open PageRank.",
        format: "secret-ref",
      },
      resendApiKeyRef: {
        type: "string",
        title: "Resend API Key",
        description: "Secret reference to the Resend API key for emailSendMessage.",
        format: "secret-ref",
      },
      defaultFromAddress: {
        type: "string",
        title: "Default From address",
        description: "Fallback From address when an agent has no email identity.",
        default: "",
      },
      openaiApiKeyRef: {
        type: "string",
        title: "OpenAI API Key",
        description: "Secret reference to the OpenAI API key used by imageGenerate (gpt-image-1.5).",
        format: "secret-ref",
      },
      linkedinClientId: {
        type: "string",
        title: "LinkedIn OAuth Client ID",
        description: "Platform-wide LinkedIn OAuth app client id. Each company connects its own account via OAuth against this shared app.",
        default: "",
      },
      linkedinClientSecretRef: {
        type: "string",
        title: "LinkedIn OAuth Client Secret",
        description: "Secret reference to the LinkedIn OAuth client secret.",
        format: "secret-ref",
      },
      facebookAppId: {
        type: "string",
        title: "Facebook App ID (reused for Instagram Business)",
        description: "Platform-wide Meta app id. Required for Facebook pages and Instagram Business accounts.",
        default: "",
      },
      facebookAppSecretRef: {
        type: "string",
        title: "Facebook App Secret",
        description: "Secret reference to the Meta app secret.",
        format: "secret-ref",
      },
    },
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
