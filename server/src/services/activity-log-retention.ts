import { lt } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { activityLog } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const DELETE_BATCH_SIZE = 10_000;
const MAX_ITERATIONS = 200;

/**
 * Delete activity_log rows older than `retentionDays`.
 *
 * Without this sweep the table grows indefinitely. On Osiris we observed
 * 1 GB / 837 rows because the `details` JSONB column embeds full
 * referenced-issue lists per comment.
 */
export async function pruneActivityLogs(
  db: Db,
  retentionDays: number = DEFAULT_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  let totalDeleted = 0;
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    const deleted = await db
      .delete(activityLog)
      .where(lt(activityLog.createdAt, cutoff))
      .returning({ id: activityLog.id })
      .then((rows) => rows.length);

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
