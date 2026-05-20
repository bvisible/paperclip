/**
 * plugin-nora-memory — memory tools (retain / recall / list / dream).
 *
 * Replaces the Hindsight Python service. Everything runs inside the
 * Paperclip plugin worker:
 *   - storage  : pgvector table in the plugin's own Postgres namespace
 *   - embed    : HTTP call to the Olares embeddings endpoint
 *   - dream    : sleep-time consolidation, HTTP call to the Olares LLM
 *
 * No LLM extraction on retain — the text is embedded and stored as-is.
 * Recall is 100% semantic (cosine similarity, HNSW index).
 */
import type { PluginContext, ToolRunContext, ToolResult } from "@paperclipai/plugin-sdk";
import { DB_NAMESPACE, EMBEDDING_DIM } from "./manifest.js";

// --- External endpoints (Olares) -------------------------------------------
// Embeddings + LLM sit behind the Olares gateway and share one bearer key.
// All values come from the plugin's operator config (instanceConfigSchema),
// read via ctx.config.get(). Defaults below match the NORA fleet.
interface MemoryConfig {
  embeddingsUrl: string;
  embeddingsModel: string;
  llmUrl: string;
  llmModel: string;
  apiKey: string;
}

const DEFAULT_CONFIG: MemoryConfig = {
  embeddingsUrl: "https://embeddings.noraai.ch/small/v1/embeddings",
  embeddingsModel: "Qwen3-Embedding-0.6B-Q8_0.gguf",
  llmUrl: "https://olares1.noraai.ch/v1/chat/completions",
  llmModel: "Qwen3.6-35B-A3B-UD-Q3_K_XL.gguf",
  apiKey: "",
};

/** Resolve the plugin config (operator values over defaults). */
async function resolveConfig(ctx: PluginContext): Promise<MemoryConfig> {
  let operator: Record<string, unknown> = {};
  try {
    operator = await ctx.config.get();
  } catch {
    operator = {};
  }
  const pick = (k: keyof MemoryConfig): string => {
    const v = operator[k];
    return typeof v === "string" && v.trim() ? v.trim() : DEFAULT_CONFIG[k];
  };
  return {
    embeddingsUrl: pick("embeddingsUrl"),
    embeddingsModel: pick("embeddingsModel"),
    llmUrl: pick("llmUrl"),
    llmModel: pick("llmModel"),
    apiKey: typeof operator.apiKey === "string" ? operator.apiKey : "",
  };
}

/** Authorization header for the Olares gateway, when a key is configured. */
function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

// --- Tuning ----------------------------------------------------------------
const CHUNK_WORDS = 320; // target words per chunk before embedding
const CHUNK_OVERLAP_WORDS = 40;
const RECALL_DEFAULT_LIMIT = 15;
const LIST_DEFAULT_LIMIT = 100;
const DEDUP_COSINE_THRESHOLD = 0.95; // Light Sleep: near-identical memories
const HTTP_TIMEOUT_MS = 30_000;

type ToolParams = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function table(name: string): string {
  return `${DB_NAMESPACE}.${name}`;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`'${field}' is required and must be a non-empty string`);
  }
  return value.trim();
}

function resolveCompanyId(input: ToolParams, runCtx: ToolRunContext): string {
  const fromParams = typeof input.companyId === "string" ? input.companyId.trim() : "";
  if (fromParams) return fromParams;
  if (runCtx.companyId) return runCtx.companyId;
  throw new Error("'companyId' is required");
}

/** Split a long text into ~CHUNK_WORDS word chunks with light overlap. */
export function chunkText(text: string): string[] {
  const words = text.trim().split(/\s+/);
  if (words.length <= CHUNK_WORDS) return [text.trim()];
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + CHUNK_WORDS, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end >= words.length) break;
    start = end - CHUNK_OVERLAP_WORDS;
  }
  return chunks;
}

/** pgvector text literal: [0.1,0.2,...]. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

async function fetchWithTimeout(
  ctx: PluginContext,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    return await ctx.http.fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Embed one or more texts via the Olares embeddings endpoint (OpenAI shape). */
export async function embed(ctx: PluginContext, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const cfg = await resolveConfig(ctx);
  const resp = await fetchWithTimeout(ctx, cfg.embeddingsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(cfg.apiKey) },
    body: JSON.stringify({ model: cfg.embeddingsModel, input: texts }),
  });
  if (!resp.ok) {
    throw new Error(`embeddings endpoint returned HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as { data?: Array<{ embedding: number[] }> };
  const vectors = (json.data ?? []).map((d) => d.embedding);
  if (vectors.length !== texts.length) {
    throw new Error(`embeddings endpoint returned ${vectors.length} vectors for ${texts.length} inputs`);
  }
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIM) {
      throw new Error(`embedding dimension ${v.length} != expected ${EMBEDDING_DIM}`);
    }
  }
  return vectors;
}

/** One-shot LLM completion via the Olares chat endpoint (OpenAI shape). */
async function llmComplete(ctx: PluginContext, system: string, user: string): Promise<string> {
  const cfg = await resolveConfig(ctx);
  const resp = await fetchWithTimeout(ctx, cfg.llmUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(cfg.apiKey) },
    body: JSON.stringify({
      model: cfg.llmModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: 600,
    }),
  });
  if (!resp.ok) {
    throw new Error(`LLM endpoint returned HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerMemoryTools(ctx: PluginContext): void {
  const schema = (name: string) =>
    ctx.manifest.tools?.find((t) => t.name === name)?.parametersSchema ?? { type: "object" };

  // --- memory_retain -------------------------------------------------------
  ctx.tools.register(
    "memory_retain",
    {
      displayName: "Retain Memory",
      description: "Store a memory for later semantic recall.",
      parametersSchema: schema("memory_retain"),
    },
    async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
      const input = params as ToolParams;
      const companyId = resolveCompanyId(input, runCtx);
      const bankId = requireString(input.bankId, "bankId");
      const content = requireString(input.content, "content");
      const factType =
        typeof input.factType === "string" && input.factType.trim()
          ? input.factType.trim()
          : "experience";
      const tags = Array.isArray(input.tags)
        ? input.tags.filter((t): t is string => typeof t === "string")
        : [];
      const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
      const documentId =
        typeof input.documentId === "string" && input.documentId.trim()
          ? input.documentId.trim()
          : null;

      // Reinforcement: if this documentId already exists, bump proof_count.
      if (documentId) {
        const existing = await ctx.db.query<{ id: string }>(
          `SELECT id FROM ${table("memory_units")}
            WHERE company_id = $1 AND document_id = $2 LIMIT 1`,
          [companyId, documentId],
        );
        if (existing.length > 0) {
          await ctx.db.execute(
            `UPDATE ${table("memory_units")}
                SET proof_count = proof_count + 1
              WHERE company_id = $1 AND document_id = $2`,
            [companyId, documentId],
          );
          return {
            content: `Reinforced existing memory (documentId=${documentId}).`,
            data: { companyId, bankId, documentId, reinforced: true },
          };
        }
      }

      const chunks = chunkText(content);
      const vectors = await embed(ctx, chunks);
      let inserted = 0;
      for (let i = 0; i < chunks.length; i++) {
        await ctx.db.execute(
          `INSERT INTO ${table("memory_units")}
             (company_id, bank_id, content, embedding, fact_type, tags, metadata, document_id)
           VALUES ($1, $2, $3, $4::vector, $5, $6, $7::jsonb, $8)`,
          [
            companyId,
            bankId,
            chunks[i],
            toVectorLiteral(vectors[i]!),
            factType,
            tags,
            JSON.stringify(metadata),
            documentId,
          ],
        );
        inserted++;
      }
      return {
        content: `Retained ${inserted} memory chunk(s) in bank '${bankId}'.`,
        data: { companyId, bankId, factType, chunks: inserted },
      };
    },
  );

  // --- memory_recall -------------------------------------------------------
  ctx.tools.register(
    "memory_recall",
    {
      displayName: "Recall Memory",
      description: "Semantic search over a memory bank.",
      parametersSchema: schema("memory_recall"),
    },
    async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
      const input = params as ToolParams;
      const companyId = resolveCompanyId(input, runCtx);
      const bankId = requireString(input.bankId, "bankId");
      const query = requireString(input.query, "query");
      const limit =
        typeof input.limit === "number" && input.limit > 0 && input.limit <= 100
          ? Math.floor(input.limit)
          : RECALL_DEFAULT_LIMIT;
      const factType =
        typeof input.factType === "string" && input.factType.trim()
          ? input.factType.trim()
          : null;
      const minProofCount =
        typeof input.minProofCount === "number" && input.minProofCount > 0
          ? Math.floor(input.minProofCount)
          : null;

      const [queryVec] = await embed(ctx, [query]);
      const filters: string[] = [
        "company_id = $1",
        "bank_id = $2",
        "superseded_by IS NULL",
      ];
      const args: unknown[] = [companyId, bankId, toVectorLiteral(queryVec!), limit];
      if (factType) {
        args.push(factType);
        filters.push(`fact_type = $${args.length}`);
      }
      if (minProofCount) {
        args.push(minProofCount);
        filters.push(`proof_count >= $${args.length}`);
      }

      const rows = await ctx.db.query<{
        id: string;
        content: string;
        fact_type: string;
        tags: string[];
        proof_count: number;
        created_at: string;
        distance: number;
      }>(
        `SELECT id, content, fact_type, tags, proof_count, created_at,
                (embedding <=> $3::vector) AS distance
           FROM ${table("memory_units")}
          WHERE ${filters.join(" AND ")}
          ORDER BY embedding <=> $3::vector
          LIMIT $4`,
        args,
      );

      // Reinforce recall stats — feeds the Dream forgetting phase.
      if (rows.length > 0) {
        await ctx.db.execute(
          `UPDATE ${table("memory_units")}
              SET access_count = access_count + 1, accessed_at = now()
            WHERE id = ANY($1::uuid[])`,
          [rows.map((r) => r.id)],
        );
      }

      return {
        content: rows.length
          ? rows
              .map(
                (r, i) =>
                  `${i + 1}. [${r.fact_type}] ${r.content}` +
                  (r.proof_count > 1 ? ` (×${r.proof_count})` : ""),
              )
              .join("\n")
          : "No relevant memories found.",
        data: {
          companyId,
          bankId,
          query,
          results: rows.map((r) => ({
            id: r.id,
            content: r.content,
            factType: r.fact_type,
            tags: r.tags,
            proofCount: r.proof_count,
            similarity: 1 - r.distance,
            createdAt: r.created_at,
          })),
        },
      };
    },
  );

  // --- memory_list ---------------------------------------------------------
  ctx.tools.register(
    "memory_list",
    {
      displayName: "List Memories",
      description: "List memories of a bank, reverse-chronological.",
      parametersSchema: schema("memory_list"),
    },
    async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
      const input = params as ToolParams;
      const companyId = resolveCompanyId(input, runCtx);
      const bankId = requireString(input.bankId, "bankId");
      const limit =
        typeof input.limit === "number" && input.limit > 0 && input.limit <= 1000
          ? Math.floor(input.limit)
          : LIST_DEFAULT_LIMIT;
      const factType =
        typeof input.factType === "string" && input.factType.trim()
          ? input.factType.trim()
          : null;
      const minProofCount =
        typeof input.minProofCount === "number" && input.minProofCount > 0
          ? Math.floor(input.minProofCount)
          : null;

      const filters: string[] = ["company_id = $1", "bank_id = $2", "superseded_by IS NULL"];
      const args: unknown[] = [companyId, bankId, limit];
      if (factType) {
        args.push(factType);
        filters.push(`fact_type = $${args.length}`);
      }
      if (minProofCount) {
        args.push(minProofCount);
        filters.push(`proof_count >= $${args.length}`);
      }

      const rows = await ctx.db.query<{
        id: string;
        content: string;
        fact_type: string;
        tags: string[];
        proof_count: number;
        created_at: string;
      }>(
        `SELECT id, content, fact_type, tags, proof_count, created_at
           FROM ${table("memory_units")}
          WHERE ${filters.join(" AND ")}
          ORDER BY created_at DESC
          LIMIT $3`,
        args,
      );

      return {
        content: `${rows.length} memory unit(s) in bank '${bankId}'.`,
        data: { companyId, bankId, items: rows },
      };
    },
  );

  // --- memory_dream --------------------------------------------------------
  ctx.tools.register(
    "memory_dream",
    {
      displayName: "Dream (consolidate memory)",
      description: "Sleep-time consolidation: dedup, summarise, forget.",
      parametersSchema: schema("memory_dream"),
    },
    async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
      const input = params as ToolParams;
      const companyId = resolveCompanyId(input, runCtx);
      const bankFilter =
        typeof input.bankId === "string" && input.bankId.trim() ? input.bankId.trim() : null;
      const dryRun = input.dryRun === true;

      const result = await runDream(ctx, { companyId, bankFilter, dryRun });
      return {
        content:
          `Dream ${dryRun ? "(dry-run) " : ""}complete — ` +
          `deduped ${result.deduped}, consolidated ${result.consolidated} cluster(s), ` +
          `forgot ${result.forgotten}.`,
        data: { companyId, ...result },
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Dream — sleep-time consolidation
// ---------------------------------------------------------------------------

interface DreamResult {
  deduped: number;
  consolidated: number;
  forgotten: number;
}

/**
 * Three-phase consolidation (cf. SCM / OpenClaw dreaming):
 *   1. Light Sleep   — dedup near-identical memories (cosine > 0.95)
 *   2. Deep Sleep    — summarise old raw-memory clusters into syntheses
 *   3. Forgetting    — drop superseded, never-recalled, old memories
 *
 * Runs as a one-shot job (intended: nightly cron) — no resident process.
 */
export async function runDream(
  ctx: PluginContext,
  opts: { companyId: string; bankFilter: string | null; dryRun: boolean },
): Promise<DreamResult> {
  const { companyId, bankFilter, dryRun } = opts;
  const result: DreamResult = { deduped: 0, consolidated: 0, forgotten: 0 };

  const bankClause = bankFilter ? "AND bank_id = $2" : "";
  const bankArg = bankFilter ? [bankFilter] : [];

  // --- Phase 1: Light Sleep — dedup ----------------------------------------
  // For each live memory, find a near-identical older sibling in the same
  // bank (cosine distance < 1 - threshold) and fold it in.
  const dupPairs = await ctx.db.query<{ keep_id: string; drop_id: string }>(
    `SELECT a.id AS keep_id, b.id AS drop_id
       FROM ${table("memory_units")} a
       JOIN ${table("memory_units")} b
         ON a.company_id = b.company_id
        AND a.bank_id = b.bank_id
        AND a.id < b.id
        AND a.superseded_by IS NULL
        AND b.superseded_by IS NULL
        AND (a.embedding <=> b.embedding) < ${1 - DEDUP_COSINE_THRESHOLD}
      WHERE a.company_id = $1 ${bankClause}`,
    [companyId, ...bankArg],
  );
  if (!dryRun && dupPairs.length > 0) {
    for (const pair of dupPairs) {
      await ctx.db.execute(
        `UPDATE ${table("memory_units")}
            SET proof_count = proof_count + 1
          WHERE id = $1`,
        [pair.keep_id],
      );
      await ctx.db.execute(
        `UPDATE ${table("memory_units")}
            SET superseded_by = $1
          WHERE id = $2 AND superseded_by IS NULL`,
        [pair.keep_id, pair.drop_id],
      );
    }
  }
  result.deduped = dupPairs.length;

  // --- Phase 2: Deep Sleep — consolidate old raw clusters ------------------
  // Take raw (non-consolidated, non-superseded) memories older than 14 days,
  // grouped by bank, and summarise each bank's batch into one synthesis.
  const oldBanks = await ctx.db.query<{ bank_id: string; n: number }>(
    `SELECT bank_id, count(*)::int AS n
       FROM ${table("memory_units")}
      WHERE company_id = $1 ${bankClause}
        AND superseded_by IS NULL
        AND consolidated = false
        AND fact_type <> 'summary'
        AND created_at < now() - interval '14 days'
      GROUP BY bank_id
      HAVING count(*) >= 8`,
    [companyId, ...bankArg],
  );
  for (const bank of oldBanks) {
    const rawRows = await ctx.db.query<{ id: string; content: string }>(
      `SELECT id, content
         FROM ${table("memory_units")}
        WHERE company_id = $1 AND bank_id = $2
          AND superseded_by IS NULL AND consolidated = false
          AND fact_type <> 'summary'
          AND created_at < now() - interval '14 days'
        ORDER BY created_at ASC
        LIMIT 60`,
      [companyId, bank.bank_id],
    );
    if (rawRows.length < 8) continue;
    if (dryRun) {
      result.consolidated++;
      continue;
    }
    const synthesis = await llmComplete(
      ctx,
      "Tu consolides la mémoire d'un agent. À partir des souvenirs bruts fournis, " +
        "produis UNE synthèse dense et factuelle en français (5-12 phrases) qui " +
        "préserve les faits, décisions et préférences durables. Pas de bla-bla.",
      rawRows.map((r, i) => `${i + 1}. ${r.content}`).join("\n"),
    );
    if (!synthesis) continue;
    const [synthVec] = await embed(ctx, [synthesis]);
    const insertedRows = await ctx.db.query<{ id: string }>(
      `INSERT INTO ${table("memory_units")}
         (company_id, bank_id, content, embedding, fact_type, consolidated)
       VALUES ($1, $2, $3, $4::vector, 'summary', true)
       RETURNING id`,
      [companyId, bank.bank_id, synthesis, toVectorLiteral(synthVec!)],
    );
    const synthId = insertedRows[0]?.id;
    if (synthId) {
      await ctx.db.execute(
        `UPDATE ${table("memory_units")}
            SET superseded_by = $1
          WHERE id = ANY($2::uuid[])`,
        [synthId, rawRows.map((r) => r.id)],
      );
      result.consolidated++;
    }
  }

  // --- Phase 3: Forgetting -------------------------------------------------
  // Superseded memories that were never recalled and are old enough are
  // safe to drop — the signal lives in their synthesis.
  if (dryRun) {
    const [{ n }] = await ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM ${table("memory_units")}
        WHERE company_id = $1 ${bankClause}
          AND superseded_by IS NOT NULL
          AND access_count = 0
          AND created_at < now() - interval '30 days'`,
      [companyId, ...bankArg],
    );
    result.forgotten = n;
  } else {
    const forgotten = await ctx.db.execute(
      `DELETE FROM ${table("memory_units")}
        WHERE company_id = $1 ${bankClause}
          AND superseded_by IS NOT NULL
          AND access_count = 0
          AND created_at < now() - interval '30 days'`,
      [companyId, ...bankArg],
    );
    result.forgotten = forgotten.rowCount;
  }

  ctx.logger.info("memory_dream complete", { companyId, ...result, dryRun });
  return result;
}
