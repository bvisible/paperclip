/**
 * Seed agents — the default agent fleet provisioned on every new company.
 *
 * Design goals:
 *   - Source of truth for agent identity, role, and initial config.
 *   - Portable: no Paperclip-specific types leak into the spec shape so this
 *     file can be copied verbatim into other projects.
 *   - Stable `seedKey` so the rest of the codebase can reference a seed
 *     agent without hardcoding its UUID
 *     (`findAgentBySeedKey(company, "pixel")`).
 *
 * The agents are inspired by the legacy Postiz fleet (Nora/Lyra/Nova/Maya/
 * Ella/Atlas/Scout/Iris/Pixel) — we keep the names because they already
 * show up in operator conversations and internal tickets.
 *
 * Instructions lives under `server/src/onboarding-assets/seed-agents/<seedKey>/`
 * as markdown (AGENTS.md, SOUL.md, IDENTITY.md, TOOLS.md). Each file is
 * written in English; agents respond in the language of the user's message.
 */

export interface SeedAgentSpec {
  /** Stable key for lookup in code — never rename. */
  seedKey: string;
  name: string;
  /** Free-form role tag used by the UI and hierarchy lookups. */
  role: string;
  title: string;
  icon: string;
  /** The company's default chat agent. Exactly one seed is flagged main. */
  isMain?: boolean;
  /** Directory name under server/src/onboarding-assets/seed-agents/. */
  instructionsTemplate: string;
  /** Suggested tool allowlist — empty means "no restriction". */
  toolsAllowlist?: string[];
}

export const SEED_AGENT_KEYS = {
  nora: "nora",
  lyra: "lyra",
  nova: "nova",
  maya: "maya",
  ella: "ella",
  atlas: "atlas",
  scout: "scout",
  iris: "iris",
  pixel: "pixel",
} as const;

export type SeedAgentKey = (typeof SEED_AGENT_KEYS)[keyof typeof SEED_AGENT_KEYS];

export const SEED_AGENTS: SeedAgentSpec[] = [
  {
    seedKey: SEED_AGENT_KEYS.nora,
    name: "Nora",
    role: "main",
    title: "Coordinator",
    icon: "🎯",
    isMain: true,
    instructionsTemplate: "nora",
  },
  {
    seedKey: SEED_AGENT_KEYS.lyra,
    name: "Lyra",
    role: "seo",
    title: "SEO & Analytics",
    icon: "🔍",
    instructionsTemplate: "lyra",
    toolsAllowlist: [
      "neocompany-tools:seoSitemapCheck",
      "neocompany-tools:seoRobotsCheck",
      "neocompany-tools:seoPageSpeed",
      "neocompany-tools:seoGscKeywords",
      "neocompany-tools:seoGscTopPages",
      "neocompany-tools:seoGa4Traffic",
      "neocompany-tools:seoGa4TopPages",
      "neocompany-tools:seoContentAudit",
      "neocompany-tools:seoTrendAnalysis",
      "neocompany-tools:seoQuickWins",
      "neocompany-tools:seoCompetitorPageRank",
      "neocompany-tools:geoAITraffic",
    ],
  },
  {
    seedKey: SEED_AGENT_KEYS.nova,
    name: "Nova",
    role: "social",
    title: "Social Media",
    icon: "📱",
    instructionsTemplate: "nova",
    toolsAllowlist: [
      "neocompany-tools:channelsList",
      "neocompany-tools:channelConnectStart",
      "neocompany-tools:channelRefresh",
      "neocompany-tools:channelDisconnect",
      "neocompany-tools:libraryList",
    ],
  },
  {
    seedKey: SEED_AGENT_KEYS.maya,
    name: "Maya",
    role: "community",
    title: "Community",
    icon: "💬",
    instructionsTemplate: "maya",
  },
  {
    seedKey: SEED_AGENT_KEYS.ella,
    name: "Ella",
    role: "writer",
    title: "Content writer",
    icon: "✍️",
    instructionsTemplate: "ella",
    toolsAllowlist: [
      "neocompany-tools:wpListPosts",
      "neocompany-tools:wpCreatePost",
      "neocompany-tools:contentTopicIdeas",
      "neocompany-tools:contentOutline",
      "neocompany-tools:contentDraft",
    ],
  },
  {
    seedKey: SEED_AGENT_KEYS.atlas,
    name: "Atlas",
    role: "support",
    title: "Customer support",
    icon: "🎧",
    instructionsTemplate: "atlas",
    toolsAllowlist: [
      "neocompany-tools:emailListMessages",
      "neocompany-tools:emailReadMessage",
      "neocompany-tools:emailSendMessage",
    ],
  },
  {
    seedKey: SEED_AGENT_KEYS.scout,
    name: "Scout",
    role: "commercial",
    title: "Commercial",
    icon: "📈",
    instructionsTemplate: "scout",
    toolsAllowlist: [
      "neocompany-tools:emailListMessages",
      "neocompany-tools:emailSendMessage",
    ],
  },
  {
    seedKey: SEED_AGENT_KEYS.iris,
    name: "Iris",
    role: "brand",
    title: "Brand research",
    icon: "💡",
    instructionsTemplate: "iris",
  },
  {
    seedKey: SEED_AGENT_KEYS.pixel,
    name: "Pixel",
    role: "designer",
    title: "Designer & visual content",
    icon: "🎨",
    instructionsTemplate: "pixel",
    toolsAllowlist: [
      "neocompany-tools:templateList",
      "neocompany-tools:templateApply",
      "neocompany-tools:imageGenerate",
      "neocompany-tools:imageList",
      "neocompany-tools:imageApprove",
      "neocompany-tools:libraryUpload",
      "neocompany-tools:channelsList",
    ],
  },
];

export const MAIN_SEED_AGENT: SeedAgentSpec =
  SEED_AGENTS.find((spec) => spec.isMain === true) ?? SEED_AGENTS[0]!;

/** Returns a seed spec by key, throwing if the key is unknown. */
export function getSeedAgentSpec(key: string): SeedAgentSpec {
  const spec = SEED_AGENTS.find((s) => s.seedKey === key);
  if (!spec) throw new Error(`Unknown seed agent key: ${key}`);
  return spec;
}

// ---------------------------------------------------------------------------
// Provisioning helpers — called from the company `create` route handler.
//
// Kept here (rather than inside routes/agents.ts) so the logic is reusable
// both at company.create time and from a reconcile CLI later.
// ---------------------------------------------------------------------------

export interface SeedAgentServices {
  createAgent: (
    companyId: string,
    input: Record<string, unknown>,
  ) => Promise<{ id: string; companyId: string; name: string; role: string; adapterType: string; adapterConfig: unknown }>;
  /**
   * Materialize the agent's onboarding-assets bundle on disk and rewrite
   * adapterConfig so the managed bundle is referenced. Returns the updated
   * agent (same shape as createAgent's return).
   */
  materializeBundleForNewAgent: (agent: {
    id: string;
    companyId: string;
    name: string;
    role: string;
    adapterType: string;
    adapterConfig: unknown;
  }) => Promise<unknown>;
  grantDefaultAgentAccess: (
    companyId: string,
    agentId: string,
    grantedByUserId: string | null,
  ) => Promise<void>;
  logActivity: (args: {
    companyId: string;
    agentId: string;
    actorUserId: string | null;
    seedKey: string;
  }) => Promise<void>;
  /**
   * Optional: provision a per-agent OpenClaw isolated workspace + write the
   * Paperclip claimed-API-key file for it. When provided, seed agents get
   * `adapterConfig.agentId` and `adapterConfig.claimedApiKeyPath` so the
   * OpenClaw adapter routes each agent to its own memory store.
   *
   * When omitted (local dev / smoke tests), all agents share the default
   * `~/.openclaw/workspace/` — NOT multi-tenant safe.
   *
   * Returns the paths to merge into adapterConfig; the seed loop handles the
   * DB update.
   */
  provisionIsolatedAgent?: (args: {
    companyId: string;
    role: string;
    agentName: string;
    paperclipAgentId: string;
  }) => Promise<{ openclawAgentId: string; claimedApiKeyPath: string }>;
  /**
   * Optional: update an agent's adapterConfig with new fields (merged). Used
   * to inject the isolated-agent routing fields after `createAgent` +
   * `provisionIsolatedAgent` complete.
   */
  patchAgentAdapterConfig?: (
    agentId: string,
    patch: Record<string, unknown>,
  ) => Promise<void>;
  /**
   * Optional: called once after all seed agents have been provisioned so the
   * gateway reloads its config and picks up the newly added isolated agents.
   */
  onAllAgentsProvisioned?: () => Promise<void>;
}

export interface SeedAgentOptions {
  /** Platform-wide OpenClaw gateway URL (ws:// or wss://). */
  openclawGatewayUrl: string;
  /** Platform-wide OpenClaw gateway token (`x-openclaw-token` header). */
  openclawGatewayToken: string;
  /** User id that owns the seed operation (goes into activity log). */
  actorUserId: string | null;
  /** When true, heartbeat.enabled=true is set on every seed agent. */
  enableHeartbeat: boolean;
  /** Heartbeat interval in seconds when enableHeartbeat is true. */
  heartbeatIntervalSec?: number;
}

/**
 * Provision every agent in SEED_AGENTS for a newly created company.
 *
 * Idempotent: skips a seedKey that already exists in this company (checked
 * via `metadata.seedKey`).
 *
 * Deployment-aware:
 *   - Default (NeoCompany): seeds the full Postiz fleet (Nora/Lyra/Nova/…).
 *   - Neoffice (env PAPERCLIP_DEPLOYMENT=neoffice OR
 *     PAPERCLIP_SKIP_DEFAULT_AGENTS=1): skips default seed. Neoffice provides
 *     its own agent fleet (Nora/Sophie/Marc/Léa/Thomas/Vincent) via a separate
 *     post-install seed script — avoids polluting the company with inert agents.
 */
export async function seedDefaultAgentsForCompany(
  companyId: string,
  services: SeedAgentServices,
  options: SeedAgentOptions,
  existingSeedKeys: Set<string> = new Set(),
): Promise<Array<{ agentId: string; seedKey: string }>> {
  // Skip default seed for deployments that provide their own agent fleet.
  if (
    process.env.PAPERCLIP_DEPLOYMENT === "neoffice" ||
    process.env.PAPERCLIP_SKIP_DEFAULT_AGENTS === "1"
  ) {
    return [];
  }

  const created: Array<{ agentId: string; seedKey: string }> = [];
  for (const spec of SEED_AGENTS) {
    if (existingSeedKeys.has(spec.seedKey)) continue;

    const adapterConfig: Record<string, unknown> = {
      url: options.openclawGatewayUrl,
      headers: { "x-openclaw-token": options.openclawGatewayToken },
      // The materializer uses this to pick the right onboarding-assets dir.
      instructionsTemplate: spec.instructionsTemplate,
    };

    const runtimeConfig = {
      heartbeat: {
        enabled: options.enableHeartbeat,
        intervalSec: options.heartbeatIntervalSec ?? 900,
      },
    };

    const metadata = {
      isSystem: true,
      isMain: spec.isMain === true,
      seedKey: spec.seedKey,
      toolsAllowlist: spec.toolsAllowlist ?? null,
    };

    const createdAgent = await services.createAgent(companyId, {
      name: spec.name,
      role: spec.role,
      title: spec.title,
      icon: spec.icon,
      adapterType: "openclaw_gateway",
      adapterConfig,
      runtimeConfig,
      metadata,
      status: "idle",
      spentMonthlyCents: 0,
      lastHeartbeatAt: null,
    });

    await services.materializeBundleForNewAgent(createdAgent);
    await services.grantDefaultAgentAccess(
      companyId,
      createdAgent.id,
      options.actorUserId,
    );

    // Multi-tenant isolation: provision a per-agent OpenClaw workspace so
    // memory never leaks between agents/companies. See
    // server/src/services/openclaw-isolated-agents.ts for the shell plumbing.
    if (services.provisionIsolatedAgent && services.patchAgentAdapterConfig) {
      try {
        const iso = await services.provisionIsolatedAgent({
          companyId,
          role: spec.role,
          agentName: spec.name,
          paperclipAgentId: createdAgent.id,
        });
        await services.patchAgentAdapterConfig(createdAgent.id, {
          agentId: iso.openclawAgentId,
          claimedApiKeyPath: iso.claimedApiKeyPath,
        });
      } catch (err) {
        // Non-fatal — the agent still works on the shared workspace and the
        // reconcile CLI can fix isolation later. Surfaced via console so prod
        // logs catch it.
        // eslint-disable-next-line no-console
        console.error(
          `[seed-agents] isolated-agent provision failed for ${spec.seedKey} (${createdAgent.id})`,
          err,
        );
      }
    }

    await services.logActivity({
      companyId,
      agentId: createdAgent.id,
      actorUserId: options.actorUserId,
      seedKey: spec.seedKey,
    });

    created.push({ agentId: createdAgent.id, seedKey: spec.seedKey });
  }

  if (created.length > 0 && services.onAllAgentsProvisioned) {
    try {
      await services.onAllAgentsProvisioned();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[seed-agents] onAllAgentsProvisioned hook failed", err);
    }
  }
  return created;
}
