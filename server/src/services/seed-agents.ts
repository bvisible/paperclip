//// Neocompany Modification — pure addition (Neocompany fork on top of paperclipai/paperclip)
//// This file does not exist upstream. Safe across upstream merges.

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

//// Neocompany Modification — Hermes adapter migration (feature-flagged)
// `PAPERCLIP_SEED_ADAPTER` selects which adapter newly-seeded agents use.
// Default "openclaw_gateway" keeps the legacy behaviour untouched — the
// migration to "hermes_local" only takes effect once this flag is flipped.
// This keeps Phase 2 safe to ship before the prod-side prerequisites
// (hermes CLI installed, Codex OAuth coexistence) are verified.
//   - openclaw_gateway: per-agent OpenClaw workspace, shell-provisioned at
//     seed time via `provisionIsolatedAgent`.
//   - hermes_local: per-(company,user,agent) HERMES_HOME, resolved at RUNTIME
//     by the registry wrapper (server/src/adapters/registry.ts) — nothing to
//     provision at seed time.
type SeedAdapterType = "openclaw_gateway" | "hermes_local";

function resolveSeedAdapterType(): SeedAdapterType {
  return process.env.PAPERCLIP_SEED_ADAPTER === "hermes_local"
    ? "hermes_local"
    : "openclaw_gateway";
}

// On the NeoCompany prod box `hermes` is installed in a dedicated venv
// (~/.hermes-venv/bin/hermes), NOT on the service PATH. The adapter defaults
// `hermesCommand` to bare "hermes"; we override it via env when the binary
// lives elsewhere. Unset → adapter keeps its "hermes" default (upstream
// behaviour, e.g. when hermes IS on PATH).
function resolveHermesCommand(): string | undefined {
  const cmd = process.env.PAPERCLIP_HERMES_COMMAND?.trim();
  return cmd && cmd.length > 0 ? cmd : undefined;
}

// hermes-paperclip-adapter's built-in DEFAULT_PROMPT_TEMPLATE is a heartbeat
// wake-up workflow (lists assigned issues, checks backlog, calls back). For
// paperclip-chat conversations the user types a free-form message and expects
// a direct reply, so we override the template with one that:
//   1. Includes {{taskBody}} (= the user's message, mapped in via
//      registry.ts injectChatPrompt from ctx.context.chatPrompt).
//   2. Explicitly forbids the heartbeat workflow.
//   3. Keeps Paperclip API access available (with the auth guard that the
//      registry wrapper prepends to any custom template).
export const HERMES_CHAT_PROMPT_TEMPLATE = `You are {{agentName}}, an AI agent employee in a Paperclip-managed company (id: {{companyId}}).

You are in a direct conversation with a human user — NOT a heartbeat wake-up. Respond naturally and conversationally to the user's message. Do not list issues, do not check for assigned work, do not perform any task-discovery routine unless the user explicitly asks for one.

## The user said:

{{taskBody}}

## Your turn

Reply directly to the user. Be concise, useful, and natural. If you genuinely need data from Paperclip to answer (e.g. the user asked about issues, costs, or company state), call the appropriate Paperclip API via the terminal tool using curl against {{paperclipApiUrl}} — but only when the user's question requires it. Otherwise just answer in plain prose.

Keep your reply focused. No agenda, no boilerplate, no "Heartbeat complete" framing.`;
//// End Neocompany Modification

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
 *
 * Adapter-aware (Neocompany): see `resolveSeedAdapterType` — the fleet is
 * seeded on `openclaw_gateway` (default) or `hermes_local` per the
 * `PAPERCLIP_SEED_ADAPTER` env flag.
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

  //// Neocompany Modification — resolve the seed adapter once per call
  const seedAdapterType = resolveSeedAdapterType();
  //// End Neocompany Modification

  const created: Array<{ agentId: string; seedKey: string }> = [];
  for (const spec of SEED_AGENTS) {
    if (existingSeedKeys.has(spec.seedKey)) continue;

    //// Neocompany Modification — adapter-specific config (openclaw_gateway | hermes_local)
    const adapterConfig: Record<string, unknown> =
      seedAdapterType === "hermes_local"
        ? {
            // Provider `openai-codex` = ChatGPT Pro OAuth, no API key —
            // same auth model as the openclaw_gateway path. `model` is
            // left unset so Hermes uses its config.yaml Codex default.
            // HERMES_HOME is NOT set here: the registry wrapper injects it
            // per (company, user, agent) at runtime.
            provider: "openai-codex",
            // hermes-paperclip-adapter defaults to "anthropic/claude-sonnet-4"
            // which Codex rejects (wrong namespace). Pin gpt-5.5 explicitly
            // to match the HERMES_HOME config.yaml the registry seeds.
            model: "gpt-5.5",
            persistSession: true,
            timeoutSec: 300,
            // Point at the venv-installed hermes binary when it's not on
            // the service PATH (PAPERCLIP_HERMES_COMMAND). Omitted → adapter
            // keeps its bare "hermes" default.
            ...(resolveHermesCommand()
              ? { hermesCommand: resolveHermesCommand() }
              : {}),
            // --yolo bypasses Hermes' interactive approval prompts for
            // shell/terminal tools. In a non-interactive chat invocation
            // (`hermes chat -q ... -Q`) nobody is there to confirm — without
            // --yolo every tool call comes back "BLOCKED: User denied" and
            // the model falls back to silence (paperclip-chat then renders
            // its "Je n'ai pas réussi à traiter cette demande" placeholder).
            // Discovered 2026-05-16 via the agent.log of a Scout run.
            extraArgs: ["--yolo"],
            // Override the adapter's heartbeat DEFAULT_PROMPT_TEMPLATE with
            // a chat-oriented one. Paired with registry.ts injectChatPrompt
            // which copies ctx.context.chatPrompt → ctx.config.taskBody so
            // {{taskBody}} in the template renders the user message.
            // Without this, a "bonjour" in chat triggers Hermes' assigned-
            // issues lookup workflow instead of a conversational reply.
            promptTemplate: HERMES_CHAT_PROMPT_TEMPLATE,
            // Kept so materializeBundleForNewAgent still writes the
            // onboarding-assets bundle (AGENTS.md) for this seed.
            instructionsTemplate: spec.instructionsTemplate,
          }
        : {
            url: options.openclawGatewayUrl,
            headers: { "x-openclaw-token": options.openclawGatewayToken },
            // The materializer uses this to pick the right onboarding-assets dir.
            instructionsTemplate: spec.instructionsTemplate,
          };
    //// End Neocompany Modification

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
      //// Neocompany Modification — adapter from PAPERCLIP_SEED_ADAPTER flag
      adapterType: seedAdapterType,
      //// End Neocompany Modification
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
    //// Neocompany Modification — only the openclaw_gateway path provisions a
    //// workspace at seed time. The hermes_local path isolates memory at
    //// runtime via HERMES_HOME (registry wrapper) — nothing to do here.
    if (
      seedAdapterType === "openclaw_gateway" &&
      services.provisionIsolatedAgent &&
      services.patchAgentAdapterConfig
    ) {
    //// End Neocompany Modification
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
