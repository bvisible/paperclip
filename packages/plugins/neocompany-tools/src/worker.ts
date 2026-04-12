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
import { TOOL_REGISTRY } from "./tools/registry.js";

const PLUGIN_NAME = "neocompany-tools";

interface InstanceConfig {
  googleClientId?: string;
  googleClientSecretRef?: string;
  googleRefreshTokenRef?: string;
  googlePsiApiKeyRef?: string;
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
// Plugin definition
// ---------------------------------------------------------------------------

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info(`${PLUGIN_NAME} plugin setup — registering ${ALL_TOOLS.length} tool(s)`);

    const ctxAccess = makeCtxAccess(ctx);

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
