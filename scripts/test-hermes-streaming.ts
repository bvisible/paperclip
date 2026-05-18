//// Neocompany Modification — empirical Hermes token-by-token streaming validation
//// Connects to /api/plugins/<chat>/bridge/stream/chat:<threadId> with cookie
//// auth, then fires a chat message and counts how many `text` SSE events
//// arrive over time. With quiet:false + the verbose-mode parser, we expect
//// > 5 events spread across multiple seconds. With the old -Q behavior the
//// reply would arrive in 1 burst at done-time. The script logs each event
//// with a relative timestamp so the streaming feel is visible.
//// End Neocompany Modification

import { readFileSync } from "node:fs";

const BASE_URL = process.env.PAPERCLIP_BASE_URL ?? "https://app.neocompany.ch";
const COMPANY_ID = "b9f7a316-76c5-49f5-aa78-d5258595e28e"; // Neoservice
const NORA_AGENT_ID = "1930cb33-57eb-4358-be38-6379b6c58bdf";
const AUTH_FILE = process.env.PAPERCLIP_AUTH_FILE ?? "tests/e2e/neocompany/.auth/admin.json";

interface CookieEntry { name: string; value: string }

function loadCookieHeader(): string {
  const raw = readFileSync(AUTH_FILE, "utf-8");
  const parsed = JSON.parse(raw) as { cookies?: CookieEntry[] };
  if (!parsed.cookies?.length) {
    throw new Error(`No cookies in ${AUTH_FILE}`);
  }
  return parsed.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

const COOKIE = loadCookieHeader();

function bridgeHeaders(): Record<string, string> {
  return {
    Cookie: COOKIE,
    Origin: BASE_URL,
    Referer: BASE_URL,
    "Content-Type": "application/json",
  };
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...bridgeHeaders(), ...(init.headers ?? {}) },
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${path} → ${resp.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

async function fetchPluginId(): Promise<string> {
  const plugins = await api<Array<{ id: string; pluginKey: string }>>("/api/plugins");
  const chat = plugins.find((p) => p.pluginKey === "paperclip-chat");
  if (!chat) throw new Error("paperclip-chat plugin not found");
  return chat.id;
}

async function createThread(pluginId: string): Promise<string> {
  const resp = await api<{ data: { id: string } }>(
    `/api/plugins/${pluginId}/actions/createThread`,
    {
      method: "POST",
      body: JSON.stringify({
        companyId: COMPANY_ID,
        params: {
          companyId: COMPANY_ID,
          adapterType: "hermes_local",
          agentId: NORA_AGENT_ID,
          title: `stream-test-${Date.now()}`,
        },
      }),
    },
  );
  return resp.data.id;
}

async function sendMessage(pluginId: string, threadId: string, message: string) {
  await api(`/api/plugins/${pluginId}/actions/sendMessage`, {
    method: "POST",
    body: JSON.stringify({
      companyId: COMPANY_ID,
      params: { companyId: COMPANY_ID, threadId, message },
    }),
  });
}

async function deleteThread(pluginId: string, threadId: string) {
  await api(`/api/plugins/${pluginId}/actions/deleteThread`, {
    method: "POST",
    body: JSON.stringify({
      companyId: COMPANY_ID,
      params: { companyId: COMPANY_ID, threadId },
    }),
  }).catch(() => undefined);
}

async function streamSSE(pluginId: string, threadId: string, deadlineMs: number) {
  const url = `${BASE_URL}/api/plugins/${pluginId}/bridge/stream/chat:${threadId}?companyId=${COMPANY_ID}`;
  console.log(`[SSE] connecting to ${url}`);
  const resp = await fetch(url, {
    headers: { Cookie: COOKIE, Accept: "text/event-stream" },
  });
  console.log(`[SSE] status=${resp.status}`);
  if (resp.status !== 200) {
    throw new Error(`SSE failed: ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  if (!resp.body) throw new Error(`No SSE body`);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  const t0 = Date.now();
  const events: Array<{ relMs: number; type: string; preview: string }> = [];
  let buffer = "";
  let lastEventType = "message";

  while (Date.now() < deadlineMs) {
    const remaining = deadlineMs - Date.now();
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), remaining)),
    ]);
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const lines = frame.split("\n").filter((l) => l.length > 0);
      let dataLine = "";
      for (const line of lines) {
        if (line.startsWith("event:")) {
          lastEventType = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLine = line.slice(5).trim();
        }
      }
      if (!dataLine) continue;
      let parsed: { type?: string; text?: string; payload?: { type?: string; text?: string } };
      try { parsed = JSON.parse(dataLine); } catch { continue; }
      const innerType = parsed.payload?.type ?? parsed.type ?? lastEventType;
      const innerText = parsed.payload?.text ?? parsed.text ?? "";
      const relMs = Date.now() - t0;
      events.push({ relMs, type: innerType, preview: innerText.slice(0, 60).replace(/\n/g, "↵") });
      console.log(`[+${String(relMs).padStart(5, " ")}ms] ${innerType.padEnd(10)} ${events[events.length - 1]!.preview}`);
      if (innerType === "done" || lastEventType === "done") {
        await reader.cancel();
        return events;
      }
    }
  }
  await reader.cancel();
  return events;
}

async function main() {
  console.log(`=== Hermes streaming validation ===`);
  console.log(`Target: ${BASE_URL}`);

  const pluginId = await fetchPluginId();
  console.log(`paperclip-chat pluginId = ${pluginId}`);

  const threadId = await createThread(pluginId);
  console.log(`thread created: ${threadId}\n`);

  try {
    // Start SSE listener BEFORE sendMessage so we don't miss events.
    const ssePromise = streamSSE(pluginId, threadId, Date.now() + 60_000);
    // Small delay so SSE subscription is in place
    await new Promise((r) => setTimeout(r, 500));
    console.log(`[chat] sendMessage…`);
    await sendMessage(
      pluginId,
      threadId,
      "Compte de 1 à 8, un nombre par ligne, en français.",
    );
    const events = await ssePromise;

    // Analysis
    const textEvents = events.filter((e) => e.type === "text");
    const firstText = textEvents[0];
    const lastText = textEvents[textEvents.length - 1];
    const span = firstText && lastText ? lastText.relMs - firstText.relMs : 0;

    console.log(`\n=== Summary ===`);
    console.log(`Total SSE events received: ${events.length}`);
    console.log(`  text events:             ${textEvents.length}`);
    console.log(`  span first→last text:    ${span}ms`);
    if (textEvents.length >= 3 && span > 200) {
      console.log(`\n✅ Token-by-token streaming WORKS — ${textEvents.length} text chunks over ${span}ms.`);
    } else if (textEvents.length === 1) {
      console.log(`\n⚠️  Single text event — likely still buffered (Hermes -Q mode or parser bug).`);
    } else {
      console.log(`\n⚠️  Streaming partial — ${textEvents.length} chunks in ${span}ms.`);
    }
  } finally {
    await deleteThread(pluginId, threadId);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
