import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { ALL_TOOLS } from "./tools/index.js";

export const PLUGIN_ID = "nora-frappe-tools";
const PLUGIN_VERSION = "0.1.0";

// NORA Frappe Tools — typed bridge between Paperclip agents and a Neoffice
// (Frappe/ERPNext) instance. Wave 1 ships 8 tools that unblock the E2E
// regression suite. See Obsidian NORA/13-sub-agents-hygiene-roadmap/05-nora-frappe-tools-plugin.md
const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "NORA Frappe Tools",
  description:
    "Typed ERP tools for NORA: create customer/supplier/invoice, list/count/get/search documents, run SQL. " +
    "Zero JSON escaping — agents call frappeCustomerCreate({customer_name: 'X'}) instead of wrapping Python in execute_code.",
  author: "Neoservice",
  categories: ["connector"],
  capabilities: [
    "agent.tools.register",
    "plugin.state.read",
    "plugin.state.write",
    "secrets.read-ref",
    "activity.log.write",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },

  /**
   * Instance-wide defaults. A super-admin sets these via Paperclip admin UI
   * so all companies on this Paperclip install point to the same Frappe
   * unless overridden per-company.
   *
   * Fallback order (see src/context.ts): company state → this instance config
   * → process env (FRAPPE_URL, FRAPPE_API_KEY, FRAPPE_API_SECRET).
   */
  instanceConfigSchema: {
    type: "object",
    title: "NORA Frappe Tools — Platform Defaults",
    properties: {
      frappeUrlDefault: {
        type: "string",
        title: "Default Frappe base URL",
        description: "E.g. http://127.0.0.1:8000 or https://osiris.neoffice.me. No trailing slash.",
      },
      frappeSiteNameDefault: {
        type: "string",
        title: "Default Frappe site name",
        description: "Optional. Used for multi-site bench (passed as X-Frappe-Site-Name).",
      },
      frappeApiKeyDefault: {
        type: "string",
        title: "Default Frappe API key",
        description:
          "Frappe User's API key. Use company state 'nora:frappe:apiKey' for per-company override.",
      },
      frappeApiSecretDefault: {
        type: "string",
        title: "Default Frappe API secret (legacy — prefer secret-refs)",
        description:
          "For secure deployments, use company state 'nora:frappe:apiSecretRef' pointing to a platform secret.",
      },
    },
  },

  /**
   * Every runtime-registered tool must be declared here so the plugin host
   * knows what the plugin contributes to the agent's tool list. ALL_TOOLS
   * is the single source of truth; adding a tool = 1 file + 1 import.
   */
  tools: ALL_TOOLS.map((t) => ({
    name: t.name,
    displayName: t.declaration.displayName,
    description: t.declaration.description,
    // The plugin-sdk host serializes zod schemas to JSON Schema automatically.
    parametersSchema: t.declaration.parametersSchema as unknown as Record<string, unknown>,
  })),
};

export default manifest;
