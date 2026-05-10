//// Neocompany Modification — pure addition (Neocompany fork on top of paperclipai/paperclip)
//// This file does not exist upstream. Safe across upstream merges.

/**
 * OpenClaw isolated-agent provisioning — per-agent workspace isolation.
 *
 * NeoCompany's multi-tenant model requires each seed agent to have its own
 * OpenClaw workspace + agent-dir + paperclip-claimed-api-key.json so memory
 * does NOT leak between companies (or between agents within a company).
 *
 * Design is documented in Obsidian under
 * `Neocompany/architecture/multi-tenant-isolation.md` (option A).
 *
 * This module wraps two shell actions and one filesystem write:
 *   1. `openclaw agents add <companyId>-<role>` — creates the OpenClaw isolated
 *      agent (workspace + agent-dir + entry in ~/.openclaw/openclaw.json).
 *   2. Writes `<workspace>/paperclip-claimed-api-key.json` with the Paperclip
 *      API key pre-claimed for that agent.
 *   3. `systemctl --user restart openclaw-gateway` — picks up the new agent in
 *      the gateway's loaded config. Called once after all seeds are done.
 *
 * Controlled by env var `PAPERCLIP_OPENCLAW_ISOLATED=1`. When unset, this
 * module is a no-op and the seed flow falls back to the legacy shared
 * workspace (single identity for all agents, which is NOT safe for prod SaaS
 * but is OK for local dev / smoke tests).
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface OpenClawIsolatedConfig {
  /** Path to the openclaw CLI. */
  openclawBin: string;
  /** Root under which per-agent workspaces live. */
  workspaceRoot: string;
  /** Root under which per-agent agent-dirs live. */
  agentDirRoot: string;
  /** Paperclip API base URL the claimed key should point at. */
  paperclipApiUrl: string;
  /** Systemd user unit name for the gateway. */
  gatewaySystemdUnit: string;
}

export function defaultIsolatedConfig(): OpenClawIsolatedConfig {
  return {
    openclawBin: process.env.OPENCLAW_BIN ?? "/usr/local/bin/openclaw",
    workspaceRoot: process.env.OPENCLAW_ISOLATED_WORKSPACE_ROOT
      ?? "/home/ubuntu/.openclaw/workspaces",
    agentDirRoot: process.env.OPENCLAW_ISOLATED_AGENT_DIR_ROOT
      ?? "/home/ubuntu/.openclaw/agents",
    paperclipApiUrl: process.env.PAPERCLIP_API_URL ?? "http://127.0.0.1:3100",
    gatewaySystemdUnit: process.env.OPENCLAW_GATEWAY_SYSTEMD_UNIT
      ?? "openclaw-gateway",
  };
}

export interface ProvisionInput {
  companyId: string;
  role: string;
  agentName: string;
  paperclipAgentId: string;
  paperclipApiKey: string;
}

export interface ProvisionResult {
  openclawAgentId: string;
  workspacePath: string;
  agentDirPath: string;
  claimedApiKeyPath: string;
}

/**
 * Create the isolated OpenClaw agent for a Paperclip seed agent and write its
 * claimed-API-key file. Idempotent on "already exists" (skips the add, still
 * writes the claimed key).
 *
 * Returns the paths we need to store in adapterConfig (agentId +
 * claimedApiKeyPath) so the adapter routes to this workspace.
 */
export async function provisionIsolatedAgent(
  input: ProvisionInput,
  cfg: OpenClawIsolatedConfig = defaultIsolatedConfig(),
): Promise<ProvisionResult> {
  const openclawAgentId = `${input.companyId}-${input.role}`;
  const workspacePath = `${cfg.workspaceRoot}/${openclawAgentId}`;
  const agentDirPath = `${cfg.agentDirRoot}/${openclawAgentId}/agent`;
  const claimedApiKeyPath = `${workspacePath}/paperclip-claimed-api-key.json`;

  // Step 1 — create the isolated agent (idempotent)
  await addIsolatedAgent(cfg.openclawBin, openclawAgentId, workspacePath, agentDirPath);

  // Step 2 — write claimed API key JSON into the isolated workspace
  const claimed = {
    apiUrl: cfg.paperclipApiUrl,
    apiKey: input.paperclipApiKey,
    agentId: input.paperclipAgentId,
    companyId: input.companyId,
    agentName: input.agentName,
  };
  await mkdir(dirname(claimedApiKeyPath), { recursive: true });
  await writeFile(claimedApiKeyPath, JSON.stringify(claimed, null, 2) + "\n", "utf8");

  return { openclawAgentId, workspacePath, agentDirPath, claimedApiKeyPath };
}

async function addIsolatedAgent(
  bin: string,
  agentId: string,
  workspace: string,
  agentDir: string,
): Promise<void> {
  try {
    await execFileAsync(bin, [
      "agents",
      "add",
      agentId,
      "--workspace",
      workspace,
      "--agent-dir",
      agentDir,
      "--non-interactive",
    ], { timeout: 30_000 });
  } catch (err) {
    // openclaw CLI returns nonzero if the agent already exists — we treat that
    // as success so the provision flow is idempotent.
    const message = err instanceof Error ? err.message : String(err);
    if (/already exists/i.test(message)) return;
    throw new Error(`openclaw agents add failed for ${agentId}: ${message}`);
  }
}

/**
 * Restart the OpenClaw gateway via systemctl (user mode) so it reloads
 * ~/.openclaw/openclaw.json and sees the newly added isolated agents.
 *
 * Called once after a batch of provisions. Failures do not throw — they are
 * returned so the caller can log and continue; the gateway will still pick
 * up the new agents on next natural restart.
 */
export async function restartOpenClawGateway(
  cfg: OpenClawIsolatedConfig = defaultIsolatedConfig(),
): Promise<{ ok: boolean; message?: string }> {
  try {
    await execFileAsync("systemctl", ["--user", "restart", cfg.gatewaySystemdUnit], {
      timeout: 15_000,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export function isIsolationEnabled(): boolean {
  const raw = process.env.PAPERCLIP_OPENCLAW_ISOLATED;
  return raw === "1" || raw === "true";
}
