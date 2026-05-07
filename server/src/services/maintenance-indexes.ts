import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

/**
 * Apply opportunistic, idempotent index/maintenance work that improves
 * runtime performance on instances that already have schema migration 0051+.
 *
 * Each statement uses IF EXISTS / IF NOT EXISTS so it is safe to run on every
 * boot. Failures are logged but never abort startup — these are
 * optimisations, not invariants.
 *
 * Why this is here and not a drizzle migration:
 *  - One statement DROPs and recreates the GIN trigram index on
 *    issue_comments.body with a `WHERE length(body) <= 16384` predicate so
 *    pathological bodies (we saw 7 MB average per row on Osiris due to
 *    plugins inserting raw JSON/HTML payloads) no longer get trigrammed.
 *    This is a pure optimisation; the drizzle schema does not declare the
 *    index, so a fresh DB run will simply recreate it through migration 0051
 *    and this service will redo the WHERE swap on the next boot.
 *  - The partial index on heartbeat_runs(status) speeds up the unfiltered
 *    `count(*) WHERE status IN (queued, running)` issued by `/health` so
 *    the dev panel does not table-scan on every UI tab tick.
 */
export async function applyMaintenanceIndexes(db: Db): Promise<void> {
  const statements: Array<{ name: string; sqlText: string }> = [
    {
      name: "heartbeat_runs_status_active_idx",
      sqlText: `
        CREATE INDEX IF NOT EXISTS heartbeat_runs_status_active_idx
        ON heartbeat_runs (status)
        WHERE status IN ('queued', 'running')
      `,
    },
    {
      name: "issue_comments_body_search_idx_rebuild",
      sqlText: `
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname = 'issue_comments_body_search_idx'
          ) AND NOT EXISTS (
            SELECT 1
            FROM pg_index i
            JOIN pg_class c ON c.oid = i.indexrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname = 'issue_comments_body_search_idx'
              AND i.indpred IS NOT NULL
          ) THEN
            DROP INDEX public.issue_comments_body_search_idx;
            CREATE INDEX issue_comments_body_search_idx
              ON issue_comments
              USING gin (body gin_trgm_ops)
              WHERE length(body) <= 16384;
          END IF;
        END $$
      `,
    },
  ];

  for (const statement of statements) {
    try {
      await db.execute(sql.raw(statement.sqlText));
      logger.info({ statement: statement.name }, "Maintenance index applied");
    } catch (err) {
      logger.warn(
        { err, statement: statement.name },
        "Maintenance index step failed (non-fatal)",
      );
    }
  }
}
