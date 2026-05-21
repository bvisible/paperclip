import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "paperclipai.plugin-nora-memory";

/**
 * Host-derived Postgres schema for this plugin's tables.
 *   namespace = plugin_<slug>_<sha256(pluginId)[:10]>
 *   slug      = "nora_memory"
 *   pluginId  = "paperclipai.plugin-nora-memory"
 * Kept here as a constant so the worker references the exact same schema
 * the migration created. If the plugin id ever changes, recompute it.
 */
export const DB_NAMESPACE = "plugin_nora_memory_bdc0493c33";

/** Embedding model — Qwen3-Embedding-0.6B on Olares, 1024 dimensions. */
export const EMBEDDING_DIM = 1024;

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "NORA Memory",
  description:
    "Agent long-term memory — retain, recall, and Dream-consolidate memories with pgvector. Replaces the Hindsight service.",
  author: "Neoffice / NORA",
  categories: ["automation"],
  capabilities: [
    "database.namespace.migrate",
    "database.namespace.read",
    "database.namespace.write",
    "agent.tools.register",
    "http.outbound",
    "companies.read",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      apiKey: {
        type: "string",
        title: "Olares API key",
        description:
          "Bearer key for the embeddings + LLM gateway (embeddings.noraai.ch / olares1.noraai.ch).",
      },
      embeddingsUrl: {
        type: "string",
        title: "Embeddings endpoint",
        default: "https://embeddings.noraai.ch/small/v1/embeddings",
      },
      embeddingsModel: {
        type: "string",
        title: "Embeddings model",
        default: "Qwen3-Embedding-0.6B-Q8_0.gguf",
      },
      llmUrl: {
        type: "string",
        title: "LLM endpoint (Dream consolidation)",
        default: "https://olares1.noraai.ch/v1/chat/completions",
      },
      llmModel: {
        type: "string",
        title: "LLM model (Dream consolidation)",
        default: "Qwen3.6-35B-A3B-UD-Q3_K_XL.gguf",
      },
      neoserviceUrl: {
        type: "string",
        title: "Neoservice URL (Claude curator)",
        description:
          "Base URL of the central neoservice Frappe instance hosting the Claude memory " +
          "curator endpoint. Used in Dream Phase 2 for fact_type ∈ {preference, style, rule}.",
        default: "https://neoservice.neoffice.me",
      },
      relayToken: {
        type: "string",
        title: "Curator relay token (HMAC)",
        description:
          "Shared secret used to sign requests to neoservice's memory_curator endpoint " +
          "(X-Relay-Token + HMAC body). If empty, Claude routing is disabled and Dream " +
          "falls back to Qwen for every cluster.",
      },
    },
  },
  database: {
    namespaceSlug: "nora_memory",
    migrationsDir: "migrations",
    coreReadTables: ["companies"],
  },
  tools: [
    {
      name: "memory_retain",
      displayName: "Retain Memory",
      description:
        "Store a memory (an experience, observation, fact, or user preference) for later semantic recall. " +
        "The text is embedded and stored as-is — no LLM extraction. Pass a stable `documentId` to reinforce " +
        "an existing memory instead of duplicating it.",
      parametersSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          bankId: {
            type: "string",
            description:
              "Memory bank — typically '<companyId>::<agentId>' for an agent's own memory, " +
              "or '<companyId>::user::<userId>' for a user's. Scopes recall.",
          },
          content: { type: "string", description: "The memory text to store." },
          factType: {
            type: "string",
            description: "experience | observation | preference (default: experience).",
          },
          tags: { type: "array", items: { type: "string" } },
          metadata: { type: "object" },
          documentId: {
            type: "string",
            description: "Optional stable id — if a memory with this documentId exists, its proof_count is incremented.",
          },
        },
        required: ["companyId", "bankId", "content"],
      },
    },
    {
      name: "memory_recall",
      displayName: "Recall Memory",
      description:
        "Semantic search over a memory bank. Returns the most relevant memories for the query, " +
        "ranked by vector similarity (cosine). Use this to recall what was learned, observed, or decided before.",
      parametersSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          bankId: { type: "string" },
          query: { type: "string", description: "Natural-language query." },
          limit: { type: "number", description: "Max results (default 15)." },
          factType: { type: "string", description: "Optional filter by fact_type." },
          minProofCount: { type: "number", description: "Optional — only memories reinforced at least N times." },
        },
        required: ["companyId", "bankId", "query"],
      },
    },
    {
      name: "memory_list",
      displayName: "List Memories",
      description:
        "List memories of a bank in reverse-chronological order, without semantic search. " +
        "Useful for audits and for the collective-sync filter.",
      parametersSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          bankId: { type: "string" },
          limit: { type: "number", description: "Max results (default 100)." },
          factType: { type: "string" },
          minProofCount: { type: "number" },
        },
        required: ["companyId", "bankId"],
      },
    },
    {
      name: "memory_dream",
      displayName: "Dream (consolidate memory)",
      description:
        "Sleep-time consolidation. Four phases: Light Sleep (dedup near-identical memories), " +
        "Deep Sleep (summarise old raw memory clusters into compact syntheses via Qwen/Claude), " +
        "Forgetting (drop superseded, never-recalled, old memories), Wiki Promotion (push the " +
        "most stable/recalled summaries into the company wiki). Intended to run nightly.",
      parametersSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          bankId: {
            type: "string",
            description:
              "Optional — restrict to one bank. Omit to consolidate all banks of the company.",
          },
          dryRun: {
            type: "boolean",
            description: "If true, report what would change without writing.",
          },
          staleDays: {
            type: "integer",
            minimum: 0,
            maximum: 365,
            description:
              "Age (in days) above which raw memories become candidates for Deep Sleep / " +
              "Forgetting. Default 14. Set to 0 only for debug runs to consolidate everything.",
          },
          minClusterSize: {
            type: "integer",
            minimum: 2,
            maximum: 100,
            description:
              "Minimum number of stale memories in a bank before Deep Sleep synthesises them. " +
              "Default 8. Lower for debug, higher to require stronger signal.",
          },
          useClaude: {
            type: "boolean",
            description:
              "If true (default), route comportemental clusters (fact_type ∈ preference/style/rule) " +
              "to the Claude curator on neoservice. Set false to force Qwen for every cluster.",
          },
          promoteToWiki: {
            type: "boolean",
            description:
              "If true (default), Phase 4 promotes stable summaries (access_count ≥ 3, " +
              "proof_count ≥ 2, curator-flagged promote=true) into wiki/entreprise/. Set " +
              "false to skip the promotion phase entirely.",
          },
        },
        required: ["companyId"],
      },
    },
  ],
};

export default manifest;
