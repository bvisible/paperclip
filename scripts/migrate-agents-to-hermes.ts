//// Neocompany Modification — openclaw_gateway → hermes_local agent migration
//// This script does not exist upstream. It is part of the Hermes adapter
//// migration (Obsidian: Neocompany/fork/plan-migration-hermes.md, Phase 4).
//// End Neocompany Modification

/**
 * Migrate existing `openclaw_gateway` agents to the `hermes_local` adapter.
 *
 * For each openclaw_gateway agent it:
 *   1. Resolves the agent's isolated OpenClaw workspace
 *      (`{OPENCLAW_ISOLATED_WORKSPACE_ROOT}/{companyId}-{role}`).
 *   2. Copies the workspace memory files into the agent's HERMES_HOME
 *      (`_system` bucket — accumulated OpenClaw memory had no per-user
 *      dimension, so it lands in `_system`; post-migration chat runs get
 *      their own `{userId}` bucket via the registry wrapper at runtime).
 *      Mapping (handled by buildCopyPlan):
 *        SOUL.md            → HERMES_HOME/SOUL.md (or imported-from-openclaw/
 *                              SOUL.md if Hermes already seeded one)
 *        MEMORY.md          → HERMES_HOME/memories/openclaw-MEMORY.md
 *        memory/**          → HERMES_HOME/memories/openclaw/**
 *        AGENTS.md, IDENTITY.md, USER.md, TOOLS.md, BOOTSTRAP.md,
 *        HEARTBEAT.md, DREAMS.md → HERMES_HOME/imported-from-openclaw/*
 *      Skipped: .git/, .openclaw/, paperclip-claimed-api-key.json
 *
 *      Why not `hermes claw migrate`? Upstream's openclaw_to_hermes.py only
 *      understands a full ~/.openclaw install root (config.yaml, state.db,
 *      profiles/). Our adapter writes a flat per-agent workspace, so the
 *      upstream tool reports "Nothing to migrate". See plan-migration-hermes.
 *   3. Updates the agent row: adapterType → "hermes_local", adapterConfig →
 *      the hermes shape (provider openai-codex, persistSession, timeoutSec,
 *      hermesCommand). HERMES_HOME is NOT baked into adapterConfig — the
 *      registry wrapper resolves it per (company, user, agent) at runtime.
 *
 * SAFETY:
 *   - Dry-run by default. `--apply` to actually copy + write the DB.
 *   - Idempotent: agents already on `hermes_local` are skipped.
 *   - `--company <id>` scopes to one company; default = all companies.
 *   - `--agent <id>` further scopes to a single agent (test rollout).
 *   - `--limit N` caps the number of agents migrated per company (progressive
 *     rollout — start with --limit 1 to validate one before the rest).
 *   - A workspace that doesn't exist on disk is skipped with a warning (the
 *     agent stays on openclaw_gateway — re-run after fixing).
 *
 * Must run ON the prod box (needs the DB and the OpenClaw workspaces). Env:
 *   PAPERCLIP_HERMES_COMMAND               (default: "hermes" — baked into
 *                                            new adapterConfig but unused by
 *                                            the copy itself)
 *   OPENCLAW_ISOLATED_WORKSPACE_ROOT       (default: "/home/ubuntu/.openclaw/workspaces")
 *   PAPERCLIP_HERMES_HOME_ROOT             (default: "/var/lib/paperclip/hermes")
 *   PAPERCLIP_HERMES_ISOLATED=1            (must be set for HERMES_HOME resolution)
 *   DATABASE_URL                           (else loadConfig() / embedded pg)
 *
 * Usage:
 *   tsx scripts/migrate-agents-to-hermes.ts                              # dry-run all
 *   tsx scripts/migrate-agents-to-hermes.ts --company <uuid>             # dry-run one
 *   tsx scripts/migrate-agents-to-hermes.ts --company <uuid> --limit 1   # dry-run, first agent only
 *   tsx scripts/migrate-agents-to-hermes.ts --apply                      # real, all
 *   tsx scripts/migrate-agents-to-hermes.ts --company <uuid> --limit 1 --apply  # real, one agent
 *   tsx scripts/migrate-agents-to-hermes.ts --agent <uuid> --apply       # real, exact agent
 */

import { existsSync, statSync } from "node:fs";
import { cp, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { agents, companies, createDb, eq } from "../packages/db/src/index.js";
import { loadConfig } from "../server/src/config.js";
import { resolveHermesHome } from "../server/src/services/hermes-isolated-agents.js";

function parseFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

const APPLY = hasFlag("--apply");
const ONLY_COMPANY = parseFlag("--company");
const ONLY_AGENT = parseFlag("--agent");
const LIMIT_RAW = parseFlag("--limit");
const LIMIT = LIMIT_RAW ? Math.max(1, Number.parseInt(LIMIT_RAW, 10) || 0) : null;
const WORKSPACE_ROOT =
  process.env.OPENCLAW_ISOLATED_WORKSPACE_ROOT || "/home/ubuntu/.openclaw/workspaces";

interface MigrationOutcome {
  agentId: string;
  name: string;
  status: "migrated" | "skipped-already-hermes" | "skipped-no-workspace" | "failed";
  detail: string;
}

interface CopyPlanEntry {
  src: string;
  dst: string;
  kind: "file" | "dir";
  bytes: number;
}

// We initially tried delegating to `hermes claw migrate` (upstream), but its
// `openclaw_to_hermes.py` only understands a standard `~/.openclaw/` install
// root with `config.yaml`/`state.db`/`profiles/`. Our adapter writes per-agent
// workspaces under `~/.openclaw/workspaces/{companyId}-{role}/` with a much
// simpler layout (SOUL.md, MEMORY.md, memory/*.md, AGENTS.md, IDENTITY.md…),
// and the upstream script reports "Nothing to migrate" on them.
// Discovery: 2026-05-16 dry-run on Reed Blake — see Obsidian
// Neocompany/fork/plan-migration-hermes.md.
//
// We do the copy ourselves with a small, explicit mapping that survives a
// future Hermes upgrade.
const TOP_LEVEL_KEEP = [
  "AGENTS.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "BOOTSTRAP.md",
  "HEARTBEAT.md",
  "DREAMS.md",
] as const;

async function buildCopyPlan(source: string, hermesHome: string): Promise<CopyPlanEntry[]> {
  const plan: CopyPlanEntry[] = [];

  const soulSrc = join(source, "SOUL.md");
  if (existsSync(soulSrc)) {
    const dstSoul = join(hermesHome, "SOUL.md");
    // Hermes seeds its own SOUL.md the first time the agent runs. If we have
    // never run the agent on Hermes yet (no file) we ship the OpenClaw soul as
    // the seed. Otherwise we file it under imported-from-openclaw/ so the
    // Hermes soul stays authoritative.
    const dst = existsSync(dstSoul)
      ? join(hermesHome, "imported-from-openclaw", "SOUL.md")
      : dstSoul;
    plan.push({ src: soulSrc, dst, kind: "file", bytes: statSync(soulSrc).size });
  }

  const memorySrc = join(source, "MEMORY.md");
  if (existsSync(memorySrc)) {
    plan.push({
      src: memorySrc,
      dst: join(hermesHome, "memories", "openclaw-MEMORY.md"),
      kind: "file",
      bytes: statSync(memorySrc).size,
    });
  }

  const memoryDirSrc = join(source, "memory");
  if (existsSync(memoryDirSrc) && statSync(memoryDirSrc).isDirectory()) {
    const dstDir = join(hermesHome, "memories", "openclaw");
    const size = await dirSize(memoryDirSrc);
    plan.push({ src: memoryDirSrc, dst: dstDir, kind: "dir", bytes: size });
  }

  for (const file of TOP_LEVEL_KEEP) {
    const src = join(source, file);
    if (existsSync(src)) {
      plan.push({
        src,
        dst: join(hermesHome, "imported-from-openclaw", file),
        kind: "file",
        bytes: statSync(src).size,
      });
    }
  }
  return plan;
}

async function dirSize(dir: string): Promise<number> {
  // Lightweight recursive sum — workspaces stay well under a few MB.
  const { readdir } = await import("node:fs/promises");
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(p);
    else if (entry.isFile()) total += (await stat(p)).size;
  }
  return total;
}

function formatPlan(plan: CopyPlanEntry[]): string {
  if (plan.length === 0) return "        (nothing to migrate)";
  const totalBytes = plan.reduce((sum, e) => sum + e.bytes, 0);
  const lines = plan.map(
    (e) => `        ${e.kind === "dir" ? "▸" : "·"} ${e.src} → ${e.dst} (${formatBytes(e.bytes)})`,
  );
  lines.push(`        total: ${plan.length} entr${plan.length === 1 ? "y" : "ies"}, ${formatBytes(totalBytes)}`);
  return lines.join("\n");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

async function applyCopyPlan(plan: CopyPlanEntry[]): Promise<void> {
  for (const entry of plan) {
    const dstParent = entry.dst.substring(0, entry.dst.lastIndexOf("/"));
    await mkdir(dstParent, { recursive: true });
    await cp(entry.src, entry.dst, { recursive: entry.kind === "dir", force: true });
  }
}

function hermesAdapterConfig(previous: Record<string, unknown>): Record<string, unknown> {
  // Mirror the hermes_local shape that seed-agents.ts builds for fresh seeds.
  const cfg: Record<string, unknown> = {
    provider: "openai-codex",
    persistSession: true,
    timeoutSec: 300,
  };
  if (process.env.PAPERCLIP_HERMES_COMMAND?.trim()) {
    cfg.hermesCommand = process.env.PAPERCLIP_HERMES_COMMAND.trim();
  }
  // Carry instructionsTemplate forward if the openclaw config had it.
  if (typeof previous.instructionsTemplate === "string") {
    cfg.instructionsTemplate = previous.instructionsTemplate;
  }
  return cfg;
}

async function main() {
  console.log(
    `[migrate-agents-to-hermes] mode=${APPLY ? "APPLY" : "DRY-RUN"}` +
      (ONLY_COMPANY ? ` company=${ONLY_COMPANY}` : " company=ALL"),
  );
  if (process.env.PAPERCLIP_HERMES_ISOLATED !== "1") {
    console.error(
      "✗ PAPERCLIP_HERMES_ISOLATED is not set to 1 — HERMES_HOME cannot be resolved. Aborting.",
    );
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const dbUrl =
    process.env.DATABASE_URL?.trim() ||
    config.databaseUrl ||
    `postgres://paperclip:paperclip@127.0.0.1:${config.embeddedPostgresPort}/paperclip`;
  const db = createDb(dbUrl);

  // Resolve target companies.
  const companyRows = ONLY_COMPANY
    ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, ONLY_COMPANY))
    : await db.select({ id: companies.id, name: companies.name }).from(companies);
  if (companyRows.length === 0) {
    console.log("No matching companies; nothing to do.");
    return;
  }

  const outcomes: MigrationOutcome[] = [];

  for (const company of companyRows) {
    const agentRows = await db
      .select({
        id: agents.id,
        name: agents.name,
        role: agents.role,
        adapterType: agents.adapterType,
        adapterConfig: agents.adapterConfig,
      })
      .from(agents)
      .where(eq(agents.companyId, company.id));

    let openclawAgents = agentRows.filter((a) => a.adapterType === "openclaw_gateway");
    const alreadyHermes = agentRows.filter((a) => a.adapterType === "hermes_local");
    const eligibleTotal = openclawAgents.length;
    if (ONLY_AGENT) {
      openclawAgents = openclawAgents.filter((a) => a.id === ONLY_AGENT);
    }
    if (LIMIT !== null) {
      openclawAgents = openclawAgents.slice(0, LIMIT);
    }
    const filterDesc = [
      ONLY_AGENT ? `agent=${ONLY_AGENT}` : null,
      LIMIT !== null ? `limit=${LIMIT}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    console.log(
      `\n── company ${company.name} (${company.id}) — ` +
        `${openclawAgents.length}/${eligibleTotal} openclaw selected, ` +
        `${alreadyHermes.length} already hermes` +
        (filterDesc ? ` (${filterDesc})` : "") +
        ` ──`,
    );

    for (const agent of openclawAgents) {
      const workspace = join(WORKSPACE_ROOT, `${company.id}-${agent.role}`);
      const hermesHome = resolveHermesHome(company.id, null, agent.id); // null userId → _system bucket
      if (!hermesHome) {
        outcomes.push({
          agentId: agent.id,
          name: agent.name,
          status: "failed",
          detail: "resolveHermesHome returned null (PAPERCLIP_HERMES_ISOLATED unset?)",
        });
        continue;
      }

      if (!existsSync(workspace)) {
        console.log(`  ⚠ ${agent.name} (${agent.role}) — workspace not found: ${workspace} → SKIP`);
        outcomes.push({
          agentId: agent.id,
          name: agent.name,
          status: "skipped-no-workspace",
          detail: workspace,
        });
        continue;
      }

      try {
        console.log(`  ▸ ${agent.name} (${agent.role})`);
        console.log(`      source:      ${workspace}`);
        console.log(`      HERMES_HOME: ${hermesHome}`);
        const plan = await buildCopyPlan(workspace, hermesHome);
        console.log("      [copy plan]\n" + formatPlan(plan));

        if (plan.length === 0) {
          // Empty workspace — nothing to migrate. We still flip the DB row on
          // --apply since the agent is supposed to move to Hermes anyway.
          console.log("      (workspace empty — no files to copy)");
        }

        if (!APPLY) {
          console.log(`      (dry-run) WOULD copy ${plan.length} entries + set adapterType=hermes_local`);
          outcomes.push({
            agentId: agent.id,
            name: agent.name,
            status: "migrated",
            detail: `dry-run only (${plan.length} entries)`,
          });
          continue;
        }

        await applyCopyPlan(plan);
        console.log(`      ✓ Copied ${plan.length} entries into ${hermesHome}`);
        const newConfig = hermesAdapterConfig(
          (agent.adapterConfig ?? {}) as Record<string, unknown>,
        );
        await db
          .update(agents)
          .set({ adapterType: "hermes_local", adapterConfig: newConfig, updatedAt: new Date() })
          .where(eq(agents.id, agent.id));
        console.log(`      ✓ DB updated: adapterType=hermes_local`);
        outcomes.push({
          agentId: agent.id,
          name: agent.name,
          status: "migrated",
          detail: `applied (${plan.length} entries)`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`      ✗ FAILED: ${message}`);
        outcomes.push({
          agentId: agent.id,
          name: agent.name,
          status: "failed",
          detail: message,
        });
      }
    }

    for (const agent of alreadyHermes) {
      outcomes.push({
        agentId: agent.id,
        name: agent.name,
        status: "skipped-already-hermes",
        detail: "",
      });
    }
  }

  // Summary.
  const by = (s: MigrationOutcome["status"]) => outcomes.filter((o) => o.status === s).length;
  console.log(
    `\n[migrate-agents-to-hermes] done — ` +
      `${by("migrated")} ${APPLY ? "migrated" : "would-migrate"}, ` +
      `${by("skipped-already-hermes")} already hermes, ` +
      `${by("skipped-no-workspace")} no-workspace, ` +
      `${by("failed")} failed`,
  );
  if (by("failed") > 0) {
    console.log("\nFailures:");
    for (const o of outcomes.filter((x) => x.status === "failed")) {
      console.log(`  - ${o.name} (${o.agentId}): ${o.detail}`);
    }
    process.exitCode = 1;
  }
  if (!APPLY) {
    console.log("\nThis was a DRY RUN. Re-run with --apply to perform the migration.");
  }

  // Close the postgres pool so the process exits cleanly. Without this, tsx
  // hangs forever and CI invocations end with timeout (exit 124).
  const closable = db as unknown as {
    $client?: { end?: (opts: { timeout?: number }) => Promise<unknown> };
  };
  await closable.$client?.end?.({ timeout: 5 }).catch(() => undefined);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[migrate-agents-to-hermes] fatal: ${message}`);
  process.exitCode = 1;
});
