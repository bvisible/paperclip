import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "paperclip-chat";
const PLUGIN_VERSION = "0.1.0";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Chat",
  description:
    "Multi-adapter AI chat for Paperclip. Supports OpenClaw Gateway, Claude, Codex, and OpenCode with real-time streaming, session persistence, and tool visibility.",
  author: "NeoCompany",
  categories: ["workspace", "ui"],
  capabilities: [
    // UI
    "ui.page.register",
    "ui.sidebar.register",
    // Agent sessions (streaming chat)
    "agent.sessions.create",
    "agent.sessions.list",
    "agent.sessions.send",
    "agent.sessions.close",
    // Read agents for adapter/model discovery
    "agents.read",
    // Plugin state for thread/message persistence
    "plugin.state.read",
    "plugin.state.write",
    // Activity logging
    "activity.log.write",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },

  // Plugin-level config schema (operator-editable)
  instanceConfigSchema: {
    type: "object",
    properties: {
      defaultAdapterType: {
        type: "string",
        title: "Default Adapter",
        description: "Which adapter to use by default for new threads",
        default: "openclaw_gateway",
        //// Neocompany Modification — hermes_local added as a selectable adapter
        //// (Hermes migration). The runtime default still follows the
        //// PAPERCLIP_SEED_ADAPTER env flag via defaultChatAdapterType() in
        //// worker.ts; this enum just lets an operator pick it explicitly.
        enum: ["claude_local", "codex_local", "opencode_local", "openclaw_gateway", "hermes_local"],
        //// End Neocompany Modification
      },
      systemPromptOverride: {
        type: "string",
        title: "System Prompt Override",
        description: "Custom system prompt appended to all chat sessions (optional)",
        default: "",
      },
    },
  },

  launchers: [
    {
      id: "chat-nav",
      displayName: "Chat",
      description: "Open the AI chat page",
      placementZone: "sidebar",
      action: {
        type: "navigate",
        target: "plugins/paperclip-chat",
      },
    },
  ],

  ui: {
    slots: [
      {
        type: "page",
        id: "chat-page",
        displayName: "Chat",
        exportName: "ChatPage",
      },
      {
        type: "sidebarPanel",
        id: "chat-sidebar",
        displayName: "Chat",
        exportName: "ChatSidebarPanel",
      },
    ],
  },
};

export default manifest;
