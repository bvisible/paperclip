//// Neoffice Modification: osiris-activity-log-retention
//// Why: New service ONLY in the Neoffice fork. activity_log on Osiris
////      reached 1 GB / 837 rows (1.2 MB/row) because the `details` JSONB
////      embeds full referenced-issue lists per comment. Plugin-log
////      retention service exists upstream but was never paired with an
////      activity_log equivalent. TTL 30d (env PAPERCLIP_ACTIVITY_LOG_
////      RETENTION_DAYS), batch 10k rows, sweep every 6h. Upstream has
////      no equivalent — small instance optimisation. Bounded growth
////      lets Osiris-class tenants survive months without manual cleanup.
//// Date: 2026-05-07
//// Refs: NORA #27 — Osiris RAM/swap saturation rootcause (commit 2323fde7)
//// (Entire file is NeoCompany-only; closing marker at EOF.)
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const DELETE_BATCH_SIZE = 10_000;
const MAX_ITERATIONS = 200;

/**
 * Delete activity_log rows older than `retentionDays`.
 *
 * Without this sweep the table grows indefinitely. On Osiris we observed
 * 1 GB / 1.1M rows because the `details` JSONB column embeds full
 * referenced-issue lists per comment, and a runaway emitter can dump
 * hundreds of thousands of events per day.
 *
 * Uses a true batched DELETE (`DELETE ... WHERE id IN (SELECT ... LIMIT n)`)
 * to avoid (a) acquiring row locks on the entire deletion set in one go and
 * (b) loading the deleted IDs into the Node process heap. The previous
 * implementation used `.returning()` without an explicit LIMIT, which
 * resulted in a single un-bounded statement that pinned millions of rows
 * in RAM and starved the rest of the process.
 */
export async function pruneActivityLogs(
  db: Db,
  retentionDays: number = DEFAULT_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  let totalDeleted = 0;
  let iterations = 0;

  // Cutoff is encoded as ISO string + cast to timestamptz because the
  // postgres.js driver (used by drizzle here) does not auto-bind Date
  // values inside raw `sql` template literals.
  const cutoffIso = cutoff.toISOString();

  while (iterations < MAX_ITERATIONS) {
    // Postgres-native batched delete; avoids RETURNING entirely.
    const result = await db.execute(sql`
      DELETE FROM activity_log
      WHERE id IN (
        SELECT id FROM activity_log
        WHERE created_at < ${cutoffIso}::timestamptz
        LIMIT ${DELETE_BATCH_SIZE}
      )
    `);

    // pg client returns either { rowCount } (node-postgres) or { count } depending on driver.
    const deleted = (result as { rowCount?: number; count?: number }).rowCount
      ?? (result as { rowCount?: number; count?: number }).count
      ?? 0;

    totalDeleted += deleted;
    iterations++;

    if (deleted < DELETE_BATCH_SIZE) break;
  }

  if (iterations >= MAX_ITERATIONS) {
    logger.warn(
      { totalDeleted, iterations, cutoffDate: cutoff },
      "Activity log retention hit iteration limit; some rows may remain",
    );
  }

  if (totalDeleted > 0) {
    logger.info({ totalDeleted, retentionDays }, "Pruned expired activity_log rows");
  }

  return totalDeleted;
}

function readRetentionDays(): number {
  const raw = process.env.PAPERCLIP_ACTIVITY_LOG_RETENTION_DAYS;
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RETENTION_DAYS;
  return parsed;
}

function readIntervalMs(): number {
  const raw = process.env.PAPERCLIP_ACTIVITY_LOG_RETENTION_INTERVAL_MS;
  if (!raw) return DEFAULT_INTERVAL_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INTERVAL_MS;
  return parsed;
}

/**
 * Start the periodic activity_log retention sweep.
 *
 * Configurable via env:
 *  - PAPERCLIP_ACTIVITY_LOG_RETENTION_DAYS (default 30)
 *  - PAPERCLIP_ACTIVITY_LOG_RETENTION_INTERVAL_MS (default 6 hours)
 *
 * Returns a cleanup function that stops the interval.
 */
export function startActivityLogRetention(db: Db): () => void {
  const retentionDays = readRetentionDays();
  const intervalMs = readIntervalMs();

  const timer = setInterval(() => {
    pruneActivityLogs(db, retentionDays).catch((err) => {
      logger.warn({ err }, "Activity log retention sweep failed");
    });
  }, intervalMs);

  pruneActivityLogs(db, retentionDays).catch((err) => {
    logger.warn({ err }, "Initial activity log retention sweep failed");
  });

  logger.info(
    { retentionDays, intervalMs },
    "Activity log retention service started",
  );

  return () => clearInterval(timer);
}
//// End Neoffice Modification: osiris-activity-log-retention
