/**
 * Barrel export for all runtime tool handlers + their declarations.
 *
 * Each entry provides:
 * - `name`       — unique tool name (matches manifest declaration)
 * - `declaration`— PluginToolDeclaration subset used by `ctx.tools.register`
 * - `run`        — the runtime handler
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import { runSeoGscKeywords, seoGscKeywordsDeclaration, type SeoGscKeywordsParams, type GscConfig } from "./seo/gsc-keywords.js";
import { runEmailSendMessage, emailSendMessageDeclaration, type EmailSendParams, type EmailSendConfig } from "./email/send.js";

export interface RegisteredToolEntry {
  name: string;
  declaration: {
    displayName: string;
    description: string;
    parametersSchema: Record<string, unknown>;
  };
  /**
   * Raw runtime handler. The worker wraps this with config resolution
   * (secret refs, per-agent identity) before registering it on
   * `ctx.tools.register`.
   */
  run: (params: unknown, runCtx: ToolRunContext, ctxAccess: ToolContextAccess) => Promise<ToolResult>;
}

/**
 * Helpers exposed to tool handlers so they can resolve config + secrets
 * without knowing about the plugin context internals.
 */
export interface ToolContextAccess {
  getGscConfig(companyId: string): Promise<GscConfig>;
  getEmailSendConfig(companyId: string, agentId: string): Promise<EmailSendConfig>;
}

export const ALL_TOOLS: RegisteredToolEntry[] = [
  {
    name: "seoGscKeywords",
    declaration: seoGscKeywordsDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getGscConfig(runCtx.companyId);
      return runSeoGscKeywords(params as SeoGscKeywordsParams, config, runCtx);
    },
  },
  {
    name: "emailSendMessage",
    declaration: emailSendMessageDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getEmailSendConfig(runCtx.companyId, runCtx.agentId);
      return runEmailSendMessage(params as EmailSendParams, config, runCtx);
    },
  },
];
