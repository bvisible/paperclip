/**
 * NeoCompany Tools — plugin worker entrypoint.
 *
 * Responsibilities:
 * - Register each tool declared in the manifest via `ctx.tools.register()`.
 * - Resolve per-tool config + secrets from `ctx.config` + `ctx.secrets` at
 *   invocation time (never cached).
 * - Enforce per-company and per-agent access control before dispatching.
 * - Log every invocation to `ctx.activity.log` for audit.
 */

import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext, ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import { ALL_TOOLS, type ToolContextAccess } from "./tools/index.js";
import { TOOL_REGISTRY, CATEGORY_LABELS, type ToolMetadata } from "./tools/registry.js";
import { runImapPollJob } from "./email/poller.js";
import { pollImapAccount } from "./email/imap-client.js";
import type { EmailAccountData } from "./email/types.js";
import { IMAGE_ENTITY_TYPE, type GeneratedImageData } from "./images/types.js";
import { getProvider, listAvailableProviders } from "./integrations/registry.js";
import type {
  PendingOAuthState,
  SocialProviderKey,
  StoredChannelToken,
} from "./integrations/types.js";
import { randomState } from "./integrations/base.js";
import {
  EDITORIAL_STRATEGY_ENTITY_TYPE,
  EDITORIAL_STRATEGY_SINGLETON_EXTERNAL_ID,
  SOCIAL_POST_ENTITY_TYPE,
  type EditorialStrategyData,
  type SocialPostChannel,
  type SocialPostData,
  type SocialPostStatus,
} from "./social/types.js";

const PLUGIN_NAME = "neocompany-tools";

/**
 * Platform config — read from `plugin_config` via `ctx.config.get()`.
 *
 * The admin bridge routes (`PUT /api/plugins/neocompany-tools/bridge/platform`)
 * write these fields via `pluginRegistryService.patchConfig` behind
 * `assertInstanceAdmin`. Regular company users never see the write form
 * in the Settings UI.
 *
 * We keep the fields declared in `manifest.instanceConfigSchema` so the
 * plugin-secrets-handler (see plugin-secrets-handler.ts line 288-309)
 * accepts the referenced secret UUIDs when the worker resolves them.
 */
interface PlatformConfig {
  googleClientId?: string;
  googleClientSecretRef?: string;
  googleRefreshTokenRef?: string;
  googlePsiApiKeyRef?: string;
  openPageRankApiKeyRef?: string;
  resendApiKeyRef?: string;
  /** Legacy key name (kept for backwards-compat with migrated installs). */
  defaultFromAddress?: string;
  /** New key name used by the bridge routes. */
  resendDefaultFrom?: string;
  openaiApiKeyRef?: string;
  linkedinClientId?: string;
  linkedinClientSecretRef?: string;
  facebookAppId?: string;
  facebookAppSecretRef?: string;
}

/**
 * Company-scoped config — written by any user with access to a company
 * through the regular Settings UI flow (data handlers + actions below).
 */
interface BrandConfig {
  tagline?: string;
  website?: string;
  primaryFont?: string;
  secondaryFont?: string;
}

interface CompanyConfig {
  gscSiteUrl?: string;
  ga4PropertyId?: string;
  wordpressSiteUrl?: string;
  wordpressUsername?: string;
  wordpressAppPasswordRef?: string;
  agentEmailIdentities?: Record<string, { address: string; fromName?: string; signature?: string }>;
  brand?: BrandConfig;
}

const COMPANY_KEYS = {
  gscSiteUrl: "company:gsc:siteUrl",
  ga4PropertyId: "company:ga4:propertyId",
  wordpressSiteUrl: "company:wordpress:siteUrl",
  wordpressUsername: "company:wordpress:username",
  wordpressAppPasswordRef: "company:wordpress:appPasswordRef",
  brand: "company:brand",
} as const;

async function readPlatformConfig(ctx: PluginContext): Promise<PlatformConfig> {
  const raw = (await ctx.config.get()) as PlatformConfig | null;
  return raw ?? {};
}

async function resolveProviderCreds(
  ctx: PluginContext,
  platform: PlatformConfig,
  provider: "linkedin" | "facebook" | "instagram",
): Promise<{ clientId: string; clientSecret: string }> {
  let clientId: string | undefined;
  let clientSecretRef: string | undefined;
  if (provider === "linkedin") {
    clientId = platform.linkedinClientId;
    clientSecretRef = platform.linkedinClientSecretRef;
  } else if (provider === "facebook" || provider === "instagram") {
    clientId = platform.facebookAppId;
    clientSecretRef = platform.facebookAppSecretRef;
  }
  if (!clientId) throw new Error(`${provider} client id is not configured`);
  if (!clientSecretRef) throw new Error(`${provider} client secret is not configured`);
  const clientSecret = await ctx.secrets.resolve(clientSecretRef);
  if (!clientSecret) throw new Error(`${provider} client secret could not be resolved`);
  return { clientId, clientSecret };
}

async function readCompanyConfig(ctx: PluginContext, companyId: string): Promise<CompanyConfig> {
  const readKey = async (key: string) => {
    try {
      const raw = await ctx.state.get({ scopeKind: "company", scopeId: companyId, stateKey: key });
      return typeof raw === "string" ? raw : undefined;
    } catch {
      return undefined;
    }
  };
  const readJson = async (key: string) => {
    try {
      const raw = await ctx.state.get({ scopeKind: "company", scopeId: companyId, stateKey: key });
      return raw ?? undefined;
    } catch {
      return undefined;
    }
  };
  const [
    gscSiteUrl,
    ga4PropertyId,
    wordpressSiteUrl,
    wordpressUsername,
    wordpressAppPasswordRef,
    brand,
  ] = await Promise.all([
    readKey(COMPANY_KEYS.gscSiteUrl),
    readKey(COMPANY_KEYS.ga4PropertyId),
    readKey(COMPANY_KEYS.wordpressSiteUrl),
    readKey(COMPANY_KEYS.wordpressUsername),
    readKey(COMPANY_KEYS.wordpressAppPasswordRef),
    readJson(COMPANY_KEYS.brand),
  ]);
  return {
    gscSiteUrl,
    ga4PropertyId,
    wordpressSiteUrl,
    wordpressUsername,
    wordpressAppPasswordRef,
    brand,
  };
}

// (Phase D3 migration removed — we now keep platform config in plugin_config
// where the plugin-secrets-handler's allowlist extractor can find it. The
// bridge routes in server/src/routes/plugin-neocompany-bridge.ts write
// through pluginRegistryService.patchConfig behind assertInstanceAdmin.)

/**
 * Build the `ToolContextAccess` helper bound to the current worker context.
 * Each call resolves live values — we never cache secrets across runs.
 */
function makeCtxAccess(ctx: PluginContext): ToolContextAccess {
  return {
    getPluginContext() {
      return ctx;
    },

    async getToolConfig(companyId, toolName, defaults) {
      try {
        const raw = await ctx.state.get({
          scopeKind: "company",
          scopeId: companyId,
          stateKey: `tool-config:${toolName}`,
        });
        if (!raw || typeof raw !== "object") return defaults;
        return { ...defaults, ...(raw as Record<string, unknown>) } as typeof defaults;
      } catch {
        return defaults;
      }
    },

    async getGscConfig(_companyId: string) {
      const platform = await readPlatformConfig(ctx);
      if (!platform.googleClientId) throw new Error("Google OAuth client ID is not configured");
      if (!platform.googleClientSecretRef) throw new Error("Google OAuth client secret is not configured");
      if (!platform.googleRefreshTokenRef) throw new Error("Google OAuth refresh token is not configured");
      const [clientSecret, refreshToken] = await Promise.all([
        ctx.secrets.resolve(platform.googleClientSecretRef),
        ctx.secrets.resolve(platform.googleRefreshTokenRef),
      ]);
      return {
        clientId: platform.googleClientId,
        clientSecret,
        refreshToken,
      };
    },

    async getGa4Config(companyId: string) {
      const [platform, company] = await Promise.all([
        readPlatformConfig(ctx),
        readCompanyConfig(ctx, companyId),
      ]);
      if (!platform.googleClientId) throw new Error("Google OAuth client ID is not configured");
      if (!platform.googleClientSecretRef) throw new Error("Google OAuth client secret is not configured");
      if (!platform.googleRefreshTokenRef) throw new Error("Google OAuth refresh token is not configured");
      if (!company.ga4PropertyId) throw new Error("GA4 property ID is not configured for this company");
      const [clientSecret, refreshToken] = await Promise.all([
        ctx.secrets.resolve(platform.googleClientSecretRef),
        ctx.secrets.resolve(platform.googleRefreshTokenRef),
      ]);
      return {
        clientId: platform.googleClientId,
        clientSecret,
        refreshToken,
        propertyId: company.ga4PropertyId,
      };
    },

    async getPageSpeedConfig(_companyId: string) {
      const platform = await readPlatformConfig(ctx);
      if (!platform.googlePsiApiKeyRef) {
        // The Google PSI API has a public quota — calling without a key
        // still works at low volume. Only surface the key when configured.
        return {};
      }
      const apiKey = await ctx.secrets.resolve(platform.googlePsiApiKeyRef);
      return { apiKey };
    },

    async getWordPressConfig(companyId: string) {
      const company = await readCompanyConfig(ctx, companyId);
      if (!company.wordpressSiteUrl) throw new Error("WordPress site URL is not configured");
      if (!company.wordpressUsername) throw new Error("WordPress username is not configured");
      if (!company.wordpressAppPasswordRef) throw new Error("WordPress Application Password is not configured");
      const appPassword = await ctx.secrets.resolve(company.wordpressAppPasswordRef);
      return {
        siteUrl: company.wordpressSiteUrl,
        username: company.wordpressUsername,
        appPassword,
      };
    },

    async getOpenPageRankConfig(_companyId: string) {
      const platform = await readPlatformConfig(ctx);
      if (!platform.openPageRankApiKeyRef) return {};
      const apiKey = await ctx.secrets.resolve(platform.openPageRankApiKeyRef);
      return { apiKey };
    },

    async getEmailSendConfig(companyId: string, agentId: string) {
      const platform = await readPlatformConfig(ctx);
      if (!platform.resendApiKeyRef) throw new Error("Resend API key is not configured");
      const apiKey = await ctx.secrets.resolve(platform.resendApiKeyRef);

      // Prefer the agent's own email identity if set on metadata,
      // fall back to the platform default From address.
      let defaultFrom = platform.resendDefaultFrom ?? platform.defaultFromAddress ?? "";
      try {
        const agent = await ctx.agents.get(agentId, companyId);
        const metadata = (agent?.metadata ?? {}) as Record<string, unknown>;
        const identity = metadata.emailIdentity as { address?: string; fromName?: string } | undefined;
        if (identity?.address) {
          defaultFrom = identity.fromName
            ? `${identity.fromName} <${identity.address}>`
            : identity.address;
        }
      } catch {
        // Agent lookup failure falls back to the instance default
      }

      if (!defaultFrom) throw new Error("No email identity configured for this agent");
      return { provider: "resend", apiKey, defaultFrom };
    },
  };
}

/**
 * Check whether a tool is allowed for a given company + agent.
 *
 * MVP rules:
 * 1. If the company has an explicit category toggle OFF, deny.
 * 2. If the agent has an explicit allowlist in `metadata.neocompanyTools.allow`,
 *    require the tool name to be present.
 * 3. If the agent has an explicit denylist, require the tool to NOT be there.
 * 4. Otherwise, allow the tool.
 */
async function checkAccess(
  ctx: PluginContext,
  toolName: string,
  runCtx: ToolRunContext,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const meta = TOOL_REGISTRY[toolName];
  if (!meta) return { ok: false, reason: `Unknown tool "${toolName}"` };

  // Company-level category toggle — stored under scope=company
  try {
    const raw = await ctx.state.get({
      scopeKind: "company",
      scopeId: runCtx.companyId,
      stateKey: "access:categories",
    });
    const categories = (raw ?? {}) as Record<string, boolean>;
    if (categories[meta.category] === false) {
      return { ok: false, reason: `Category "${meta.category}" is disabled for this company` };
    }
  } catch {
    // No config yet — default-enabled behaviour
  }

  // Agent-level allow/deny list stored on agent metadata
  try {
    const agent = await ctx.agents.get(runCtx.agentId, runCtx.companyId);
    const metadata = (agent?.metadata ?? {}) as Record<string, unknown>;
    const access = metadata.neocompanyTools as { allow?: string[]; deny?: string[] } | undefined;
    if (access?.deny?.includes(toolName)) {
      return { ok: false, reason: `Tool "${toolName}" is denied for this agent` };
    }
    if (access?.allow && access.allow.length > 0 && !access.allow.includes(toolName)) {
      return { ok: false, reason: `Tool "${toolName}" is not in this agent's allowlist` };
    }
  } catch {
    // No metadata — fall through
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// UI data + actions helpers
// ---------------------------------------------------------------------------

interface CategoryToggleState {
  [category: string]: boolean;
}

async function getCategoryToggles(ctx: PluginContext, companyId: string): Promise<CategoryToggleState> {
  const raw = await ctx.state.get({
    scopeKind: "company",
    scopeId: companyId,
    stateKey: "access:categories",
  });
  return (raw ?? {}) as CategoryToggleState;
}

async function setCategoryToggles(
  ctx: PluginContext,
  companyId: string,
  value: CategoryToggleState,
): Promise<void> {
  await ctx.state.set(
    {
      scopeKind: "company",
      scopeId: companyId,
      stateKey: "access:categories",
    },
    value as unknown,
  );
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info(`${PLUGIN_NAME} plugin setup — registering ${ALL_TOOLS.length} tool(s)`);

    const ctxAccess = makeCtxAccess(ctx);

    // ── Data: full tool catalog grouped by category ──────────────────
    ctx.data.register("toolCatalog", async () => {
      // Build a map: toolName → configSchema (for tools that expose one)
      const configSchemaByName: Record<string, unknown> = {};
      for (const entry of ALL_TOOLS) {
        if (entry.configSchema) configSchemaByName[entry.name] = entry.configSchema;
      }

      const byCategory: Record<string, { label: string; tools: Array<ToolMetadata & { configSchema?: unknown }> }> = {};
      for (const meta of Object.values(TOOL_REGISTRY)) {
        const key = meta.category as string;
        if (!byCategory[key]) {
          byCategory[key] = {
            label: CATEGORY_LABELS[meta.category] ?? key,
            tools: [],
          };
        }
        byCategory[key].tools.push({
          ...meta,
          configSchema: configSchemaByName[meta.name],
        });
      }
      return {
        toolCount: Object.keys(TOOL_REGISTRY).length,
        categories: byCategory,
      };
    });

    // ── Data: per-company tool config ────────────────────────────────
    ctx.data.register("toolConfig", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const toolName = params.toolName as string;
      if (!companyId || !toolName) return { config: {} };
      const raw = await ctx.state.get({
        scopeKind: "company",
        scopeId: companyId,
        stateKey: `tool-config:${toolName}`,
      });
      return { config: raw ?? {} };
    });

    // ── Action: save per-company tool config ─────────────────────────
    ctx.actions.register("setToolConfig", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const toolName = params.toolName as string;
      const config = (params.config as Record<string, unknown>) ?? {};
      if (!companyId || !toolName) {
        throw new Error("setToolConfig requires companyId and toolName");
      }
      await ctx.state.set(
        {
          scopeKind: "company",
          scopeId: companyId,
          stateKey: `tool-config:${toolName}`,
        },
        config as unknown,
      );
      await ctx.activity.log({
        companyId,
        message: `Tool config updated for "${toolName}"`,
        entityType: "plugin-tool-config",
        entityId: toolName,
        metadata: { toolName, fields: Object.keys(config) },
      });
      return { ok: true, toolName };
    });

    // ── Data: current access state for a company (category toggles) ──
    ctx.data.register("accessState", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      if (!companyId) return { categoryToggles: {} };
      const categoryToggles = await getCategoryToggles(ctx, companyId);
      return { companyId, categoryToggles };
    });

    // ── Data: per-company config (GSC site, GA4 property, WordPress) ─
    ctx.data.register("companyConfig", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      if (!companyId) return { config: {} };
      const cfg = await readCompanyConfig(ctx, companyId);
      return { config: cfg };
    });

    // ── Action: save per-company config ──────────────────────────────
    ctx.actions.register("setCompanyConfig", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const patch = (params.patch ?? {}) as Partial<CompanyConfig>;
      if (!companyId) throw new Error("setCompanyConfig requires companyId");
      const writeKey = async (key: string, value: string | undefined) => {
        if (value === undefined) return;
        await ctx.state.set(
          { scopeKind: "company", scopeId: companyId, stateKey: key },
          value as unknown,
        );
      };
      await writeKey(COMPANY_KEYS.gscSiteUrl, patch.gscSiteUrl);
      await writeKey(COMPANY_KEYS.ga4PropertyId, patch.ga4PropertyId);
      await writeKey(COMPANY_KEYS.wordpressSiteUrl, patch.wordpressSiteUrl);
      await writeKey(COMPANY_KEYS.wordpressUsername, patch.wordpressUsername);
      await writeKey(COMPANY_KEYS.wordpressAppPasswordRef, patch.wordpressAppPasswordRef);
      // Brand is stored as a JSON object, not a plain string
      if ((patch as Record<string, unknown>).brand !== undefined) {
        await ctx.state.set(
          { scopeKind: "company", scopeId: companyId, stateKey: COMPANY_KEYS.brand },
          (patch as Record<string, unknown>).brand as unknown,
        );
      }
      await ctx.activity.log({
        companyId,
        message: `Company config updated (${Object.keys(patch).join(", ")})`,
        entityType: "plugin-company-config",
        entityId: companyId,
      });
      return { ok: true };
    });

    // ── Data: plugin instance config summary (which secrets are set) ─
    ctx.data.register("configSummary", async () => {
      const platform = await readPlatformConfig(ctx);
      return {
        googleOAuthConfigured:
          Boolean(platform.googleClientId) &&
          Boolean(platform.googleClientSecretRef) &&
          Boolean(platform.googleRefreshTokenRef),
        googlePsiKeyConfigured: Boolean(platform.googlePsiApiKeyRef),
        resendConfigured: Boolean(platform.resendApiKeyRef),
        defaultFromAddress: platform.resendDefaultFrom ?? platform.defaultFromAddress ?? "",
      };
    });

    // ── Data: list brand templates for a company ─────────────────────
    // Uses externalId as the stable public identifier so that `upsert()`
    // can dedup correctly on subsequent saves. Legacy rows (externalId=null)
    // are backfilled transparently the first time they are listed or saved.
    ctx.data.register("templateList", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      if (!companyId) return { templates: [] };
      const records = await ctx.entities.list({
        entityType: "brand_template",
        scopeKind: "company",
        scopeId: companyId,
        limit: 100,
      });
      // Backfill externalId for legacy rows created before the stable-id migration
      for (const r of records) {
        if (!r.externalId) {
          const slug = globalThis.crypto.randomUUID();
          await ctx.entities.upsert({
            entityType: "brand_template",
            scopeKind: "company",
            scopeId: companyId,
            externalId: slug,
            title: r.title ?? undefined,
            status: r.status ?? undefined,
            data: r.data,
          });
          await ctx.entities.delete({ id: r.id });
          r.externalId = slug;
        }
      }
      const templates = records.map((r) => ({
        id: r.externalId ?? r.id,
        ...(r.data as Record<string, unknown>),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
      return { companyId, templates };
    });

    // ── Action: save (create/update) a brand template ───────────────
    // `templateId` represents the stable externalId. When absent we generate
    // a fresh UUID so subsequent saves can round-trip to the same row.
    ctx.actions.register("templateSave", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const data = params.data as Record<string, unknown>;
      if (!companyId || !data) throw new Error("templateSave requires companyId and data");

      let templateId = params.templateId as string | undefined;
      if (!templateId) {
        templateId = globalThis.crypto.randomUUID();
      }

      const name = (data.name as string) ?? "Untitled";

      const record = await ctx.entities.upsert({
        entityType: "brand_template",
        scopeKind: "company",
        scopeId: companyId,
        externalId: templateId,
        title: name,
        status: "active",
        data,
      });

      await ctx.activity.log({
        companyId,
        message: `Brand template "${name}" saved`,
        entityType: "brand_template",
        entityId: record.id,
      });

      return { ok: true, templateId };
    });

    // ── Data + Actions: generated-image stock ───────────────────────
    // Mirrors the imageGenerate / imageList / imageApprove / imageDelete
    // tools so the UI can invoke them through the bridge without the
    // agent indirection. Agents still call them via the tool dispatcher.
    const makeImageRunCtx = (companyId: string, agentId?: string) => ({
      runId: globalThis.crypto.randomUUID(),
      companyId,
      projectId: companyId,
      agentId: agentId ?? "00000000-0000-0000-0000-000000000000",
    });

    ctx.data.register("imageList", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      if (!companyId) return { images: [], count: 0 };
      const { runImageList } = await import("./tools/content/image-list.js");
      const result = await runImageList(
        {
          status: params.status as "pending" | "approved" | "rejected" | undefined,
          batchId: params.batchId as string | undefined,
          limit: params.limit as number | undefined,
          includeImages: params.includeImages as boolean | undefined,
          source: params.source as "generated" | "upload" | undefined,
          tags: Array.isArray(params.tags) ? (params.tags as string[]) : undefined,
        },
        {},
        makeImageRunCtx(companyId),
        ctxAccess,
      );
      return result.data ?? { images: [], count: 0 };
    });

    ctx.actions.register("imageGenerate", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      if (!companyId) throw new Error("imageGenerate requires companyId");
      const { runImageGenerate } = await import("./tools/content/image-generate.js");
      const result = await runImageGenerate(
        {
          prompt: params.prompt as string,
          templateId: params.templateId as string | undefined,
          provider: (params.provider as "openai" | "gemini" | undefined) ?? "openai",
          width: params.width as number | undefined,
          height: params.height as number | undefined,
          batchId: params.batchId as string | undefined,
          logoUrl: params.logoUrl as string | undefined,
        },
        {},
        makeImageRunCtx(companyId),
        ctxAccess,
      );
      if (result.error) throw new Error(result.error);
      return result.data ?? {};
    });

    ctx.actions.register("imageApprove", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      if (!companyId) throw new Error("imageApprove requires companyId");
      const { runImageApprove } = await import("./tools/content/image-approve.js");
      const result = await runImageApprove(
        {
          imageId: params.imageId as string,
          status: params.status as "pending" | "approved" | "rejected",
          feedback: params.feedback as string | undefined,
        },
        {},
        makeImageRunCtx(companyId),
        ctxAccess,
      );
      if (result.error) throw new Error(result.error);
      return result.data ?? {};
    });

    ctx.actions.register("imageDelete", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      if (!companyId) throw new Error("imageDelete requires companyId");
      const { runImageDelete } = await import("./tools/content/image-delete.js");
      const result = await runImageDelete(
        { imageId: params.imageId as string },
        {},
        makeImageRunCtx(companyId),
        ctxAccess,
      );
      if (result.error) throw new Error(result.error);
      return result.data ?? {};
    });

    // ── Action: libraryUpload — user-uploaded image into the library ─
    ctx.actions.register("libraryUpload", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const imageDataUrl = params.imageDataUrl as string;
      if (!companyId) throw new Error("libraryUpload requires companyId");
      if (!imageDataUrl || !imageDataUrl.startsWith("data:")) {
        throw new Error("libraryUpload requires imageDataUrl (data: URL)");
      }
      const tags = Array.isArray(params.tags) ? (params.tags as string[]) : [];
      const width = typeof params.width === "number" ? params.width : 0;
      const height = typeof params.height === "number" ? params.height : 0;
      const filename = (params.filename as string | undefined) ?? "upload";

      const slug = globalThis.crypto.randomUUID();
      const now = new Date().toISOString();
      const data: GeneratedImageData = {
        prompt: "",
        source: "upload",
        tags,
        rawImageUrl: imageDataUrl,
        finalImageUrl: imageDataUrl,
        width,
        height,
        // Uploaded images are pre-approved by the user uploading them.
        status: "approved",
        createdAt: now,
      };

      await ctx.entities.upsert({
        entityType: IMAGE_ENTITY_TYPE,
        scopeKind: "company",
        scopeId: companyId,
        externalId: slug,
        title: filename.slice(0, 80),
        status: "approved",
        data: data as unknown as Record<string, unknown>,
      });

      await ctx.activity.log({
        companyId,
        message: `Uploaded image "${filename.slice(0, 50)}"`,
        entityType: IMAGE_ENTITY_TYPE,
        entityId: slug,
      });

      return { imageId: slug, width, height, status: "approved", source: "upload", tags };
    });

    // ── Action: libraryTag — edit tags on an existing library image ─
    ctx.actions.register("libraryTag", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const imageId = params.imageId as string;
      if (!companyId || !imageId) throw new Error("libraryTag requires companyId and imageId");
      const tags = Array.isArray(params.tags) ? (params.tags as string[]) : [];

      const records = await ctx.entities.list({
        entityType: IMAGE_ENTITY_TYPE,
        scopeKind: "company",
        scopeId: companyId,
        externalId: imageId,
        limit: 1,
      });
      const match = records[0];
      if (!match) return { ok: false, error: "IMAGE_NOT_FOUND" };

      const currentData = match.data as unknown as GeneratedImageData;
      const nextData: GeneratedImageData = { ...currentData, tags };

      await ctx.entities.upsert({
        entityType: IMAGE_ENTITY_TYPE,
        scopeKind: "company",
        scopeId: companyId,
        externalId: imageId,
        title: match.title ?? undefined,
        status: match.status ?? undefined,
        data: nextData as unknown as Record<string, unknown>,
      });

      return { ok: true, imageId, tags };
    });

    // ── Social channels (Phase K) ────────────────────────────────────
    //
    // All OAuth tokens live in plugin_state scope=company under the key
    // `channel:<provider>:<accountId>`. The public callback URL is shared
    // across the whole platform; the per-company identity is carried in
    // the `state` param (stored transiently under scope=instance).

    const channelKey = (provider: SocialProviderKey, accountId: string) =>
      `channel:${provider}:${accountId}`;
    const pendingOAuthKey = (state: string) => `oauth-pending:${state}`;

    // Redirect URI is derived from PAPERCLIP_PUBLIC_URL at runtime by the
    // server; the worker passes a symbolic placeholder that the bridge
    // route rewrites to the actual absolute URL before calling the
    // provider. This keeps OAuth app registration independent of env vars
    // the worker can read.
    const oauthCallbackPath = "/api/plugins/neocompany-tools/bridge/oauth/callback";
    const redactedToken = (t: StoredChannelToken) => ({
      provider: t.provider,
      accountId: t.accountId,
      accountName: t.accountName,
      iconUrl: t.iconUrl,
      expiresAt: t.expiresAt,
      scopes: t.scopes,
      connectedAt: t.connectedAt,
      refreshedAt: t.refreshedAt,
    });

    const listChannelsForCompany = async (companyId: string) => {
      // plugin_state has no "list by prefix" primitive yet — we rely on
      // the known set of providers + we attempt to read each account id
      // stored in an index key. We maintain a simple index under
      // `channel-index:<provider>` holding accountIds.
      const out: ReturnType<typeof redactedToken>[] = [];
      for (const provider of ["linkedin", "facebook", "instagram"] as SocialProviderKey[]) {
        const indexKey = `channel-index:${provider}`;
        const index = (await ctx.state.get({
          scopeKind: "company",
          scopeId: companyId,
          stateKey: indexKey,
        })) as string[] | null;
        if (!Array.isArray(index)) continue;
        for (const accountId of index) {
          const token = (await ctx.state.get({
            scopeKind: "company",
            scopeId: companyId,
            stateKey: channelKey(provider, accountId),
          })) as StoredChannelToken | null;
          if (token) out.push(redactedToken(token));
        }
      }
      return out;
    };

    ctx.data.register("channelsList", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      if (!companyId) return { channels: [], providers: [] };
      const channels = await listChannelsForCompany(companyId);
      const providers = listAvailableProviders().map((p) => ({
        key: p.key,
        displayName: p.displayName,
        recommendedFeedDimensions: p.recommendedFeedDimensions,
      }));
      return { channels, providers };
    });

    ctx.data.register("channelGet", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const provider = params.provider as SocialProviderKey;
      const accountId = params.accountId as string;
      if (!companyId || !provider || !accountId) return null;
      const token = (await ctx.state.get({
        scopeKind: "company",
        scopeId: companyId,
        stateKey: channelKey(provider, accountId),
      })) as StoredChannelToken | null;
      return token ? redactedToken(token) : null;
    });

    ctx.actions.register("channelConnectStart", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const provider = params.provider as SocialProviderKey;
      if (!companyId || !provider) {
        throw new Error("channelConnectStart requires companyId and provider");
      }
      const providerImpl = getProvider(provider);
      const platform = await readPlatformConfig(ctx);

      let clientId: string | undefined;
      if (provider === "linkedin") clientId = platform.linkedinClientId;
      else if (provider === "facebook" || provider === "instagram") clientId = platform.facebookAppId;
      if (!clientId) {
        throw new Error(`${provider} is not configured — platform admin must set the client id`);
      }

      const publicUrl = (params.publicUrl as string | undefined) ?? "";
      if (!publicUrl) {
        // The UI should pass window.location.origin; we refuse rather than
        // guess a URL that won't match the OAuth app's allowed list.
        throw new Error("channelConnectStart requires publicUrl (origin of this Paperclip instance)");
      }
      const redirectUri = `${publicUrl.replace(/\/+$/, "")}${oauthCallbackPath}`;

      const state = randomState();
      const auth = providerImpl.buildAuthUrl({
        clientId,
        redirectUri,
        state,
      });

      const returnTo = (params.returnTo as string | undefined) ?? `/content/channels?connected=${provider}`;

      const pending: PendingOAuthState = {
        state,
        provider,
        companyId,
        codeVerifier: auth.codeVerifier,
        expiresAt: Date.now() + 10 * 60 * 1000,
        returnTo,
      };
      await ctx.state.set(
        { scopeKind: "instance", stateKey: pendingOAuthKey(state) },
        pending as unknown as Record<string, unknown>,
      );

      return { url: auth.url, state };
    });

    ctx.actions.register("channelDisconnect", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const provider = params.provider as SocialProviderKey;
      const accountId = params.accountId as string;
      if (!companyId || !provider || !accountId) {
        throw new Error("channelDisconnect requires companyId, provider and accountId");
      }
      // Delete the token; keep the index clean as well.
      await ctx.state.delete({
        scopeKind: "company",
        scopeId: companyId,
        stateKey: channelKey(provider, accountId),
      });
      const indexKey = `channel-index:${provider}`;
      const index = (await ctx.state.get({
        scopeKind: "company",
        scopeId: companyId,
        stateKey: indexKey,
      })) as string[] | null;
      const next = (index ?? []).filter((id) => id !== accountId);
      await ctx.state.set(
        { scopeKind: "company", scopeId: companyId, stateKey: indexKey },
        next as unknown as Record<string, unknown>,
      );
      await ctx.activity.log({
        companyId,
        message: `Disconnected ${provider} channel ${accountId}`,
        entityType: "social-channel",
        entityId: `${provider}:${accountId}`,
      });
      return { ok: true };
    });

    ctx.actions.register("channelRefresh", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const provider = params.provider as SocialProviderKey;
      const accountId = params.accountId as string;
      if (!companyId || !provider || !accountId) {
        throw new Error("channelRefresh requires companyId, provider and accountId");
      }
      const providerImpl = getProvider(provider);
      if (!providerImpl.refreshToken) {
        throw new Error(`${provider} does not support token refresh`);
      }
      const stored = (await ctx.state.get({
        scopeKind: "company",
        scopeId: companyId,
        stateKey: channelKey(provider, accountId),
      })) as StoredChannelToken | null;
      if (!stored || !stored.refreshToken) {
        throw new Error("No refresh token available for this channel");
      }
      const platform = await readPlatformConfig(ctx);
      const { clientId, clientSecret } = await resolveProviderCreds(ctx, platform, provider);
      const fresh = await providerImpl.refreshToken({
        clientId,
        clientSecret,
        refreshToken: stored.refreshToken,
      });
      const next: StoredChannelToken = {
        ...stored,
        accessToken: fresh.accessToken,
        refreshToken: fresh.refreshToken ?? stored.refreshToken,
        expiresAt: fresh.expiresAt,
        scopes: fresh.scopes ?? stored.scopes,
        refreshedAt: new Date().toISOString(),
      };
      await ctx.state.set(
        { scopeKind: "company", scopeId: companyId, stateKey: channelKey(provider, accountId) },
        next as unknown as Record<string, unknown>,
      );
      return { ok: true, expiresAt: next.expiresAt };
    });

    // ── Editorial strategy + social post pipeline (Phase L) ─────────

    ctx.data.register("strategyGet", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      if (!companyId) return { strategy: null };
      const rows = await ctx.entities.list({
        entityType: EDITORIAL_STRATEGY_ENTITY_TYPE,
        scopeKind: "company",
        scopeId: companyId,
        externalId: EDITORIAL_STRATEGY_SINGLETON_EXTERNAL_ID,
        limit: 1,
      });
      const row = rows[0];
      return { strategy: row ? (row.data as unknown as EditorialStrategyData) : null };
    });

    ctx.actions.register("setEditorialStrategy", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      if (!companyId) throw new Error("setEditorialStrategy requires companyId");
      const strategy = params.strategy as EditorialStrategyData | undefined;
      if (!strategy || typeof strategy !== "object") {
        throw new Error("setEditorialStrategy requires strategy object");
      }
      const now = new Date().toISOString();
      const data: EditorialStrategyData = { ...strategy, updatedAt: now };
      await ctx.entities.upsert({
        entityType: EDITORIAL_STRATEGY_ENTITY_TYPE,
        scopeKind: "company",
        scopeId: companyId,
        externalId: EDITORIAL_STRATEGY_SINGLETON_EXTERNAL_ID,
        title: "Editorial strategy",
        status: "active",
        data: data as unknown as Record<string, unknown>,
      });
      await ctx.activity.log({
        companyId,
        message: "Editorial strategy updated",
        entityType: EDITORIAL_STRATEGY_ENTITY_TYPE,
        entityId: EDITORIAL_STRATEGY_SINGLETON_EXTERNAL_ID,
      });
      return { ok: true, strategy: data };
    });

    ctx.data.register("socialPostsList", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      if (!companyId) return { posts: [], count: 0 };
      const status = params.status as SocialPostStatus | undefined;
      const limit = typeof params.limit === "number" ? params.limit : 200;
      const rows = await ctx.entities.list({
        entityType: SOCIAL_POST_ENTITY_TYPE,
        scopeKind: "company",
        scopeId: companyId,
        limit,
      });
      let posts = rows.map((r) => {
        const d = r.data as unknown as SocialPostData;
        return {
          id: r.externalId ?? r.id,
          ...d,
          createdAt: d.createdAt ?? r.createdAt,
        };
      });
      if (status) posts = posts.filter((p) => p.status === status);
      // Newest first for approvals, chronological for calendar — caller sorts.
      posts.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      return { posts, count: posts.length };
    });

    ctx.actions.register("draftCreate", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      if (!companyId) throw new Error("draftCreate requires companyId");
      const channel = params.channel as SocialPostChannel | undefined;
      if (!channel?.provider || !channel.channelKey) {
        throw new Error("draftCreate requires channel.{provider, channelKey}");
      }
      const text = typeof params.text === "string" ? params.text : "";
      const imageId = typeof params.imageId === "string" ? params.imageId : undefined;
      const proposedAt = typeof params.proposedAt === "string"
        ? params.proposedAt
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const generatedByAgentId = typeof params.generatedByAgentId === "string"
        ? params.generatedByAgentId
        : undefined;
      const dimensions = (params.dimensions && typeof params.dimensions === "object")
        ? (params.dimensions as { width: number; height: number })
        : undefined;

      const slug = globalThis.crypto.randomUUID();
      const now = new Date().toISOString();
      const data: SocialPostData = {
        text,
        imageId,
        dimensions,
        channel,
        proposedAt,
        status: "pending_review",
        generatedByAgentId,
        createdAt: now,
      };
      await ctx.entities.upsert({
        entityType: SOCIAL_POST_ENTITY_TYPE,
        scopeKind: "company",
        scopeId: companyId,
        externalId: slug,
        title: text.slice(0, 80),
        status: "pending_review",
        data: data as unknown as Record<string, unknown>,
      });
      await ctx.activity.log({
        companyId,
        message: `Draft post created for ${channel.provider}`,
        entityType: SOCIAL_POST_ENTITY_TYPE,
        entityId: slug,
      });
      return { postId: slug, ...data };
    });

    const resolveSocialPost = async (companyId: string, postId: string) => {
      const rows = await ctx.entities.list({
        entityType: SOCIAL_POST_ENTITY_TYPE,
        scopeKind: "company",
        scopeId: companyId,
        externalId: postId,
        limit: 1,
      });
      return rows[0] ?? null;
    };

    ctx.actions.register("approveDraftPost", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const postId = params.postId as string;
      const scheduledAtOverride = params.scheduledAt as string | undefined;
      if (!companyId || !postId) throw new Error("approveDraftPost requires companyId and postId");
      const row = await resolveSocialPost(companyId, postId);
      if (!row) throw new Error("Post not found");
      const current = row.data as unknown as SocialPostData;
      const next: SocialPostData = {
        ...current,
        status: "scheduled",
        scheduledAt: scheduledAtOverride ?? current.proposedAt,
      };
      await ctx.entities.upsert({
        entityType: SOCIAL_POST_ENTITY_TYPE,
        scopeKind: "company",
        scopeId: companyId,
        externalId: postId,
        title: row.title ?? undefined,
        status: "scheduled",
        data: next as unknown as Record<string, unknown>,
      });
      await ctx.activity.log({
        companyId,
        message: `Draft post approved — scheduled for ${next.scheduledAt}`,
        entityType: SOCIAL_POST_ENTITY_TYPE,
        entityId: postId,
      });
      return { ok: true, status: "scheduled", scheduledAt: next.scheduledAt };
    });

    ctx.actions.register("rejectDraftPost", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const postId = params.postId as string;
      const feedback = params.feedback as string | undefined;
      if (!companyId || !postId) throw new Error("rejectDraftPost requires companyId and postId");
      const row = await resolveSocialPost(companyId, postId);
      if (!row) throw new Error("Post not found");
      const current = row.data as unknown as SocialPostData;
      const next: SocialPostData = {
        ...current,
        status: "rejected",
        rejectionFeedback: feedback,
      };
      await ctx.entities.upsert({
        entityType: SOCIAL_POST_ENTITY_TYPE,
        scopeKind: "company",
        scopeId: companyId,
        externalId: postId,
        title: row.title ?? undefined,
        status: "rejected",
        data: next as unknown as Record<string, unknown>,
      });
      return { ok: true };
    });

    ctx.actions.register("rescheduleSocialPost", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const postId = params.postId as string;
      const scheduledAt = params.scheduledAt as string;
      if (!companyId || !postId || !scheduledAt) {
        throw new Error("rescheduleSocialPost requires companyId, postId, scheduledAt");
      }
      const row = await resolveSocialPost(companyId, postId);
      if (!row) throw new Error("Post not found");
      const current = row.data as unknown as SocialPostData;
      const next: SocialPostData = { ...current, scheduledAt, proposedAt: scheduledAt };
      await ctx.entities.upsert({
        entityType: SOCIAL_POST_ENTITY_TYPE,
        scopeKind: "company",
        scopeId: companyId,
        externalId: postId,
        title: row.title ?? undefined,
        status: row.status ?? undefined,
        data: next as unknown as Record<string, unknown>,
      });
      return { ok: true, scheduledAt };
    });

    ctx.actions.register("cancelSocialPost", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const postId = params.postId as string;
      if (!companyId || !postId) throw new Error("cancelSocialPost requires companyId and postId");
      const row = await resolveSocialPost(companyId, postId);
      if (!row) return { ok: true };
      await ctx.entities.delete({ id: row.id });
      return { ok: true };
    });

    // ── Action: delete a brand template ──────────────────────────────
    ctx.actions.register("templateDelete", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const templateId = params.templateId as string;
      if (!companyId || !templateId) throw new Error("templateDelete requires companyId and templateId");

      // templateId is the externalId slug — resolve to the internal UUID
      const records = await ctx.entities.list({
        entityType: "brand_template",
        scopeKind: "company",
        scopeId: companyId,
        externalId: templateId,
        limit: 1,
      });
      const match = records[0];
      if (!match) {
        return { ok: false, error: "TEMPLATE_NOT_FOUND" };
      }

      await ctx.entities.delete({ id: match.id });
      await ctx.activity.log({
        companyId,
        message: `Brand template "${match.title ?? templateId}" deleted`,
        entityType: "brand_template",
        entityId: match.id,
      });

      return { ok: true, templateId };
    });

    // ── Job: IMAP poll (declared in manifest as "imap-poll") ─────────
    ctx.jobs.register("imap-poll", async (job) => {
      try {
        await runImapPollJob(ctx, job);
      } catch (err) {
        ctx.logger.error("imap-poll: unexpected error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // ── Action: enable/disable a category toggle for a company ───────
    ctx.actions.register("setCategoryEnabled", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const category = params.category as string;
      const enabled = params.enabled as boolean;
      if (!companyId || !category || typeof enabled !== "boolean") {
        throw new Error("setCategoryEnabled requires companyId, category, enabled");
      }
      const current = await getCategoryToggles(ctx, companyId);
      current[category] = enabled;
      await setCategoryToggles(ctx, companyId, current);
      await ctx.activity.log({
        companyId,
        message: `Category "${category}" ${enabled ? "enabled" : "disabled"}`,
        entityType: "plugin-tool-settings",
        entityId: category,
        metadata: { category, enabled },
      });
      return { ok: true, category, enabled };
    });

    // ── Data: list email accounts for a company ──────────────────────
    ctx.data.register("emailAccounts", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      if (!companyId) return { accounts: [] };
      const records = await ctx.entities.list({
        entityType: "email_account",
        scopeKind: "company",
        scopeId: companyId,
        limit: 100,
      });
      const accounts = records.map((r) => {
        const data = (r.data ?? {}) as unknown as EmailAccountData;
        return {
          id: r.id,
          address: data.address,
          label: data.label ?? null,
          imapHost: data.imapHost,
          imapPort: data.imapPort,
          imapUser: data.imapUser,
          pollingEnabled: data.pollingEnabled,
          pollIntervalMin: data.pollIntervalMin ?? 5,
          lastSeenUid: data.lastSeenUid ?? 0,
          status: data.status ?? "active",
          lastError: data.lastError ?? null,
          allowedAgents: data.allowedAgents ?? [],
        };
      });
      return { companyId, accounts };
    });

    // ── Action: upsert an email account ──────────────────────────────
    ctx.actions.register("emailAccountUpsert", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const address = params.address as string;
      if (!companyId || !address) {
        throw new Error("emailAccountUpsert requires companyId and address");
      }
      const data: EmailAccountData = {
        address,
        label: (params.label as string | undefined) ?? undefined,
        imapHost: (params.imapHost as string | undefined) ?? "",
        imapPort: Number(params.imapPort ?? 993),
        imapUser: (params.imapUser as string | undefined) ?? address,
        imapPassRef: (params.imapPassRef as string | undefined) ?? "",
        pollingEnabled: Boolean(params.pollingEnabled ?? false),
        pollIntervalMin: Number(params.pollIntervalMin ?? 5),
        allowedAgents: Array.isArray(params.allowedAgents)
          ? (params.allowedAgents as string[])
          : undefined,
        status: "active",
        lastError: null,
      };
      const record = await ctx.entities.upsert({
        entityType: "email_account",
        scopeKind: "company",
        scopeId: companyId,
        externalId: address,
        title: data.label ?? address,
        status: "active",
        data: data as unknown as Record<string, unknown>,
      });
      await ctx.activity.log({
        companyId,
        message: `Email account "${address}" upserted (polling=${data.pollingEnabled})`,
        entityType: "email_account",
        entityId: record.id,
      });
      return { ok: true, id: record.id, address };
    });

    // ── Action: delete an email account ──────────────────────────────
    ctx.actions.register("emailAccountDelete", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const id = params.id as string;
      if (!companyId || !id) throw new Error("emailAccountDelete requires companyId and id");
      // The plugin entities API does not yet have a `delete` method — we
      // mark the account as paused with pollingEnabled=false instead so it
      // stops being picked up by the poller without losing audit history.
      const candidates = await ctx.entities.list({
        entityType: "email_account",
        scopeKind: "company",
        scopeId: companyId,
        limit: 200,
      });
      const target = candidates.find((r) => r.id === id);
      if (!target) throw new Error(`email_account "${id}" not found in company ${companyId}`);
      const data = (target.data ?? {}) as unknown as EmailAccountData;
      await ctx.entities.upsert({
        entityType: "email_account",
        scopeKind: "company",
        scopeId: companyId,
        externalId: target.externalId ?? data.address,
        title: target.title ?? data.address,
        status: "paused",
        data: { ...data, pollingEnabled: false, status: "paused" } as unknown as Record<string, unknown>,
      });
      await ctx.activity.log({
        companyId,
        message: `Email account "${data.address}" paused (soft delete)`,
        entityType: "email_account",
        entityId: id,
      });
      return { ok: true, id };
    });

    // ── Action: test an email account's IMAP connection ──────────────
    ctx.actions.register("emailAccountTest", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const id = params.id as string;
      if (!companyId || !id) throw new Error("emailAccountTest requires companyId and id");
      const candidates = await ctx.entities.list({
        entityType: "email_account",
        scopeKind: "company",
        scopeId: companyId,
        limit: 200,
      });
      const target = candidates.find((r) => r.id === id);
      if (!target) throw new Error(`email_account "${id}" not found`);
      const data = (target.data ?? {}) as unknown as EmailAccountData;
      if (!data.imapPassRef) throw new Error("Account has no IMAP password ref configured");
      const password = await ctx.secrets.resolve(data.imapPassRef);
      try {
        const result = await pollImapAccount({
          host: data.imapHost,
          port: data.imapPort,
          user: data.imapUser,
          password,
          // Test only — don't actually drain the inbox
          lastSeenUid: Number.MAX_SAFE_INTEGER - 1,
          maxMessages: 0,
        });
        return { ok: true, message: `Connected to ${data.imapHost}:${data.imapPort}`, latestUid: result.newLastSeenUid };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    });

    for (const tool of ALL_TOOLS) {
      ctx.tools.register(
        tool.name,
        tool.declaration,
        async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
          const started = Date.now();
          const access = await checkAccess(ctx, tool.name, runCtx);
          if (!access.ok) {
            ctx.logger.warn(`tool ${tool.name} denied`, { reason: access.reason, agentId: runCtx.agentId });
            try {
              await ctx.activity.log({
                companyId: runCtx.companyId,
                message: `Tool "${tool.name}" denied: ${access.reason}`,
                entityType: "plugin-tool",
                entityId: tool.name,
                metadata: { agentId: runCtx.agentId, runId: runCtx.runId, denied: true },
              });
            } catch { /* activity log is best-effort */ }
            return { error: access.reason };
          }

          try {
            const result = await tool.run(params, runCtx, ctxAccess);
            const ms = Date.now() - started;
            ctx.logger.info(`tool ${tool.name} ok`, { ms, agentId: runCtx.agentId });
            try {
              await ctx.activity.log({
                companyId: runCtx.companyId,
                message: result.error
                  ? `Tool "${tool.name}" returned error`
                  : `Tool "${tool.name}" executed in ${ms}ms`,
                entityType: "plugin-tool",
                entityId: tool.name,
                metadata: {
                  agentId: runCtx.agentId,
                  runId: runCtx.runId,
                  durationMs: ms,
                  hasError: Boolean(result.error),
                },
              });
            } catch { /* best-effort */ }
            return result;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            ctx.logger.error(`tool ${tool.name} threw`, { error: message, agentId: runCtx.agentId });
            try {
              await ctx.activity.log({
                companyId: runCtx.companyId,
                message: `Tool "${tool.name}" threw: ${message}`,
                entityType: "plugin-tool",
                entityId: tool.name,
                metadata: { agentId: runCtx.agentId, runId: runCtx.runId, exception: true },
              });
            } catch { /* best-effort */ }
            return { error: message };
          }
        },
      );
    }
  },

  async onHealth() {
    return { status: "ok", message: `${PLUGIN_NAME} ready with ${ALL_TOOLS.length} tool(s)` };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
