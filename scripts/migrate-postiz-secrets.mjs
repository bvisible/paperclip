#!/usr/bin/env node
/**
 * migrate-postiz-secrets — one-shot helper that reads platform-level
 * credentials from the legacy Postiz server and imports them into the
 * Paperclip `neocompany-tools` plugin.
 *
 * Usage:
 *   node scripts/migrate-postiz-secrets.mjs --dry-run
 *   node scripts/migrate-postiz-secrets.mjs --apply
 *
 * What it does:
 *   1. SSH into `com.neoservice.ai` (using ~/.ssh/id_neoservice), reads
 *      `/home/ubuntu/postiz/.env`, and picks a known subset of keys.
 *   2. Prints a masked summary of what it found.
 *   3. On `--apply`: creates one Paperclip secret per sensitive value
 *      under the primary company (board API key), then PUTs the
 *      resolved secret refs into the plugin platform config via
 *      `PUT /api/plugins/neocompany-tools/bridge/platform`.
 *   4. Writes a JSON report next to the script so we can audit.
 *
 * Secrets never hit local disk in plain text: they live in the SSH
 * command output and in HTTP bodies sent over loopback/HTTPS only.
 *
 * Config constants below are intentionally hard-coded so the script
 * stays self-contained and doesn't need a config file. Adjust for
 * other environments if needed.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const POSTIZ_SSH_HOST = "com.neoservice.ai";
const POSTIZ_SSH_USER = "ubuntu";
const POSTIZ_SSH_KEY = process.env.NEO_SSH_KEY ?? `${process.env.HOME}/.ssh/id_neoservice`;
const POSTIZ_ENV_PATH = "/home/ubuntu/postiz/.env";

const PAPERCLIP_API_BASE = process.env.PAPERCLIP_API_BASE ?? "https://app.neocompany.ch";
const PAPERCLIP_BOARD_KEY = process.env.PAPERCLIP_BOARD_KEY ?? "pcp_board_91d6fbff84e12962bb2c3afbce51a13dddabf7a032f86adc";
const PAPERCLIP_HOME_COMPANY_ID = process.env.PAPERCLIP_HOME_COMPANY_ID ?? "2852b040-1d6f-46e7-a1c1-cf02ae77d2ba"; // Neoservice
// Valid providers in Paperclip: local_encrypted | aws_secrets_manager |
// gcp_secret_manager | vault. We use local_encrypted since we're just
// importing opaque strings into the default encrypted store.
const SECRETS_PROVIDER = "local_encrypted";

// Mapping: Postiz env var → { target field in platform config, is secret }
const MIGRATION_MAP = [
  { env: "GOOGLE_CLIENT_ID",     platform: "googleClientId",         secret: false },
  { env: "GOOGLE_CLIENT_SECRET", platform: "googleClientSecretRef",  secret: true, secretName: "neocompany.platform.googleClientSecret" },
  { env: "GOOGLE_PSI_API_KEY",   platform: "googlePsiApiKeyRef",     secret: true, secretName: "neocompany.platform.googlePsiKey" },
  // GOOGLE_REFRESH_TOKEN — not in Postiz .env (OAuth dynamic). Handled manually.
  // RESEND_API_KEY / OPEN_PAGERANK_API_KEY — not present in Postiz .env.
];

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const APPLY = args.includes("--apply");

if (!DRY_RUN && !APPLY) {
  console.error("Usage: node scripts/migrate-postiz-secrets.mjs --dry-run | --apply");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mask(value) {
  if (!value) return "(empty)";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

function fetchPostizEnv() {
  console.log(`→ SSH ${POSTIZ_SSH_USER}@${POSTIZ_SSH_HOST} cat ${POSTIZ_ENV_PATH}`);
  const raw = execFileSync(
    "ssh",
    ["-i", POSTIZ_SSH_KEY, "-o", "StrictHostKeyChecking=accept-new", `${POSTIZ_SSH_USER}@${POSTIZ_SSH_HOST}`, `cat ${POSTIZ_ENV_PATH}`],
    { encoding: "utf8" },
  );
  const parsed = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip matching surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

async function httpJson(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${PAPERCLIP_BOARD_KEY}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${url} failed with ${res.status}: ${typeof json === "string" ? json : JSON.stringify(json)}`);
  }
  return json;
}

async function createSecret(name, value, description) {
  const url = `${PAPERCLIP_API_BASE}/api/companies/${PAPERCLIP_HOME_COMPANY_ID}/secrets`;
  try {
    return await httpJson("POST", url, {
      name,
      provider: SECRETS_PROVIDER,
      value,
      description,
    });
  } catch (err) {
    // If the secret already exists (409), look it up by name in the list
    // endpoint and return the existing row so the caller can reuse the id.
    if (err instanceof Error && /\b409\b/.test(err.message)) {
      console.log(`    (secret ${name} already exists — reusing)`);
      const listUrl = `${PAPERCLIP_API_BASE}/api/companies/${PAPERCLIP_HOME_COMPANY_ID}/secrets`;
      const existing = await httpJson("GET", listUrl);
      const list = Array.isArray(existing) ? existing : existing?.secrets ?? [];
      const match = list.find((s) => s.name === name);
      if (match) return match;
    }
    throw err;
  }
}

async function updatePlatformConfig(patch) {
  const url = `${PAPERCLIP_API_BASE}/api/plugins/neocompany-tools/bridge/platform`;
  return httpJson("PUT", url, patch);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const env = fetchPostizEnv();
  const found = MIGRATION_MAP.filter((m) => env[m.env] && env[m.env].length > 0);
  const missing = MIGRATION_MAP.filter((m) => !env[m.env] || env[m.env].length === 0);

  console.log("\n=== Discovery ===");
  for (const m of found) {
    console.log(`  ✓ ${m.env.padEnd(22)} → ${m.platform.padEnd(26)} ${mask(env[m.env])}`);
  }
  for (const m of missing) {
    console.log(`  ✗ ${m.env.padEnd(22)} not found in Postiz .env`);
  }

  if (DRY_RUN) {
    console.log("\n(dry-run — no changes written)");
    return;
  }

  console.log("\n=== Apply ===");
  const patch = {};
  const report = {
    timestamp: new Date().toISOString(),
    apiBase: PAPERCLIP_API_BASE,
    found: [],
    missing: missing.map((m) => m.env),
    errors: [],
  };

  for (const m of found) {
    const value = env[m.env];
    try {
      if (m.secret) {
        console.log(`  → Creating Paperclip secret ${m.secretName} (${mask(value)})`);
        const created = await createSecret(m.secretName, value, `Migrated from Postiz ${m.env}`);
        patch[m.platform] = created.id;
        report.found.push({ env: m.env, platform: m.platform, secretId: created.id });
      } else {
        console.log(`  → Inlining ${m.platform} = ${mask(value)}`);
        patch[m.platform] = value;
        report.found.push({ env: m.env, platform: m.platform, valueLen: value.length });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    ERROR: ${msg}`);
      report.errors.push({ env: m.env, error: msg });
    }
  }

  if (Object.keys(patch).length > 0) {
    console.log(`\n  → PUT /bridge/platform ${JSON.stringify(Object.keys(patch))}`);
    try {
      await updatePlatformConfig(patch);
      console.log("    ok");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    ERROR: ${msg}`);
      report.errors.push({ stage: "PUT /bridge/platform", error: msg });
    }
  }

  // Write report next to the script
  const here = path.dirname(fileURLToPath(import.meta.url));
  const reportPath = path.join(here, "migration-postiz-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to ${reportPath}`);

  console.log("\n=== Post-migration notes ===");
  console.log("  • Google refresh token is NOT imported (Postiz uses dynamic OAuth flow).");
  console.log("    You must generate one manually via the Google Cloud console or an");
  console.log("    OAuth helper and set it through the Platform settings section in the UI.");
  console.log("  • RESEND_API_KEY + OPEN_PAGERANK_API_KEY were not present in the Postiz .env.");
  console.log("    Configure them manually in Platform settings if needed.");
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
