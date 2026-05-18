//// Neocompany Modification — pure addition (Neocompany fork on top of paperclipai/paperclip)
//// This file does not exist upstream. Safe across upstream merges.

/**
 * Hermes isolated-agent memory roots — per (company, user, agent) `HERMES_HOME`.
 *
 * NeoCompany's multi-tenant model requires each Hermes agent run to write its
 * persistent memory (`MEMORY.md`, `USER.md`, session DB) into a directory that
 * is isolated by company AND by the human user driving the run — so two
 * clients never share memory, and two users inside the same client don't
 * either.
 *
 * The `hermes_local` adapter (hermes-paperclip-adapter) stores memory under
 * `~/.hermes/` by default — a single global path. It honours the `HERMES_HOME`
 * env var, but never sets it itself. This module computes the per-run
 * `HERMES_HOME` value; the registry wrapper for `hermes_local` injects it into
 * `adapterConfig.env` at execute time (see server/src/adapters/registry.ts).
 *
 * Resolution:
 *   HERMES_HOME = <root>/{companyId}/{userId}/{agentId}
 *
 * `userId` comes from `ctx.context.actorUserId`, which the chat path already
 * propagates into `run.contextSnapshot` (plugin-host-services.ts patch #2).
 * Runs with no human actor (scheduled heartbeats, task assignments) fall back
 * to the `_system` bucket so they still get a stable, isolated-per-company
 * home rather than leaking into a user's directory.
 *
 * Controlled by env var `PAPERCLIP_HERMES_ISOLATED=1`. When unset, this module
 * returns `null` and the adapter falls back to the shared `~/.hermes` — fine
 * for local dev / smoke tests, NOT safe for prod multi-tenant.
 */

import { copyFile, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Bucket used when a run has no human actor (scheduled / task-driven runs). */
export const HERMES_SYSTEM_USER_BUCKET = "_system";

/** Root under which all per-agent Hermes homes live. */
export function hermesHomeRoot(): string {
  return process.env.PAPERCLIP_HERMES_HOME_ROOT ?? "/var/lib/paperclip/hermes";
}

/** True when per-(company,user,agent) isolation is enabled for this deployment. */
export function hermesIsolationEnabled(): boolean {
  return process.env.PAPERCLIP_HERMES_ISOLATED === "1";
}

/**
 * Sanitize a path segment so a malformed id can never escape the root.
 * Company / user / agent ids are normally UUIDs, but we never trust them
 * blindly — anything outside `[A-Za-z0-9_-]` is replaced, and empty or
 * traversal-only values are rejected.
 */
function safeSegment(value: string, label: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "_");
  if (cleaned.length === 0 || /^_+$/.test(cleaned)) {
    throw new Error(`hermes-isolated-agents: invalid ${label} segment "${value}"`);
  }
  return cleaned;
}

/**
 * Compute the `HERMES_HOME` path for a (company, user, agent) triple.
 *
 * Returns `null` when isolation is disabled — the caller should then leave
 * `HERMES_HOME` unset so Hermes uses its default `~/.hermes`.
 *
 * `userId` may be null/undefined for non-chat runs; it resolves to the
 * `_system` bucket in that case.
 */
export function resolveHermesHome(
  companyId: string,
  userId: string | null | undefined,
  agentId: string,
): string | null {
  if (!hermesIsolationEnabled()) return null;
  const company = safeSegment(companyId, "companyId");
  const user =
    userId && userId.trim().length > 0
      ? safeSegment(userId, "userId")
      : HERMES_SYSTEM_USER_BUCKET;
  const agent = safeSegment(agentId, "agentId");
  return join(hermesHomeRoot(), company, user, agent);
}

/**
 * Files that each isolated HERMES_HOME must inherit from the default
 * `~/.hermes/` install. Hermes' `setup` writes both — `auth.json` carries
 * the Codex OAuth refresh token, `config.yaml` selects provider + model.
 * Without them every fresh per-(company,user,agent) bucket falls into
 * "Hermes isn't configured yet" and chat runs end silently.
 *
 * The default install path is `~/.hermes/` and is the only authoritative
 * source — we never re-auth from inside an isolated home.
 */
const HERMES_DEFAULT_HOME_FILES = ["auth.json", "config.yaml"] as const;

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function seedHermesHomeCredentials(home: string): Promise<void> {
  const defaultHome = process.env.HERMES_DEFAULT_HOME?.trim() || join(homedir(), ".hermes");
  for (const filename of HERMES_DEFAULT_HOME_FILES) {
    const target = join(home, filename);
    if (await fileExists(target)) continue;
    const source = join(defaultHome, filename);
    if (!(await fileExists(source))) continue;
    await copyFile(source, target);
  }
}

/**
 * Ensure the `HERMES_HOME` directory (and its `memories/` subdir) exists.
 * No-op + returns `null` when isolation is disabled. Returns the resolved
 * path on success so the caller can inject it into the adapter env.
 *
 * Also seeds `auth.json` + `config.yaml` from the default `~/.hermes/`
 * install when they are missing (idempotent). The Hermes CLI uses these
 * to talk to its provider — a fresh per-(company,user,agent) bucket has
 * neither, so without this step every chat run aborts with "Hermes isn't
 * configured yet".
 */
export async function ensureHermesHome(
  companyId: string,
  userId: string | null | undefined,
  agentId: string,
): Promise<string | null> {
  const home = resolveHermesHome(companyId, userId, agentId);
  if (!home) return null;
  await mkdir(join(home, "memories"), { recursive: true });
  await seedHermesHomeCredentials(home);
  return home;
}
