//// Neocompany Modification — Playwright globalSetup
//// Signs in once with admin credentials (same source as bash helper:
//// ~/.config/paperclip-admin.env or PAPERCLIP_ADMIN_EMAIL/PASSWORD env)
//// and saves the storage state to tests/e2e/neocompany/.auth/admin.json.
//// Every spec then runs against this cached session — no per-test login.
////
//// Also: validates that the three required test companies exist, and
//// provisions them on-the-fly if missing. So the first run after a clean
//// deployment self-bootstraps.
//// End Neocompany Modification

import { request } from "@playwright/test";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, ".auth", "admin.json");
// Names chosen so deriveIssuePrefixBase yields distinct 3-letter prefixes
// (EET / SMO / MAN). See scripts/provision-all-test-companies.sh for the why.
const REQUIRED_COMPANIES = ["__E2E_TEST__", "__SMOKE_TEST__", "__MANUAL_TEST__"];

function loadCredentials(): { email: string; password: string } {
  if (process.env.PAPERCLIP_ADMIN_EMAIL && process.env.PAPERCLIP_ADMIN_PASSWORD) {
    return {
      email: process.env.PAPERCLIP_ADMIN_EMAIL,
      password: process.env.PAPERCLIP_ADMIN_PASSWORD,
    };
  }
  const credFile =
    process.env.PAPERCLIP_ADMIN_ENV_FILE ??
    join(homedir(), ".config", "paperclip-admin.env");
  if (!existsSync(credFile)) {
    throw new Error(
      `Admin credentials not found.\n` +
        `  Either set PAPERCLIP_ADMIN_EMAIL and PAPERCLIP_ADMIN_PASSWORD env vars,\n` +
        `  or create ${credFile} (chmod 600).`,
    );
  }
  const content = readFileSync(credFile, "utf-8");
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  if (!env.PAPERCLIP_ADMIN_EMAIL || !env.PAPERCLIP_ADMIN_PASSWORD) {
    throw new Error(
      `${credFile} is missing PAPERCLIP_ADMIN_EMAIL or PAPERCLIP_ADMIN_PASSWORD`,
    );
  }
  return { email: env.PAPERCLIP_ADMIN_EMAIL, password: env.PAPERCLIP_ADMIN_PASSWORD };
}

export default async function globalSetup() {
  const baseURL = process.env.PAPERCLIP_BASE_URL ?? "https://app.neocompany.ch";
  const { email, password } = loadCredentials();

  console.log(`[globalSetup] Signing in as ${email} at ${baseURL}`);

  const ctx = await request.newContext({ baseURL });
  const signIn = await ctx.post("/api/auth/sign-in/email", {
    data: { email, password },
  });
  if (!signIn.ok()) {
    throw new Error(
      `[globalSetup] Sign-in failed: ${signIn.status()} ${await signIn.text()}`,
    );
  }

  // Sanity: confirm we're authenticated and that the user is an instance admin.
  const session = await ctx.get("/api/auth/get-session");
  const sessionBody = await session.json();
  if (!sessionBody?.user) {
    throw new Error(`[globalSetup] /api/auth/get-session did not return a user. Body: ${JSON.stringify(sessionBody)}`);
  }
  console.log(`[globalSetup] Signed in as user id=${sessionBody.user.id}`);

  // Ensure the 3 test companies exist. Idempotent.
  const companiesResp = await ctx.get("/api/companies?includeTest=true");
  if (!companiesResp.ok()) {
    throw new Error(
      `[globalSetup] /api/companies?includeTest=true failed: ${companiesResp.status()}. Caller must be instance_admin.`,
    );
  }
  const companies = (await companiesResp.json()) as Array<{ name: string; isTest?: boolean }>;
  const existingNames = new Set(companies.map((c) => c.name));

  for (const name of REQUIRED_COMPANIES) {
    if (existingNames.has(name)) {
      console.log(`[globalSetup] ✓ ${name} exists`);
      continue;
    }
    console.log(`[globalSetup] Creating ${name}...`);
    const create = await ctx.post("/api/companies", {
      data: {
        name,
        description: `Provisioned by Playwright globalSetup — do not delete.`,
        isTest: true,
      },
    });
    if (!create.ok()) {
      throw new Error(
        `[globalSetup] Failed to create ${name}: ${create.status()} ${await create.text()}`,
      );
    }
    console.log(`[globalSetup] ✓ Created ${name}`);
  }

  // Save storage state.
  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  await ctx.storageState({ path: AUTH_FILE });
  await ctx.dispose();
  console.log(`[globalSetup] Storage state saved to ${AUTH_FILE}`);
}
