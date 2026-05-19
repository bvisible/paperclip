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
import { runSeoTrendAnalysis, seoTrendAnalysisDeclaration, type SeoTrendAnalysisParams } from "./seo/trend-analysis.js";
import { runGeoVisibilityCheck, geoVisibilityCheckDeclaration, type GeoVisibilityCheckParams } from "./seo/geo-visibility-check.js";
import { runGeoAITraffic, geoAITrafficDeclaration, type GeoAITrafficParams } from "./seo/geo-ai-traffic.js";
import { runSeoGa4Traffic, seoGa4TrafficDeclaration, type SeoGa4TrafficParams } from "./seo/ga4-traffic.js";
import { runSeoGa4TopPages, seoGa4TopPagesDeclaration, type SeoGa4TopPagesParams } from "./seo/ga4-top-pages.js";
import type { GscConfig } from "../adapters/gsc.js";
import type { Ga4Config } from "../adapters/ga4.js";
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
import {
  runProductCatalogSync,
  wcSyncCatalogDeclaration,
  type ProductCatalogSyncParams,
} from "./woocommerce/sync-catalog.js";
import {
  runWcListProducts,
  wcListProductsDeclaration,
  type WcListProductsParams,
} from "./woocommerce/list-products.js";
import {
  runWcGetProduct,
  wcGetProductDeclaration,
  type WcGetProductParams,
} from "./woocommerce/get-product.js";
import { runEmailSendMessage, emailSendMessageDeclaration, type EmailSendParams, type EmailSendConfig } from "./email/send.js";
import { runEmailListMessages, emailListMessagesDeclaration, type EmailListMessagesParams } from "./email/inbox-list.js";
import { runEmailReadMessage, emailReadMessageDeclaration, type EmailReadMessageParams } from "./email/inbox-read.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { runTemplateCreate } from "./content/template-create.js";
import { runTemplateList } from "./content/template-list.js";
import { runTemplateApply } from "./content/template-apply.js";
import { runImageGenerate } from "./content/image-generate.js";
import { runImageList } from "./content/image-list.js";
import { runImageApprove } from "./content/image-approve.js";
import { runImageDelete } from "./content/image-delete.js";

/**
 * Optional per-tool configuration schema — subset of JSON Schema we render
 * as a form in the Settings UI. Only tools that expose a `configSchema`
 * get a cogwheel next to their entry.
 *
 * The config values live in `plugin_state` scope=company, key
 * `tool-config:<toolName>`. The tool handler reads them via
 * `ctxAccess.getToolConfig(companyId, toolName, defaults)` and merges
 * them with any explicit call parameters (call params always win).
 */
export interface ToolConfigField {
  name: string;
  /** Free-form label rendered above the input. */
  label: string;
  /** Field type — drives the input widget. */
  type: "string" | "url" | "number" | "boolean" | "enum";
  description?: string;
  /** Default value shown when the company hasn't saved anything. */
  default?: string | number | boolean;
  /** Enum options — only used when `type === "enum"`. */
  options?: Array<{ value: string; label: string }>;
  /** Marks the field as required (UI hint; the worker tolerates absence). */
  required?: boolean;
}

export interface ToolConfigSchema {
  title: string;
  description?: string;
  fields: ToolConfigField[];
}

export interface RegisteredToolEntry {
  name: string;
  declaration: {
    displayName: string;
    description: string;
    parametersSchema: Record<string, unknown>;
  };
  /**
   * Optional per-company configuration schema. Tools without one don't
   * get a cogwheel in the Settings UI.
   */
  configSchema?: ToolConfigSchema;
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
  getGa4Config(companyId: string): Promise<Ga4Config>;
  getEmailSendConfig(companyId: string, agentId: string): Promise<EmailSendConfig>;
  getPageSpeedConfig(companyId: string): Promise<PageSpeedConfig>;
  getOpenPageRankConfig(companyId: string): Promise<OpenPageRankConfig>;
  getWordPressConfig(companyId: string): Promise<WordPressConfig>;
  /**
   * Resolve the per-company tool config for a given tool name. Returns
   * the user-provided values merged on top of `defaults`. Call params
   * take precedence over this config in the tool handler.
   */
  getToolConfig<T extends Record<string, unknown>>(
    companyId: string,
    toolName: string,
    defaults: T,
  ): Promise<T>;
  /**
   * Plugin context — exposed for the email inbox tools that need
   * `ctx.entities.list` directly. Other tools should keep using the
   * specialised `getXxxConfig` helpers.
   */
  getPluginContext(): PluginContext;
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
    configSchema: {
      title: "PageSpeed defaults",
      description: "Fallbacks used when the agent calls seoPageSpeed without those params.",
      fields: [
        {
          name: "defaultStrategy",
          label: "Default audit strategy",
          type: "enum",
          options: [
            { value: "mobile", label: "Mobile" },
            { value: "desktop", label: "Desktop" },
          ],
          default: "mobile",
        },
      ],
    },
    run: async (params, runCtx, ctxAccess) => {
      const [config, toolCfg] = await Promise.all([
        ctxAccess.getPageSpeedConfig(runCtx.companyId),
        ctxAccess.getToolConfig(runCtx.companyId, "seoPageSpeed", {
          defaultStrategy: "mobile" as "mobile" | "desktop",
        }),
      ]);
      const merged = {
        ...(params as SeoPageSpeedParams),
        strategy: (params as SeoPageSpeedParams).strategy ?? toolCfg.defaultStrategy,
      };
      return runSeoPageSpeed(merged, config, runCtx);
    },
  },
  {
    name: "seoContentAudit",
    declaration: seoContentAuditDeclaration,
    configSchema: {
      title: "Content audit defaults",
      fields: [
        {
          name: "defaultUrl",
          label: "Default URL to audit",
          type: "url",
          description: "Used when the agent calls seoContentAudit without a url.",
        },
      ],
    },
    run: async (params, runCtx, ctxAccess) => {
      const toolCfg = await ctxAccess.getToolConfig(runCtx.companyId, "seoContentAudit", {
        defaultUrl: "",
      });
      const merged = {
        ...(params as SeoContentAuditParams),
        url: (params as SeoContentAuditParams).url || toolCfg.defaultUrl,
      };
      return runSeoContentAudit(merged, runCtx);
    },
  },
  {
    name: "seoCompetitorPageRank",
    declaration: seoCompetitorPageRankDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getOpenPageRankConfig(runCtx.companyId);
      return runSeoCompetitorPageRank(params as SeoCompetitorPageRankParams, config, runCtx);
    },
  },
  {
    name: "geoVisibilityCheck",
    declaration: geoVisibilityCheckDeclaration,
    run: async (params, runCtx, _ctxAccess) =>
      runGeoVisibilityCheck(params as GeoVisibilityCheckParams, runCtx),
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
    configSchema: {
      title: "List WordPress posts defaults",
      fields: [
        {
          name: "defaultStatus",
          label: "Default status filter",
          type: "enum",
          options: [
            { value: "any", label: "Any" },
            { value: "publish", label: "Published" },
            { value: "draft", label: "Draft" },
            { value: "pending", label: "Pending" },
          ],
          default: "any",
        },
        {
          name: "defaultPerPage",
          label: "Default page size",
          type: "number",
          default: 10,
        },
      ],
    },
    run: async (params, runCtx, ctxAccess) => {
      const [config, toolCfg] = await Promise.all([
        ctxAccess.getWordPressConfig(runCtx.companyId),
        ctxAccess.getToolConfig(runCtx.companyId, "wpListPosts", {
          defaultStatus: "any" as "any" | "publish" | "draft" | "pending",
          defaultPerPage: 10,
        }),
      ]);
      const merged = {
        ...(params as WpListPostsParams),
        status: (params as WpListPostsParams).status ?? toolCfg.defaultStatus,
        perPage: (params as WpListPostsParams).perPage ?? toolCfg.defaultPerPage,
      };
      return runWpListPosts(merged, config, runCtx);
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
  //// Neocompany Modification — WooCommerce catalog tools.
  //// wcSyncCatalog needs WordPress credentials (Basic Auth), while
  //// wcListProducts and wcGetProduct read from plugin_entities directly
  //// (locally-synced catalog) so they don't require WP creds at call time.
  //// End Neocompany Modification
  {
    name: "wcSyncCatalog",
    declaration: wcSyncCatalogDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getWordPressConfig(runCtx.companyId);
      return runProductCatalogSync(params as ProductCatalogSyncParams, config, runCtx, ctxAccess);
    },
  },
  {
    name: "wcListProducts",
    declaration: wcListProductsDeclaration,
    run: async (params, runCtx, ctxAccess) =>
      runWcListProducts(params as WcListProductsParams, undefined, runCtx, ctxAccess),
  },
  {
    name: "wcGetProduct",
    declaration: wcGetProductDeclaration,
    run: async (params, runCtx, ctxAccess) =>
      runWcGetProduct(params as WcGetProductParams, undefined, runCtx, ctxAccess),
  },
  // ─── SEO tools that need Google OAuth ────────────────────────────────
  {
    name: "seoGscKeywords",
    declaration: seoGscKeywordsDeclaration,
    configSchema: {
      title: "GSC keywords defaults",
      description: "Defaults applied when the agent doesn't pass siteUrl/limit explicitly.",
      fields: [
        {
          name: "defaultSiteUrl",
          label: "Default GSC property URL",
          type: "url",
          description: "e.g. https://neoservice.ai/ or sc-domain:neoservice.ai",
        },
        {
          name: "defaultLimit",
          label: "Default number of keywords",
          type: "number",
          default: 25,
        },
      ],
    },
    run: async (params, runCtx, ctxAccess) => {
      const [config, toolCfg] = await Promise.all([
        ctxAccess.getGscConfig(runCtx.companyId),
        ctxAccess.getToolConfig(runCtx.companyId, "seoGscKeywords", {
          defaultSiteUrl: "",
          defaultLimit: 25,
        }),
      ]);
      const merged = {
        ...(params as SeoGscKeywordsParams),
        siteUrl: (params as SeoGscKeywordsParams).siteUrl || toolCfg.defaultSiteUrl,
        limit: (params as SeoGscKeywordsParams).limit ?? toolCfg.defaultLimit,
      };
      return runSeoGscKeywords(merged, config, runCtx);
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
  {
    name: "seoTrendAnalysis",
    declaration: seoTrendAnalysisDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getGscConfig(runCtx.companyId);
      return runSeoTrendAnalysis(params as SeoTrendAnalysisParams, config, runCtx);
    },
  },
  {
    name: "seoGa4Traffic",
    declaration: seoGa4TrafficDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getGa4Config(runCtx.companyId);
      return runSeoGa4Traffic(params as SeoGa4TrafficParams, config, runCtx);
    },
  },
  {
    name: "seoGa4TopPages",
    declaration: seoGa4TopPagesDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getGa4Config(runCtx.companyId);
      return runSeoGa4TopPages(params as SeoGa4TopPagesParams, config, runCtx);
    },
  },
  {
    name: "geoAITraffic",
    declaration: geoAITrafficDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const config = await ctxAccess.getGa4Config(runCtx.companyId);
      return runGeoAITraffic(params as GeoAITrafficParams, config, runCtx);
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
  {
    name: "emailListMessages",
    declaration: emailListMessagesDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const ctx = ctxAccess.getPluginContext();
      return runEmailListMessages(ctx, params as EmailListMessagesParams, runCtx);
    },
  },
  {
    name: "emailReadMessage",
    declaration: emailReadMessageDeclaration,
    run: async (params, runCtx, ctxAccess) => {
      const ctx = ctxAccess.getPluginContext();
      return runEmailReadMessage(ctx, params as EmailReadMessageParams, runCtx);
    },
  },
  // ─── Template tools (brand template CRUD + compositor) ──────────────
  {
    name: "templateCreate",
    declaration: {
      displayName: "Create brand template",
      description:
        "Create a new brand template for image compositing. Specify dimensions via a preset (e.g. instagram-square) or custom width/height. Optionally provide a partial config for logo, text zones, filters, overlay, and border.",
      parametersSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Template name" },
          description: { type: "string", description: "Optional description" },
          preset: {
            type: "string",
            description: "Dimension preset: instagram-square, instagram-portrait, instagram-story, facebook-post, linkedin-post, twitter-post, pinterest-pin, youtube-thumbnail",
          },
          width: { type: "number", description: "Custom width in pixels (overrides preset)" },
          height: { type: "number", description: "Custom height in pixels (overrides preset)" },
          config: { type: "object", description: "Partial TemplateConfig (logo, textZones, filters, overlay, border, backgroundColor, imageFit)" },
        },
        required: ["name"],
      },
    },
    run: async (params, runCtx, ctxAccess) =>
      runTemplateCreate(params as { name: string; description?: string; preset?: string; width?: number; height?: number; config?: Record<string, unknown> }, {}, runCtx, ctxAccess),
  },
  {
    name: "templateList",
    declaration: {
      displayName: "List brand templates",
      description: "List all brand templates for the current company.",
      parametersSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max number of templates to return (default 50)" },
        },
      },
    },
    run: async (params, runCtx, ctxAccess) =>
      runTemplateList(params as { limit?: number }, {}, runCtx, ctxAccess),
  },
  {
    name: "templateApply",
    declaration: {
      displayName: "Apply brand template to image",
      description:
        "Apply a brand template to a source image URL. Downloads the source, composites it with the template config (logo, text, filters, overlay, border), and returns the result as a data URL.",
      parametersSchema: {
        type: "object",
        properties: {
          templateId: { type: "string", description: "ID of the brand template to apply" },
          sourceImageUrl: { type: "string", description: "URL of the source image to composite" },
          logoUrl: { type: "string", description: "Optional URL of a logo image to overlay" },
        },
        required: ["templateId", "sourceImageUrl"],
      },
    },
    run: async (params, runCtx, ctxAccess) =>
      runTemplateApply(params as { templateId: string; sourceImageUrl: string; logoUrl?: string }, {}, runCtx, ctxAccess),
  },
  // ─── Image generation & approval stock ──────────────────────────────
  {
    name: "imageGenerate",
    declaration: {
      displayName: "Generate image with AI",
      description:
        "Generate a new image via an AI provider (OpenAI gpt-image-2 by default). If a templateId is provided, the brand template is composited on top of the raw image before saving. If a productId is provided, the prompt is grounded in the product's name + description and the product's gallery images are attached as references. The image is saved as a pending generated_image entity and must be approved to enter the stock.",
      parametersSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Free-form description of the image to generate" },
          templateId: { type: "string", description: "Optional brand template id (externalId) to composite on top" },
          provider: { type: "string", description: "AI provider — currently only 'openai' is supported" },
          width: { type: "number", description: "Desired width in pixels (ignored if templateId is set)" },
          height: { type: "number", description: "Desired height in pixels (ignored if templateId is set)" },
          batchId: { type: "string", description: "Optional batch id to group several generations together" },
          logoUrl: { type: "string", description: "Optional logo URL when compositing with a template" },
          referenceImageIds: {
            type: "array",
            description: "Optional library image ids to feed as references (codex-cli `-i`).",
            items: { type: "string" },
          },
          referenceImageUrls: {
            type: "array",
            description: "Optional raw data: / https URLs to use as references.",
            items: { type: "string" },
          },
          productId: {
            type: "string",
            description: "Optional catalog product externalId (e.g. `wc-123`) to ground the generation in a specific product.",
          },
        },
        required: ["prompt"],
      },
    },
    run: async (params, runCtx, ctxAccess) =>
      runImageGenerate(
        params as { prompt: string; templateId?: string; provider?: "openai" | "gemini" | "codex-cli"; width?: number; height?: number; batchId?: string; logoUrl?: string; referenceImageIds?: string[]; referenceImageUrls?: string[]; productId?: string },
        {},
        runCtx,
        ctxAccess,
      ),
  },
  {
    name: "imageList",
    declaration: {
      displayName: "List generated images",
      description: "List generated images for the current company, optionally filtered by status or batchId.",
      parametersSchema: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filter by approval status: pending, approved, rejected" },
          batchId: { type: "string", description: "Filter by batch id" },
          limit: { type: "number", description: "Max records to return (default 50)" },
          includeImages: { type: "boolean", description: "Include the heavy dataUrl payload (default true)" },
        },
      },
    },
    run: async (params, runCtx, ctxAccess) =>
      runImageList(
        params as { status?: "pending" | "approved" | "rejected"; batchId?: string; limit?: number; includeImages?: boolean },
        {},
        runCtx,
        ctxAccess,
      ),
  },
  {
    name: "imageApprove",
    declaration: {
      displayName: "Approve or reject a generated image",
      description: "Mark a generated image as approved, rejected, or pending (review state). Approved images make up the company's image stock.",
      parametersSchema: {
        type: "object",
        properties: {
          imageId: { type: "string", description: "Image id (externalId slug)" },
          status: { type: "string", description: "New status: pending, approved, rejected" },
          feedback: { type: "string", description: "Optional reviewer feedback" },
        },
        required: ["imageId", "status"],
      },
    },
    run: async (params, runCtx, ctxAccess) =>
      runImageApprove(
        params as { imageId: string; status: "pending" | "approved" | "rejected"; feedback?: string },
        {},
        runCtx,
        ctxAccess,
      ),
  },
  {
    name: "imageDelete",
    declaration: {
      displayName: "Delete a generated image",
      description: "Permanently remove a generated image from the company's stock/pool.",
      parametersSchema: {
        type: "object",
        properties: {
          imageId: { type: "string", description: "Image id (externalId slug)" },
        },
        required: ["imageId"],
      },
    },
    run: async (params, runCtx, ctxAccess) =>
      runImageDelete(params as { imageId: string }, {}, runCtx, ctxAccess),
  },
];
