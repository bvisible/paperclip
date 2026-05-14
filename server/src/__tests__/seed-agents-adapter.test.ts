//// Neocompany Modification — test for the PAPERCLIP_SEED_ADAPTER feature flag
//// This test file does not exist upstream. It pins the contract that the
//// seed fleet is provisioned on openclaw_gateway by default and on
//// hermes_local only when the flag is flipped — and that the openclaw
//// isolated-workspace provisioning is skipped for hermes_local.
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  seedDefaultAgentsForCompany,
  SEED_AGENTS,
  type SeedAgentServices,
  type SeedAgentOptions,
} from "../services/seed-agents.js";

interface CapturedAgent {
  companyId: string;
  input: Record<string, unknown>;
}

function makeServices(): {
  services: SeedAgentServices;
  created: CapturedAgent[];
  provisionIsolatedCalls: number;
} {
  const created: CapturedAgent[] = [];
  let provisionIsolatedCalls = 0;

  const services: SeedAgentServices = {
    createAgent: async (companyId, input) => {
      created.push({ companyId, input: input as Record<string, unknown> });
      const cfg = (input as Record<string, unknown>).adapterConfig;
      return {
        id: `agent-${created.length}`,
        companyId,
        name: String((input as Record<string, unknown>).name ?? "agent"),
        role: String((input as Record<string, unknown>).role ?? "general"),
        adapterType: String((input as Record<string, unknown>).adapterType ?? ""),
        adapterConfig: cfg,
      };
    },
    materializeBundleForNewAgent: vi.fn(async () => undefined),
    grantDefaultAgentAccess: vi.fn(async () => undefined),
    logActivity: vi.fn(async () => undefined),
    provisionIsolatedAgent: async () => {
      provisionIsolatedCalls += 1;
      return {
        openclawAgentId: "oc-agent",
        claimedApiKeyPath: "/tmp/claimed.json",
      };
    },
    patchAgentAdapterConfig: vi.fn(async () => undefined),
  };

  return {
    services,
    created,
    get provisionIsolatedCalls() {
      return provisionIsolatedCalls;
    },
  } as {
    services: SeedAgentServices;
    created: CapturedAgent[];
    provisionIsolatedCalls: number;
  };
}

const OPTIONS: SeedAgentOptions = {
  openclawGatewayUrl: "ws://127.0.0.1:3200",
  openclawGatewayToken: "test-token",
  actorUserId: "user-1",
  enableHeartbeat: true,
  heartbeatIntervalSec: 900,
};

describe("seedDefaultAgentsForCompany — PAPERCLIP_SEED_ADAPTER flag", () => {
  let prevAdapter: string | undefined;
  let prevDeployment: string | undefined;
  let prevSkip: string | undefined;
  let prevHermesCmd: string | undefined;

  beforeEach(() => {
    prevAdapter = process.env.PAPERCLIP_SEED_ADAPTER;
    prevDeployment = process.env.PAPERCLIP_DEPLOYMENT;
    prevSkip = process.env.PAPERCLIP_SKIP_DEFAULT_AGENTS;
    prevHermesCmd = process.env.PAPERCLIP_HERMES_COMMAND;
    // Ensure the deployment-skip guard does not short-circuit the seed loop.
    delete process.env.PAPERCLIP_DEPLOYMENT;
    delete process.env.PAPERCLIP_SKIP_DEFAULT_AGENTS;
    delete process.env.PAPERCLIP_HERMES_COMMAND;
  });

  afterEach(() => {
    if (prevAdapter === undefined) delete process.env.PAPERCLIP_SEED_ADAPTER;
    else process.env.PAPERCLIP_SEED_ADAPTER = prevAdapter;
    if (prevDeployment === undefined) delete process.env.PAPERCLIP_DEPLOYMENT;
    else process.env.PAPERCLIP_DEPLOYMENT = prevDeployment;
    if (prevSkip === undefined) delete process.env.PAPERCLIP_SKIP_DEFAULT_AGENTS;
    else process.env.PAPERCLIP_SKIP_DEFAULT_AGENTS = prevSkip;
    if (prevHermesCmd === undefined) delete process.env.PAPERCLIP_HERMES_COMMAND;
    else process.env.PAPERCLIP_HERMES_COMMAND = prevHermesCmd;
  });

  it("defaults to openclaw_gateway when the flag is unset", async () => {
    delete process.env.PAPERCLIP_SEED_ADAPTER;
    const h = makeServices();
    const result = await seedDefaultAgentsForCompany("co-1", h.services, OPTIONS);

    expect(result).toHaveLength(SEED_AGENTS.length);
    expect(h.created).toHaveLength(SEED_AGENTS.length);
    for (const c of h.created) {
      expect(c.input.adapterType).toBe("openclaw_gateway");
      const cfg = c.input.adapterConfig as Record<string, unknown>;
      expect(cfg.url).toBe("ws://127.0.0.1:3200");
      expect(cfg.headers).toEqual({ "x-openclaw-token": "test-token" });
      expect(cfg.provider).toBeUndefined();
    }
  });

  it("provisions the openclaw isolated workspace for each agent in the default path", async () => {
    delete process.env.PAPERCLIP_SEED_ADAPTER;
    const h = makeServices();
    await seedDefaultAgentsForCompany("co-1", h.services, OPTIONS);
    expect(h.provisionIsolatedCalls).toBe(SEED_AGENTS.length);
  });

  it("seeds hermes_local when PAPERCLIP_SEED_ADAPTER=hermes_local", async () => {
    process.env.PAPERCLIP_SEED_ADAPTER = "hermes_local";
    const h = makeServices();
    const result = await seedDefaultAgentsForCompany("co-1", h.services, OPTIONS);

    expect(result).toHaveLength(SEED_AGENTS.length);
    for (const c of h.created) {
      expect(c.input.adapterType).toBe("hermes_local");
      const cfg = c.input.adapterConfig as Record<string, unknown>;
      // openai-codex provider = ChatGPT Pro OAuth, no API key.
      expect(cfg.provider).toBe("openai-codex");
      expect(cfg.persistSession).toBe(true);
      expect(cfg.timeoutSec).toBe(300);
      // HERMES_HOME must NOT be baked in at seed time — it is resolved per
      // (company, user, agent) at runtime by the registry wrapper.
      expect(cfg.env).toBeUndefined();
      // No openclaw gateway fields leak into the hermes config.
      expect(cfg.url).toBeUndefined();
      expect(cfg.headers).toBeUndefined();
      // instructionsTemplate kept so the onboarding bundle still materializes.
      expect(typeof cfg.instructionsTemplate).toBe("string");
      // hermesCommand omitted when PAPERCLIP_HERMES_COMMAND is unset (adapter
      // keeps its bare "hermes" default).
      expect(cfg.hermesCommand).toBeUndefined();
    }
  });

  it("injects hermesCommand into the hermes config when PAPERCLIP_HERMES_COMMAND is set", async () => {
    process.env.PAPERCLIP_SEED_ADAPTER = "hermes_local";
    process.env.PAPERCLIP_HERMES_COMMAND = "/home/ubuntu/.hermes-venv/bin/hermes";
    const h = makeServices();
    await seedDefaultAgentsForCompany("co-1", h.services, OPTIONS);
    for (const c of h.created) {
      const cfg = c.input.adapterConfig as Record<string, unknown>;
      expect(cfg.hermesCommand).toBe("/home/ubuntu/.hermes-venv/bin/hermes");
    }
  });

  it("does NOT add hermesCommand to the openclaw_gateway config even when the env is set", async () => {
    delete process.env.PAPERCLIP_SEED_ADAPTER; // openclaw default
    process.env.PAPERCLIP_HERMES_COMMAND = "/home/ubuntu/.hermes-venv/bin/hermes";
    const h = makeServices();
    await seedDefaultAgentsForCompany("co-1", h.services, OPTIONS);
    for (const c of h.created) {
      const cfg = c.input.adapterConfig as Record<string, unknown>;
      expect(cfg.hermesCommand).toBeUndefined();
    }
  });

  it("does NOT provision the openclaw isolated workspace for hermes_local", async () => {
    process.env.PAPERCLIP_SEED_ADAPTER = "hermes_local";
    const h = makeServices();
    await seedDefaultAgentsForCompany("co-1", h.services, OPTIONS);
    expect(h.provisionIsolatedCalls).toBe(0);
  });

  it("treats an unknown flag value as the openclaw_gateway default", async () => {
    process.env.PAPERCLIP_SEED_ADAPTER = "something-else";
    const h = makeServices();
    await seedDefaultAgentsForCompany("co-1", h.services, OPTIONS);
    for (const c of h.created) {
      expect(c.input.adapterType).toBe("openclaw_gateway");
    }
  });

  it("still skips seedKeys already present, regardless of adapter", async () => {
    process.env.PAPERCLIP_SEED_ADAPTER = "hermes_local";
    const h = makeServices();
    const existing = new Set([SEED_AGENTS[0]!.seedKey, SEED_AGENTS[1]!.seedKey]);
    const result = await seedDefaultAgentsForCompany("co-1", h.services, OPTIONS, existing);
    expect(result).toHaveLength(SEED_AGENTS.length - 2);
    expect(h.created).toHaveLength(SEED_AGENTS.length - 2);
  });
});
