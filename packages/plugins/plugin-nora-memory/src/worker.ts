/**
 * plugin-nora-memory — worker entrypoint.
 *
 * Registers the four memory tools (retain / recall / list / dream).
 * No UI, no managed agents, no Paperclip routines — the Dream
 * consolidation is driven by `memory_dream`, called from a nightly
 * cron on the NORA side.
 */
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { registerMemoryTools } from "./memory.js";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("nora-memory worker starting");
    registerMemoryTools(ctx);
    ctx.logger.info("nora-memory tools registered", {
      tools: ["memory_retain", "memory_recall", "memory_list", "memory_dream"],
    });
  },

  async onHealth() {
    return {
      status: "ok",
      message: "nora-memory plugin worker is running",
      details: {
        surfaces: ["tools", "database"],
      },
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
