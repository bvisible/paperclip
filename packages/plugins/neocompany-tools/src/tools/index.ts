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
import { runSeoRobotsCheck, seoRobotsCheckDeclaration, type SeoRobotsCheckParams } from "./seo/robots-check.js";
import { runSeoSitemapCheck, seoSitemapCheckDeclaration, type SeoSitemapCheckParams } from "./seo/sitemap-check.js";
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
  // ─── Zero-config SEO tools (no secrets required) ─────────────────────
  {
    name: "seoRobotsCheck",
    declaration: seoRobotsCheckDeclaration,
    run: async (params, runCtx, _ctxAccess) =>
      runSeoRobotsCheck(params as SeoRobotsCheckParams, runCtx),
  },
  {
    name: "seoSitemapCheck",
    declaration: seoSitemapCheckDeclaration,
    run: async (params, runCtx, _ctxAccess) =>
      runSeoSitemapCheck(params as SeoSitemapCheckParams, runCtx),
  },
  // ─── SEO tools that need Google OAuth ────────────────────────────────
  {
    name: "seoGscKeywords",
    declaration: seoGscKeywordsDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getGscConfig(runCtx.companyId);
      return runSeoGscKeywords(params as SeoGscKeywordsParams, config, runCtx);
    },
  },
  // ─── Email (provider secret required) ────────────────────────────────
  {
    name: "emailSendMessage",
    declaration: emailSendMessageDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getEmailSendConfig(runCtx.companyId, runCtx.agentId);
      return runEmailSendMessage(params as EmailSendParams, config, runCtx);
    },
  },
];
