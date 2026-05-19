//// Neoffice Modification: sprint-j-fix-pluginDbId-routing-test
//// Why: NORA Sprint K Phase 0b — protect commit 3a12031a from regression.
////      Before the fix, registerPluginTools(pluginKey, manifest) propagated
////      the (string) pluginKey as the worker-routing key instead of the DB
////      UUID. Every executeTool call then queried workerManager.isRunning
////      with the namespaced string, missed the worker (indexed by UUID),
////      and returned a misleading 502 "worker is not running" even when
////      the worker was demonstrably alive (bootstrap succeeded). The
////      registry now accepts an optional third pluginDbId argument and
////      executeTool routes through it. These unit tests freeze that
////      contract so a future "cleanup" refactor can't drop the argument.
//// Date: 2026-05-19
//// Refs: NORA Sprint K Phase 0b, [[swirling-humming-lerdorf]]

import { describe, expect, it, vi } from "vitest";
import type { PaperclipPluginManifestV1 } from "@paperclipai/shared";
import { createPluginToolRegistry } from "../services/plugin-tool-registry.js";

const PLUGIN_KEY = "acme.example";
const PLUGIN_DB_ID = "11111111-2222-4333-8444-555555555555";

const MANIFEST: PaperclipPluginManifestV1 = {
  id: PLUGIN_KEY,
  name: "Acme Example",
  version: "0.1.0",
  capabilities: ["agent.tools.register"],
  entrypoints: { worker: "./worker.js" },
  tools: [
    {
      name: "echo",
      displayName: "Echo",
      description: "Echo back the input.",
      parametersSchema: { type: "object" },
    },
  ],
} as unknown as PaperclipPluginManifestV1;

function makeWorkerManager(opts: { running: Set<string> }) {
  return {
    isRunning: vi.fn((key: string) => opts.running.has(key)),
    call: vi.fn(async () => ({ content: "ok" })),
    listRunningWorkers: vi.fn(() => Array.from(opts.running)),
  };
}

describe("PluginToolRegistry — pluginDbId routing (Sprint J fix 3a12031a)", () => {
  it("propagates the explicit pluginDbId to registered tools", () => {
    const registry = createPluginToolRegistry();
    registry.registerPlugin(PLUGIN_KEY, MANIFEST, PLUGIN_DB_ID);

    const tool = registry.getToolByPlugin(PLUGIN_KEY, "echo");
    expect(tool).not.toBeNull();
    expect(tool?.pluginDbId).toBe(PLUGIN_DB_ID);
    expect(tool?.pluginId).toBe(PLUGIN_KEY);
  });

  it("falls back to pluginId when no pluginDbId is provided (backward compat)", () => {
    const registry = createPluginToolRegistry();
    registry.registerPlugin(PLUGIN_KEY, MANIFEST);

    const tool = registry.getToolByPlugin(PLUGIN_KEY, "echo");
    expect(tool?.pluginDbId).toBe(PLUGIN_KEY);
  });

  it("executeTool calls workerManager.isRunning with pluginDbId (UUID), not pluginId (namespaced string)", async () => {
    const running = new Set<string>([PLUGIN_DB_ID]);
    const wm = makeWorkerManager({ running });
    const registry = createPluginToolRegistry(wm as never);
    registry.registerPlugin(PLUGIN_KEY, MANIFEST, PLUGIN_DB_ID);

    const result = await registry.executeTool(
      `${PLUGIN_KEY}:echo`,
      {},
      {
        agentId: "agent-1",
        runId: "11111111-1111-4111-8111-111111111111",
        companyId: "22222222-2222-4222-8222-222222222222",
        projectId: "33333333-3333-4333-8333-333333333333",
      },
    );

    expect(wm.isRunning).toHaveBeenCalledWith(PLUGIN_DB_ID);
    expect(wm.isRunning).not.toHaveBeenCalledWith(PLUGIN_KEY);
    expect(wm.call).toHaveBeenCalledTimes(1);
    expect(result.result).toEqual({ content: "ok" });
  });

  it("executeTool returns 502-equivalent error when isRunning(pluginDbId) returns false", async () => {
    const wm = makeWorkerManager({ running: new Set<string>() });
    const registry = createPluginToolRegistry(wm as never);
    registry.registerPlugin(PLUGIN_KEY, MANIFEST, PLUGIN_DB_ID);

    await expect(
      registry.executeTool(
        `${PLUGIN_KEY}:echo`,
        {},
        {
          agentId: "agent-1",
          runId: "11111111-1111-4111-8111-111111111111",
          companyId: "22222222-2222-4222-8222-222222222222",
          projectId: "33333333-3333-4333-8333-333333333333",
        },
      ),
    ).rejects.toThrow(/worker for plugin .* is not running/i);
    expect(wm.isRunning).toHaveBeenCalledWith(PLUGIN_DB_ID);
  });
});
