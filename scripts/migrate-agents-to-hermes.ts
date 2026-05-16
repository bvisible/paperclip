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
 *   2. Runs `hermes claw migrate --source <workspace>` with HERMES_HOME
 *      pointed at the agent's `_system` bucket — Hermes' own command parses
 *      MEMORY.md / SOUL.md / skills and merges them. The accumulated OpenClaw
 *      memory had no per-user dimension, so it lands in the `_system` bucket;
 *      post-migration chat runs get their own `{userId}` bucket (resolved at
 *      runtime by the registry wrapper).
 *   3. Updates the agent row: adapterType → "hermes_local", adapterConfig →
 *      the hermes shape (provider openai-codex, persistSession, timeoutSec,
 *      hermesCommand). HERMES_HOME is NOT baked into adapterConfig — the
 *      registry wrapper resolves it per (company, user, agent) at runtime.
 *
 * SAFETY:
 *   - Dry-run by default. Pass `--apply` to actually run the migration +
 *     write the DB. Without it the script only previews (`hermes claw
 *     migrate --dry-run`) and prints the DB changes it WOULD make.
 *   - Idempotent: agents already on `hermes_local` are skipped.
 *   - `--company <id>` scopes to one company; default = all companies.
 *   - A workspace that doesn't exist on disk is skipped with a warning (the
 *     agent stays on openclaw_gateway — re-run after fixing).
 *
 * Must run ON the prod box (needs the DB, the OpenClaw workspaces, and the
 * `hermes` binary). Env:
 *   PAPERCLIP_HERMES_COMMAND               (default: "hermes")
 *   OPENCLAW_ISOLATED_WORKSPACE_ROOT       (default: "/home/ubuntu/.openclaw/workspaces")
 *   PAPERCLIP_HERMES_HOME_ROOT             (default: "/var/lib/paperclip/hermes")
 *   PAPERCLIP_HERMES_ISOLATED=1            (must be set for HERMES_HOME resolution)
 *   DATABASE_URL                           (else loadConfig() / embedded pg)
 *
 * Usage:
 *   tsx scripts/migrate-agents-to-hermes.ts                      # dry-run, all
 *   tsx scripts/migrate-agents-to-hermes.ts --company <uuid>     # dry-run, one
 *   tsx scripts/migrate-agents-to-hermes.ts --apply              # real, all
 *   tsx scripts/migrate-agents-to-hermes.ts --company <uuid> --apply
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { agents, companies, createDb, eq } from "../packages/db/src/index.js";
import { loadConfig } from "../server/src/config.js";
import { resolveHermesHome } from "../server/src/services/hermes-isolated-agents.js";

const execFileAsync = promisify(execFile);

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
const HERMES_CMD = process.env.PAPERCLIP_HERMES_COMMAND?.trim() || "hermes";
const WORKSPACE_ROOT =
  process.env.OPENCLAW_ISOLATED_WORKSPACE_ROOT || "/home/ubuntu/.openclaw/workspaces";

interface MigrationOutcome {
  agentId: string;
  name: string;
  status: "migrated" | "skipped-already-hermes" | "skipped-no-workspace" | "failed";
  detail: string;
}

// `hermes claw migrate` exits 0 even when its underlying Python script is
// missing — it just prints "Migration script not found." and returns. If we
// trusted that exit code we would mark every agent as "migrated" and then
// `--apply` would flip the DB row WITHOUT having actually copied the
// OpenClaw memory, silently destroying the agent's history.
// We sniff the output for the known marker and surface it as an error so the
// outer try/catch marks the agent as `failed` and `--apply` keeps the DB
// untouched.
const MIGRATION_SCRIPT_MISSING_MARKER = "Migration script not found";

async function runHermesClawMigrate(
  source: string,
  hermesHome: string,
  dryRun: boolean,
): Promise<string> {
  const args = ["claw", "migrate", "--source", source];
  if (dryRun) args.push("--dry-run");
  else args.push("--yes");
  const { stdout, stderr } = await execFileAsync(HERMES_CMD, args, {
    env: { ...process.env, HERMES_HOME: hermesHome },
    maxBuffer: 16 * 1024 * 1024,
    timeout: 10 * 60_000,
  });
  const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
  if (combined.includes(MIGRATION_SCRIPT_MISSING_MARKER)) {
    throw new Error(
      `hermes claw migrate skill not installed (openclaw-migration / openclaw_to_hermes.py missing) — ` +
        `running --apply would flip adapterType without copying OpenClaw memory. ` +
        `Install the skill on the prod box before retrying.`,
    );
  }
  return combined;
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

    const openclawAgents = agentRows.filter((a) => a.adapterType === "openclaw_gateway");
    const alreadyHermes = agentRows.filter((a) => a.adapterType === "hermes_local");
    console.log(
      `\n── company ${company.name} (${company.id}) — ` +
        `${openclawAgents.length} openclaw, ${alreadyHermes.length} already hermes ──`,
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
        const preview = await runHermesClawMigrate(workspace, hermesHome, /* dryRun */ true);
        console.log(
          "      [dry-run preview]\n" +
            preview.split("\n").map((l) => `        ${l}`).join("\n"),
        );

        if (!APPLY) {
          console.log(`      (dry-run) WOULD set adapterType=hermes_local + rewrite adapterConfig`);
          outcomes.push({
            agentId: agent.id,
            name: agent.name,
            status: "migrated",
            detail: "dry-run only",
          });
          continue;
        }

        // Real migration: run hermes claw migrate for effect, then flip the DB row.
        const applied = await runHermesClawMigrate(workspace, hermesHome, /* dryRun */ false);
        console.log(
          "      [applied]\n" +
            applied.split("\n").map((l) => `        ${l}`).join("\n"),
        );
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
          detail: "applied",
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
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[migrate-agents-to-hermes] fatal: ${message}`);
  process.exitCode = 1;
});
