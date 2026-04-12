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

  // Operator-level config. Secrets are stored as `secret-ref` strings that
  // the worker resolves at runtime via `ctx.secrets.resolve`.
  instanceConfigSchema: {
    type: "object",
    properties: {
      googleClientId: {
        type: "string",
        title: "Google OAuth Client ID",
        description:
          "OAuth 2.0 client ID used for Google Search Console and GA4 calls. Create it in the Google Cloud console.",
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
        description: "Secret reference to a long-lived refresh token scoped for GSC + GA4.",
        format: "secret-ref",
      },
      googlePsiApiKeyRef: {
        type: "string",
        title: "Google PageSpeed Insights API Key (optional)",
        description:
          "Optional secret reference to a Google PSI API key. If unset, the public quota is used (fine for low volume).",
        format: "secret-ref",
      },
      resendApiKeyRef: {
        type: "string",
        title: "Resend API Key",
        description: "Secret reference to the Resend API key used by the email.send tool.",
        format: "secret-ref",
      },
      defaultFromAddress: {
        type: "string",
        title: "Default From address",
        description:
          "Fallback From address used when an agent has no email identity configured. Example: \"Melvyn <melvyn@neocompany.ch>\".",
        default: "",
      },
    },
  },

  launchers: [
    {
      id: "neocompany-tools-settings",
      displayName: "NeoCompany Tools",
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
