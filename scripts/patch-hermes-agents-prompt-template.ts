//// Neocompany Modification — apply HERMES_CHAT_PROMPT_TEMPLATE to existing hermes_local agents
//// This script does not exist upstream. It is part of the Hermes adapter
//// migration polish (Obsidian: Neocompany/fork/plan-migration-hermes.md,
//// Post-migration polish 2026-05-18, fix #1: chat-friendly promptTemplate).
//// End Neocompany Modification

/**
 * Hot-patch every `hermes_local` agent's adapter_config with the canonical
 * HERMES_CHAT_PROMPT_TEMPLATE exported from seed-agents.ts.
 *
 * Why: newly-seeded agents pick up the template through seed-agents.ts, but
 * the 27 agents we migrated in May 2026 were seeded before the template
 * existed. SQL-escaping a multi-line template inline is fragile, so we import
 * the constant and let postgres.js bind it as a parameter.
 *
 * Idempotent: running it twice just rewrites the same value.
 *
 * Usage (on prod box):
 *   cd /home/ubuntu/paperclip
 *   ./server/node_modules/.bin/tsx scripts/patch-hermes-agents-prompt-template.ts
 *
 * Env: DATABASE_URL (else loadConfig fallback).
 */

import { createDb, agents, eq, sql } from "../packages/db/src/index.js";
import { loadConfig } from "../server/src/config.js";
import { HERMES_CHAT_PROMPT_TEMPLATE } from "../server/src/services/seed-agents.js";

async function main() {
  const config = loadConfig();
  const dbUrl =
    process.env.DATABASE_URL?.trim() ||
    config.databaseUrl ||
    `postgres://paperclip:paperclip@127.0.0.1:${config.embeddedPostgresPort}/paperclip`;
  const db = createDb(dbUrl);

  // Build the patched adapter_config in SQL with jsonb_set so we only touch
  // the promptTemplate key and leave everything else (model, extraArgs, env,
  // hermesCommand, instructionsTemplate, …) untouched.
  const rows = await db
    .update(agents)
    .set({
      adapterConfig: sql`${agents.adapterConfig} || jsonb_build_object('promptTemplate', ${HERMES_CHAT_PROMPT_TEMPLATE}::text)`,
      updatedAt: new Date(),
    })
    .where(eq(agents.adapterType, "hermes_local"))
    .returning({ id: agents.id, name: agents.name, companyId: agents.companyId });

  console.log(`[patch-hermes-prompt] updated ${rows.length} agents`);
  for (const row of rows) {
    console.log(`  ✓ ${row.name} (${row.id}) company=${row.companyId}`);
  }

  const closable = db as unknown as {
    $client?: { end?: (opts: { timeout?: number }) => Promise<unknown> };
  };
  await closable.$client?.end?.({ timeout: 5 }).catch(() => undefined);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[patch-hermes-prompt] fatal: ${message}`);
  process.exitCode = 1;
});
