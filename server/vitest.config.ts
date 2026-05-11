import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    isolate: true,
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    pool: "forks",
    poolOptions: {
      forks: {
        isolate: true,
        maxForks: 1,
        minForks: 1,
      },
    },
    sequence: {
      concurrent: false,
      hooks: "list",
    },
    setupFiles: ["./src/__tests__/setup-supertest.ts"],
    //// Neocompany Modification — exclude upstream tests that don't apply to the fork
    // These tests cover capabilities our vendored plugin-host-services either
    // stubs as NotImplemented (managed agents/routines/skills) or implements
    // differently (vendored execute.ts, heartbeat batching). Re-enable
    // individually if we ever wire the corresponding services back into the
    // host. See FORK_PATCHES.md for the patch surface.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "src/__tests__/plugin-managed-agents.test.ts",
      "src/__tests__/plugin-managed-routines.test.ts",
      "src/__tests__/plugin-managed-skills.test.ts",
      "src/__tests__/plugin-orchestration-apis.test.ts",
      "src/__tests__/openclaw-gateway-adapter.test.ts",
      "src/__tests__/heartbeat-comment-wake-batching.test.ts",
    ],
    //// End Neocompany Modification
  },
});
