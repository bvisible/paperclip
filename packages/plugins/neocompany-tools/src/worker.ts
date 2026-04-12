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

const PLUGIN_NAME = "neocompany-tools";

interface InstanceConfig {
  googleClientId?: string;
  googleClientSecretRef?: string;
  googleRefreshTokenRef?: string;
  googlePsiApiKeyRef?: string;
  ga4PropertyId?: string;
  openPageRankApiKeyRef?: string;
  wordpressSiteUrl?: string;
  wordpressUsername?: string;
  wordpressAppPasswordRef?: string;
  resendApiKeyRef?: string;
  defaultFromAddress?: string;
}

async function readInstanceConfig(ctx: PluginContext): Promise<InstanceConfig> {
  const raw = (await ctx.config.get()) as InstanceConfig | null;
  return raw ?? {};
}

/**
 * Build the `ToolContextAccess` helper bound to the current worker context.
 * Each call resolves live values — we never cache secrets across runs.
 */
function makeCtxAccess(ctx: PluginContext): ToolContextAccess {
  return {
    getPluginContext() {
      return ctx;
    },

    async getGscConfig(_companyId: string) {
      const cfg = await readInstanceConfig(ctx);
      if (!cfg.googleClientId) throw new Error("Google OAuth client ID is not configured");
      if (!cfg.googleClientSecretRef) throw new Error("Google OAuth client secret is not configured");
      if (!cfg.googleRefreshTokenRef) throw new Error("Google OAuth refresh token is not configured");
      const [clientSecret, refreshToken] = await Promise.all([
        ctx.secrets.resolve(cfg.googleClientSecretRef),
        ctx.secrets.resolve(cfg.googleRefreshTokenRef),
      ]);
      return {
        clientId: cfg.googleClientId,
        clientSecret,
        refreshToken,
      };
    },

    async getGa4Config(_companyId: string) {
      const cfg = await readInstanceConfig(ctx);
      if (!cfg.googleClientId) throw new Error("Google OAuth client ID is not configured");
      if (!cfg.googleClientSecretRef) throw new Error("Google OAuth client secret is not configured");
      if (!cfg.googleRefreshTokenRef) throw new Error("Google OAuth refresh token is not configured");
      if (!cfg.ga4PropertyId) throw new Error("GA4 property ID is not configured");
      const [clientSecret, refreshToken] = await Promise.all([
        ctx.secrets.resolve(cfg.googleClientSecretRef),
        ctx.secrets.resolve(cfg.googleRefreshTokenRef),
      ]);
      return {
        clientId: cfg.googleClientId,
        clientSecret,
        refreshToken,
        propertyId: cfg.ga4PropertyId,
      };
    },

    async getPageSpeedConfig(_companyId: string) {
      const cfg = await readInstanceConfig(ctx);
      if (!cfg.googlePsiApiKeyRef) {
        // The Google PSI API has a public quota — calling without a key
        // still works at low volume. Only surface the key when configured.
        return {};
      }
      const apiKey = await ctx.secrets.resolve(cfg.googlePsiApiKeyRef);
      return { apiKey };
    },

    async getWordPressConfig(_companyId: string) {
      const cfg = await readInstanceConfig(ctx);
      if (!cfg.wordpressSiteUrl) throw new Error("WordPress site URL is not configured");
      if (!cfg.wordpressUsername) throw new Error("WordPress username is not configured");
      if (!cfg.wordpressAppPasswordRef) throw new Error("WordPress Application Password is not configured");
      const appPassword = await ctx.secrets.resolve(cfg.wordpressAppPasswordRef);
      return {
        siteUrl: cfg.wordpressSiteUrl,
        username: cfg.wordpressUsername,
        appPassword,
      };
    },

    async getOpenPageRankConfig(_companyId: string) {
      const cfg = await readInstanceConfig(ctx);
      if (!cfg.openPageRankApiKeyRef) return {};
      const apiKey = await ctx.secrets.resolve(cfg.openPageRankApiKeyRef);
      return { apiKey };
    },

    async getEmailSendConfig(companyId: string, agentId: string) {
      const cfg = await readInstanceConfig(ctx);
      if (!cfg.resendApiKeyRef) throw new Error("Resend API key is not configured");
      const apiKey = await ctx.secrets.resolve(cfg.resendApiKeyRef);

      // Prefer the agent's own email identity if set on metadata,
      // fall back to the instance-level default address.
      let defaultFrom = cfg.defaultFromAddress ?? "";
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
      const byCategory: Record<string, { label: string; tools: ToolMetadata[] }> = {};
      for (const meta of Object.values(TOOL_REGISTRY)) {
        const key = meta.category as string;
        if (!byCategory[key]) {
          byCategory[key] = {
            label: CATEGORY_LABELS[meta.category] ?? key,
            tools: [],
          };
        }
        byCategory[key].tools.push(meta);
      }
      return {
        toolCount: Object.keys(TOOL_REGISTRY).length,
        categories: byCategory,
      };
    });

    // ── Data: current access state for a company (category toggles) ──
    ctx.data.register("accessState", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      if (!companyId) return { categoryToggles: {} };
      const categoryToggles = await getCategoryToggles(ctx, companyId);
      return { companyId, categoryToggles };
    });

    // ── Data: plugin instance config summary (which secrets are set) ─
    ctx.data.register("configSummary", async () => {
      const cfg = await readInstanceConfig(ctx);
      return {
        googleOAuthConfigured:
          Boolean(cfg.googleClientId) &&
          Boolean(cfg.googleClientSecretRef) &&
          Boolean(cfg.googleRefreshTokenRef),
        googlePsiKeyConfigured: Boolean(cfg.googlePsiApiKeyRef),
        resendConfigured: Boolean(cfg.resendApiKeyRef),
        defaultFromAddress: cfg.defaultFromAddress ?? "",
      };
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
