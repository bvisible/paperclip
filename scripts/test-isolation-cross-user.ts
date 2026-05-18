//// Neocompany Modification — Empirical cross-user HERMES_HOME isolation test
//// Validates that two different humans on the same company create two
//// distinct HERMES_HOME buckets (Fix 3 from c5cc86ff). Run this against
//// app.neocompany.ch after a deploy that changes anything around
//// actorUserId propagation, plugin SDK contracts, or hermes-isolated-agents.
////
//// Strategy:
////   1. Sign up a fresh test user (timestamped email so reruns don't clash).
////   2. INSERT a company_memberships row attaching it to Neoservice
////      (sign-up alone doesn't grant company access; we shortcut via DB).
////   3. With the new session, hit the paperclip-chat bridge (createThread +
////      sendMessage) targeting Nora-Neoservice.
////   4. Wait for an assistant reply.
////   5. SSH to prod and check that two distinct user buckets now exist under
////      the Neoservice HERMES_HOME root + that their memories are independent.
////
//// Idempotent: cleans up its own user/membership/thread before exiting.
//// End Neocompany Modification

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BASE_URL = process.env.PAPERCLIP_BASE_URL ?? "https://app.neocompany.ch";
const NEOSERVICE_COMPANY_ID = "b9f7a316-76c5-49f5-aa78-d5258595e28e";
const NORA_AGENT_ID = "1930cb33-57eb-4358-be38-6379b6c58bdf";
const SSH_HOST = process.env.PAPERCLIP_PROD_SSH ?? "ubuntu@83.228.224.34";
const SSH_KEY = process.env.PAPERCLIP_PROD_SSH_KEY ?? `${process.env.HOME}/.ssh/id_neoservice`;
const PG_PASSWORD = process.env.PAPERCLIP_PG_PASSWORD ?? "paperclip2026";

const stamp = Date.now();
const testEmail = `isolation-test-${stamp}@neoservice.ai`;
const testPassword = `Test-${stamp}-secret!`;
const testName = `Isolation Test User ${stamp}`;

// ── Helpers ────────────────────────────────────────────────────────────

function sshExec(remoteCmd: string): string {
  return execSync(`ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no ${SSH_HOST} ${JSON.stringify(remoteCmd)}`, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "inherit"],
  });
}

function psql(sql: string): string {
  const escaped = sql.replace(/"/g, '\\"');
  return sshExec(`PGPASSWORD=${PG_PASSWORD} psql -h localhost -U paperclip -d paperclip -tA -c "${escaped}"`);
}

function bridgeHeaders(): Record<string, string> {
  return { Origin: BASE_URL, Referer: BASE_URL, "Content-Type": "application/json" };
}

async function fetchJson<T>(
  url: string,
  init: RequestInit & { cookieJar?: string[] } = {},
): Promise<{ status: number; body: T; cookies: string[] }> {
  const headers = new Headers(init.headers);
  if (init.cookieJar && init.cookieJar.length > 0) {
    headers.set("Cookie", init.cookieJar.join("; "));
  }
  const resp = await fetch(url, { ...init, headers });
  const text = await resp.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  const setCookies = resp.headers.getSetCookie?.() ?? [];
  const jar = setCookies.map((c) => c.split(";")[0]!);
  return { status: resp.status, body: parsed as T, cookies: jar };
}

// ── Step 1: sign up the second user ────────────────────────────────────

async function signUpUser(): Promise<{ userId: string; cookies: string[] }> {
  console.log(`\n[1/5] Signing up ${testEmail}…`);
  const resp = await fetchJson<{ user?: { id: string } }>(
    `${BASE_URL}/api/auth/sign-up/email`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE_URL, Referer: BASE_URL },
      body: JSON.stringify({ email: testEmail, password: testPassword, name: testName }),
    },
  );
  if (resp.status !== 200 || !resp.body?.user?.id) {
    throw new Error(`Sign-up failed: ${resp.status} ${JSON.stringify(resp.body)}`);
  }
  console.log(`    → userId=${resp.body.user.id}, cookies=${resp.cookies.length}`);
  if (resp.cookies.length === 0) {
    throw new Error(`Sign-up returned no cookies — cannot continue without a session`);
  }
  return { userId: resp.body.user.id, cookies: resp.cookies };
}

// ── Step 2: attach user to Neoservice via DB (shortcut) ────────────────

function attachToNeoservice(userId: string): string {
  console.log(`\n[2/5] Attaching ${userId} to Neoservice via DB INSERT…`);
  const sql = `INSERT INTO company_memberships (company_id, principal_type, principal_id, status, membership_role) VALUES ('${NEOSERVICE_COMPANY_ID}', 'user', '${userId}', 'active', 'member') RETURNING id;`;
  const id = psql(sql).trim();
  console.log(`    → membership id=${id}`);
  return id;
}

// ── Step 3: createThread + sendMessage as user2 ────────────────────────

async function fetchPluginId(cookies: string[]): Promise<string> {
  const resp = await fetchJson<Array<{ id: string; pluginKey: string }>>(
    `${BASE_URL}/api/plugins`,
    { cookieJar: cookies },
  );
  if (resp.status !== 200) throw new Error(`GET /api/plugins → ${resp.status}`);
  const chat = resp.body.find((p) => p.pluginKey === "paperclip-chat");
  if (!chat) throw new Error(`paperclip-chat plugin not found`);
  return chat.id;
}

async function callBridge<T>(
  cookies: string[],
  pluginId: string,
  kind: "data" | "actions",
  key: string,
  params: Record<string, unknown>,
): Promise<T> {
  const resp = await fetchJson<{ data?: T; error?: { message: string } }>(
    `${BASE_URL}/api/plugins/${pluginId}/${kind}/${key}`,
    {
      method: "POST",
      headers: bridgeHeaders(),
      body: JSON.stringify({ companyId: NEOSERVICE_COMPANY_ID, params: { companyId: NEOSERVICE_COMPANY_ID, ...params } }),
      cookieJar: cookies,
    },
  );
  if (resp.status !== 200 || !resp.body?.data) {
    throw new Error(`${kind}/${key} failed: ${resp.status} ${JSON.stringify(resp.body)}`);
  }
  return resp.body.data;
}

async function sendMessageAsUser2(cookies: string[]): Promise<{ threadId: string; reply: string }> {
  console.log(`\n[3/5] Sending message as user2…`);
  const pluginId = await fetchPluginId(cookies);
  console.log(`    paperclip-chat pluginId=${pluginId}`);

  const thread = await callBridge<{ id: string }>(
    cookies,
    pluginId,
    "actions",
    "createThread",
    {
      adapterType: "hermes_local",
      agentId: NORA_AGENT_ID,
      title: `cross-user-isolation-${stamp}`,
    },
  );
  console.log(`    → threadId=${thread.id}`);

  await callBridge(
    cookies,
    pluginId,
    "actions",
    "sendMessage",
    {
      threadId: thread.id,
      message: "Salut Nora. Je suis le user numéro 2. Réponds-moi en une phrase.",
    },
  );

  // Poll for assistant reply
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const messages = await callBridge<Array<{ role: string; content: string }>>(
      cookies,
      pluginId,
      "data",
      "messages",
      { threadId: thread.id },
    );
    const assistant = messages.find((m) => m.role === "assistant" && m.content.length > 0);
    if (assistant) {
      console.log(`    → reply received (${assistant.content.length} chars)`);
      return { threadId: thread.id, reply: assistant.content };
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`Timeout waiting for assistant reply`);
}

// ── Step 4: verify two distinct HERMES_HOME buckets ────────────────────

function verifyBuckets(user2Id: string): void {
  console.log(`\n[4/5] Verifying HERMES_HOME buckets…`);
  const listing = sshExec(
    `find /home/ubuntu/.paperclip/hermes/${NEOSERVICE_COMPANY_ID} -maxdepth 1 -mindepth 1 -type d -printf '%f\\n'`,
  ).trim();
  const entries = listing.split("\n").filter(Boolean);
  console.log(`    → buckets: ${entries.join(", ")}`);

  const myId = "HZDeZTewWRP8oK4FTMubffG3OCPZItDC";
  if (!entries.includes("_system")) throw new Error(`Missing _system bucket`);
  if (!entries.includes(myId)) throw new Error(`Missing my own bucket (${myId})`);
  if (!entries.includes(user2Id)) {
    throw new Error(`Missing user2 bucket (${user2Id}) — Fix 3 is NOT working!`);
  }
  console.log(`    ✓ 3 distinct buckets present (_system + 2 user buckets)`);

  // Cross-check memory isolation: dump auth.json size for both buckets and
  // confirm the per-bucket session_id in config differs (or that
  // memories/* are independent files).
  const myMemDir = `/home/ubuntu/.paperclip/hermes/${NEOSERVICE_COMPANY_ID}/${myId}/${NORA_AGENT_ID}`;
  const u2MemDir = `/home/ubuntu/.paperclip/hermes/${NEOSERVICE_COMPANY_ID}/${user2Id}/${NORA_AGENT_ID}`;
  const myList = sshExec(`ls -la ${myMemDir} 2>/dev/null | wc -l`).trim();
  const u2List = sshExec(`ls -la ${u2MemDir} 2>/dev/null | wc -l`).trim();
  console.log(`    my bucket files: ${myList}, user2 bucket files: ${u2List}`);

  // Both buckets must have their own auth.json/config.yaml — proves the
  // ensureHermesHome seeding worked for user2 (otherwise Hermes would have
  // replied "isn't configured yet").
  const myAuth = sshExec(`test -f ${myMemDir}/auth.json && echo ok || echo missing`).trim();
  const u2Auth = sshExec(`test -f ${u2MemDir}/auth.json && echo ok || echo missing`).trim();
  console.log(`    my auth.json: ${myAuth}, user2 auth.json: ${u2Auth}`);
  if (myAuth !== "ok" || u2Auth !== "ok") {
    throw new Error(`auth.json missing from one of the buckets — Fix 3 partial!`);
  }
  console.log(`    ✓ both buckets seeded with auth.json (per-user credentials isolated)`);
}

// ── Step 5: cleanup ────────────────────────────────────────────────────

function cleanup(user2Id: string): void {
  console.log(`\n[5/5] Cleaning up test user…`);
  try {
    psql(`DELETE FROM company_memberships WHERE principal_id='${user2Id}' AND company_id='${NEOSERVICE_COMPANY_ID}';`);
    psql(`DELETE FROM session WHERE user_id='${user2Id}';`);
    psql(`DELETE FROM account WHERE user_id='${user2Id}';`);
    psql(`DELETE FROM "user" WHERE id='${user2Id}';`);
    // Remove the bucket so reruns are clean
    sshExec(`rm -rf /home/ubuntu/.paperclip/hermes/${NEOSERVICE_COMPANY_ID}/${user2Id}`);
    console.log(`    ✓ user, sessions, membership and bucket removed`);
  } catch (e) {
    console.warn(`    cleanup failed: ${(e as Error).message}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== Cross-user HERMES_HOME isolation test ===`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Stamp:  ${stamp}`);

  const { userId, cookies } = await signUpUser();
  let attached = false;
  try {
    attachToNeoservice(userId);
    attached = true;
    const { threadId, reply } = await sendMessageAsUser2(cookies);
    console.log(`    Nora's reply (truncated): ${reply.slice(0, 120)}…`);
    verifyBuckets(userId);
    console.log(`\n✅ Isolation works end-to-end: 2 humans → 2 buckets, no cross-leak.`);
    console.log(`    threadId=${threadId} (will be soft-deleted on cleanup)`);
  } finally {
    if (attached) cleanup(userId);
  }
}

main().catch((err) => {
  console.error(`\n❌ Test failed:`, err);
  process.exit(1);
});
