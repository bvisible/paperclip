/**
 * Barrel export for all runtime tool handlers + their declarations.
 *
 * Each entry provides:
 * - `name`       — unique tool name (matches manifest declaration)
 * - `declaration`— PluginToolDeclaration subset used by `ctx.tools.register`
 * - `run`        — the runtime handler
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import { runSeoGscKeywords, seoGscKeywordsDeclaration, type SeoGscKeywordsParams } from "./seo/gsc-keywords.js";
import { runSeoGscTopPages, seoGscTopPagesDeclaration, type SeoGscTopPagesParams } from "./seo/gsc-top-pages.js";
import { runSeoQuickWins, seoQuickWinsDeclaration, type SeoQuickWinsParams } from "./seo/quick-wins.js";
import type { GscConfig } from "../adapters/gsc.js";
import { runSeoRobotsCheck, seoRobotsCheckDeclaration, type SeoRobotsCheckParams } from "./seo/robots-check.js";
import { runSeoSitemapCheck, seoSitemapCheckDeclaration, type SeoSitemapCheckParams } from "./seo/sitemap-check.js";
import { runSeoPageSpeed, seoPageSpeedDeclaration, type SeoPageSpeedParams, type PageSpeedConfig } from "./seo/pagespeed.js";
import { runSeoContentAudit, seoContentAuditDeclaration, type SeoContentAuditParams } from "./seo/content-audit.js";
import { runSeoCompetitorPageRank, seoCompetitorPageRankDeclaration, type SeoCompetitorPageRankParams, type OpenPageRankConfig } from "./seo/competitor-pagerank.js";
import { runContentGenerateSocialPosts, contentGenerateSocialPostsDeclaration, type ContentGenerateSocialPostsParams } from "./content/generate-social-posts.js";
import { runContentTopicIdeas, contentTopicIdeasDeclaration, type ContentTopicIdeasParams } from "./content/topic-ideas.js";
import { runWpListPosts, wpListPostsDeclaration, type WpListPostsParams } from "./wordpress/list-posts.js";
import { runWpCreatePost, wpCreatePostDeclaration, type WpCreatePostParams } from "./wordpress/create-post.js";
import { runWpUpdatePost, wpUpdatePostDeclaration, type WpUpdatePostParams } from "./wordpress/update-post.js";
import { runWpListCategories, wpListCategoriesDeclaration, type WpListCategoriesParams } from "./wordpress/list-categories.js";
import { runWpSiteHealth, wpSiteHealthDeclaration, type WpSiteHealthParams } from "./wordpress/site-health.js";
import type { WordPressConfig } from "../adapters/wordpress.js";
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
  getPageSpeedConfig(companyId: string): Promise<PageSpeedConfig>;
  getOpenPageRankConfig(companyId: string): Promise<OpenPageRankConfig>;
  getWordPressConfig(companyId: string): Promise<WordPressConfig>;
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
  {
    name: "seoPageSpeed",
    declaration: seoPageSpeedDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getPageSpeedConfig(runCtx.companyId);
      return runSeoPageSpeed(params as SeoPageSpeedParams, config, runCtx);
    },
  },
  {
    name: "seoContentAudit",
    declaration: seoContentAuditDeclaration,
    run: async (params, runCtx, _ctxAccess) =>
      runSeoContentAudit(params as SeoContentAuditParams, runCtx),
  },
  {
    name: "seoCompetitorPageRank",
    declaration: seoCompetitorPageRankDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getOpenPageRankConfig(runCtx.companyId);
      return runSeoCompetitorPageRank(params as SeoCompetitorPageRankParams, config, runCtx);
    },
  },
  // ─── Content (stateless) ─────────────────────────────────────────────
  {
    name: "contentGenerateSocialPosts",
    declaration: contentGenerateSocialPostsDeclaration,
    run: async (params, runCtx, _ctxAccess) =>
      runContentGenerateSocialPosts(params as ContentGenerateSocialPostsParams, runCtx),
  },
  {
    name: "contentTopicIdeas",
    declaration: contentTopicIdeasDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getGscConfig(runCtx.companyId);
      return runContentTopicIdeas(params as ContentTopicIdeasParams, config, runCtx);
    },
  },
  // ─── WordPress (Application Password required) ──────────────────────
  {
    name: "wpListPosts",
    declaration: wpListPostsDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getWordPressConfig(runCtx.companyId);
      return runWpListPosts(params as WpListPostsParams, config, runCtx);
    },
  },
  {
    name: "wpCreatePost",
    declaration: wpCreatePostDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getWordPressConfig(runCtx.companyId);
      return runWpCreatePost(params as WpCreatePostParams, config, runCtx);
    },
  },
  {
    name: "wpUpdatePost",
    declaration: wpUpdatePostDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getWordPressConfig(runCtx.companyId);
      return runWpUpdatePost(params as WpUpdatePostParams, config, runCtx);
    },
  },
  {
    name: "wpListCategories",
    declaration: wpListCategoriesDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getWordPressConfig(runCtx.companyId);
      return runWpListCategories(params as WpListCategoriesParams, config, runCtx);
    },
  },
  {
    name: "wpSiteHealth",
    declaration: wpSiteHealthDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getWordPressConfig(runCtx.companyId);
      return runWpSiteHealth(params as WpSiteHealthParams, config, runCtx);
    },
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
  {
    name: "seoGscTopPages",
    declaration: seoGscTopPagesDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getGscConfig(runCtx.companyId);
      return runSeoGscTopPages(params as SeoGscTopPagesParams, config, runCtx);
    },
  },
  {
    name: "seoQuickWins",
    declaration: seoQuickWinsDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getGscConfig(runCtx.companyId);
      return runSeoQuickWins(params as SeoQuickWinsParams, config, runCtx);
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
