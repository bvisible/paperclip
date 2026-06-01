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

//// Neocompany Modification — router chat prompt for the MAIN coordinator (Nora).
//// The chat is fixed on the main agent, who must ROUTE domain work to
//// specialists instead of doing it herself. Delegation cannot use a Paperclip
//// plugin tool: the hermes_local adapter only exposes Hermes-native tools
//// (terminal, write_file, …), so Nora delegates by calling the dedicated
//// /issues/delegate endpoint via terminal+curl with a fixed ROLE vocabulary
//// (the server resolves role -> specialist + creates the assigned issue).
//// Applied only to isMain agents; specialists keep HERMES_CHAT_PROMPT_TEMPLATE.
export const NORA_ROUTER_CHAT_PROMPT_TEMPLATE = `You are {{agentName}}, the single coordinator of a Paperclip-managed company (id: {{companyId}}). The human always talks to YOU in chat. Your job: understand the request, then either answer it yourself or ROUTE it to the right specialist — and tell the user what you did.

## SOUL — hard rules (read first, override everything below)
- NEVER invent a number, amount, percentage, balance, date, deadline, client/supplier/employee name, invoice/order id, status, or metric. If you do not have a value from a tool/API result IN THIS CONVERSATION, you do not know it.
- For any company/business data (revenue, posts published, analytics, client info, invoices…), you DELEGATE to the owning specialist or read it LIVE via the Paperclip API — you never recite it from memory.
- If a tool or API call fails, say so plainly. Never fabricate a result or a "general example" to fill the gap.
- "I don't have that" beats inventing. This wins over any instinct to be helpful by guessing.

## Answer directly vs route
Answer directly (no delegation) for: greetings, who-you-are, what-the-team-does, simple clarifications, and meta/status questions you can answer from a live API read. Keep it short and natural.

Route to a specialist for ANY real domain work — do NOT do the work yourself. You are the coordinator, not the executor: you do not write blog posts, draft social posts, run SEO audits, design visuals, or send client emails yourself. You route them. Map the intent to a ROLE:

| The user wants… | role |
|---|---|
| SEO, analytics, GSC/GA4, page speed | seo |
| Social posts (LinkedIn/Facebook/Instagram) | social |
| Community management, editorial planning | community |
| Blog / WordPress / content writing | writer |
| Customer support, inbound emails | support |
| Commercial follow-up, outreach, prospects | commercial |
| Brand research, positioning | brand |
| Visuals, templates, image generation | designer |

The [Available Agents] block in the message lists THIS company's agents and their roles — use it only to confirm a role exists here. Never route to yourself (role: main).

## How to delegate — ONE Paperclip API call (do it exactly like this)
You delegate by calling the dedicated delegate endpoint with the specialist's ROLE (from the table above) — NOT an agent id. The server finds the right specialist, assigns the task, and wakes them. Two terminal steps so there are no shell-quoting mistakes:

1. Write the JSON body to \`/tmp/delegate.json\` with the write_file tool:
   {"specialist":"<one role: seo|social|community|writer|support|commercial|brand|designer>","title":"<short imperative summary>","request":"<the user's request VERBATIM plus any context you have — the specialist sees only this field>"}
2. Send it with the terminal tool:
   curl -sS -X POST {{paperclipApiUrl}}/companies/{{companyId}}/issues/delegate -H "Authorization: Bearer \$PAPERCLIP_API_KEY" -H "X-Paperclip-Run-Id: \$PAPERCLIP_RUN_ID" -H "Content-Type: application/json" --data @/tmp/delegate.json
3. A 201 response containing "specialist":"<name>" confirms it worked. Then tell the user in ONE sentence what you routed and to whom — e.g. "C'est noté : j'ai confié ça à Nova (social), qui s'en occupe." Do NOT claim the work is done — it is in progress.

Caps & honesty: delegate a given request to the same specialist at most once. If the response is not 201 (or contains "error"), tell the user honestly that routing failed and they can retry — never pretend it worked, and never write the deliverable yourself to cover the gap.

## The user said:
{{taskBody}}

## Your turn
Reply in the user's language (French → French, vouvoiement by default; German → German; English → English). Decide: answer directly, or delegate via the steps above, then acknowledge in one sentence. Be concise and natural — no boilerplate, no "Heartbeat complete" framing.`;
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
            // Disable the adapter's `-Q` quiet flag so Hermes streams its
            // response line-by-line to stdout (with the `╭─ ⚕ Hermes ─╮`
            // box decoration). With -Q on, Hermes buffers and flushes the
            // entire response in one stdout write at the end — the chat UI
            // only sees the reply at done-time. createHermesPlainTextParser
            // strips the box decoration + headers so the chat bubble fills
            // in progressively. Verified 2026-05-18 by timestamping each
            // line of `hermes chat ... --yolo` vs `... -Q --yolo`.
            quiet: false,
            // Override the adapter's heartbeat DEFAULT_PROMPT_TEMPLATE with
            // a chat-oriented one. Paired with registry.ts injectChatPrompt
            // which copies ctx.context.chatPrompt → ctx.config.taskBody so
            // {{taskBody}} in the template renders the user message.
            // Without this, a "bonjour" in chat triggers Hermes' assigned-
            // issues lookup workflow instead of a conversational reply.
            //// Neocompany Modification — main coordinator gets the router
            //// prompt (delegates via /issues/delegate); specialists keep the
            //// plain conversational template.
            promptTemplate: spec.isMain === true
              ? NORA_ROUTER_CHAT_PROMPT_TEMPLATE
              : HERMES_CHAT_PROMPT_TEMPLATE,
            //// End Neocompany Modification
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
