/**
 * NORA Frappe Tools — plugin worker entrypoint.
 *
 * For each tool in ALL_TOOLS, registers a handler that:
 * 1. Parses + validates input via the tool's Zod schema (handler itself).
 * 2. Resolves Frappe credentials per-company via makeCtxAccess.
 * 3. Delegates to the tool's run() which calls frappeFetch.
 * 4. Wraps success/error in ToolResult shape, logs activity.
 *
 * Credentials lookup priority (in makeCtxAccess):
 *   company state → instance config → process env (FRAPPE_URL, FRAPPE_API_KEY, FRAPPE_API_SECRET).
 */

import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import { ALL_TOOLS } from "./tools/index.js";
import { makeCtxAccess } from "./context.js";

const PLUGIN_NAME = "nora-frappe-tools";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info(
      `${PLUGIN_NAME} setup — registering ${ALL_TOOLS.length} tool(s)`,
    );
    const access = makeCtxAccess(ctx);

    for (const tool of ALL_TOOLS) {
      ctx.tools.register(
        tool.name,
        tool.declaration,
        async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
          const started = Date.now();
          try {
            const result = await tool.run(params, runCtx, access);
            const ms = Date.now() - started;
            if ("error" in result) {
              ctx.logger.warn(`tool ${tool.name} error`, {
                ms,
                agentId: runCtx.agentId,
                error: result.error,
              });
            } else {
              ctx.logger.info(`tool ${tool.name} ok`, { ms, agentId: runCtx.agentId });
            }
            // Best-effort audit log (never block the agent on logging issues).
            try {
              await ctx.activity?.log?.({
                companyId: runCtx.companyId,
                message:
                  "error" in result
                    ? `Tool "${tool.name}" returned error`
                    : `Tool "${tool.name}" executed in ${ms}ms`,
                entityType: "plugin-tool",
                entityId: tool.name,
                metadata: {
                  agentId: runCtx.agentId,
                  runId: runCtx.runId,
                  durationMs: ms,
                  hasError: "error" in result,
                },
              });
            } catch {
              /* activity log is best-effort */
            }
            return result;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            ctx.logger.error(`tool ${tool.name} threw`, {
              error: message,
              agentId: runCtx.agentId,
            });
            try {
              await ctx.activity?.log?.({
                companyId: runCtx.companyId,
                message: `Tool "${tool.name}" threw: ${message}`,
                entityType: "plugin-tool",
                entityId: tool.name,
                metadata: { agentId: runCtx.agentId, runId: runCtx.runId, exception: true },
              });
            } catch {
              /* best-effort */
            }
            return { error: message };
          }
        },
      );
    }
  },

  async onHealth() {
    return {
      status: "ok",
      message: `${PLUGIN_NAME} ready with ${ALL_TOOLS.length} tool(s)`,
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
