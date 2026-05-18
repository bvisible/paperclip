//// Neocompany Modification — hot-patch hermes_local agents to disable -Q
//// Adds `quiet: false` to adapter_config so the adapter no longer passes
//// `-Q` to `hermes chat`. Without -Q Hermes streams its response line by
//// line (wrapped in a `╭─ ⚕ Hermes ─╮` decorated box), which our updated
//// `createHermesPlainTextParser` now parses for true token-by-token UX.
////
//// Runs against the prod DB the script's PG* env points at — defaults to
//// localhost (when invoked on the prod box itself). Idempotent: safe to
//// re-run after future merges that change the adapter contract.
//// End Neocompany Modification

import { Pool } from "pg";

const pool = new Pool({
  host: process.env.PGHOST ?? "localhost",
  user: process.env.PGUSER ?? "paperclip",
  password: process.env.PGPASSWORD ?? "paperclip2026",
  database: process.env.PGDATABASE ?? "paperclip",
  port: Number(process.env.PGPORT ?? 5432),
});

async function main() {
  const before = await pool.query<{ id: string; name: string; company_id: string; quiet: boolean | null }>(
    `SELECT id, name, company_id, (adapter_config->>'quiet')::bool AS quiet
       FROM agents
      WHERE adapter_type = 'hermes_local'
      ORDER BY company_id, name;`,
  );
  console.log(`Found ${before.rowCount} hermes_local agents.`);

  const toPatch = before.rows.filter((row) => row.quiet !== false);
  console.log(`Will patch ${toPatch.length} that don't already have quiet=false.`);
  if (toPatch.length === 0) {
    console.log("Nothing to do.");
    await pool.end();
    return;
  }

  await pool.query(
    `UPDATE agents
        SET adapter_config = adapter_config || jsonb_build_object('quiet', false),
            updated_at = now()
      WHERE adapter_type = 'hermes_local'
        AND ((adapter_config->>'quiet')::bool IS DISTINCT FROM false);`,
  );

  const after = await pool.query<{ count: string }>(
    `SELECT count(*) FROM agents
      WHERE adapter_type = 'hermes_local'
        AND (adapter_config->>'quiet')::bool = false;`,
  );
  console.log(`✓ Now ${after.rows[0]!.count} agents have quiet=false.`);

  await pool.end();
}

main().catch((err) => {
  console.error("Patch failed:", err);
  process.exit(1);
});
