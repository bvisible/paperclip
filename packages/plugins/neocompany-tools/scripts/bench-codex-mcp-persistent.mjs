#!/usr/bin/env node
// Benchmark codex mcp-server with a PERSISTENT session.
//
// Compares:
//   - N=1: first call (fresh session, includes MCP handshake + first-call overhead)
//   - N=2..: follow-up calls on the same threadId via `codex-reply`
//
// If the 100k-token-per-fresh-session hypothesis is correct, calls N=2..
// should be significantly faster than N=1 and the matching `codex exec`
// numbers we measured earlier (~33s median).

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

async function listPngs(root) {
  const out = new Map();
  try {
    const sessions = await readdir(root);
    for (const session of sessions) {
      const d = join(root, session);
      try {
        const files = await readdir(d);
        for (const f of files) {
          if (f.toLowerCase().endsWith(".png")) {
            const p = join(d, f);
            const st = await stat(p);
            out.set(p, st.mtimeMs);
          }
        }
      } catch {}
    }
  } catch {}
  return out;
}

function pickNewest(after, before) {
  let best = null;
  for (const [path, mtime] of after) {
    if (before.has(path)) continue;
    if (!best || mtime > best.mtime) best = { path, mtime };
  }
  return best?.path ?? null;
}

const bin = process.env.CODEX_BIN ?? "/home/ubuntu/.npm-global/bin/codex";
const codexImagesDir = join(homedir(), ".codex", "generated_images");
const prompts = [
  "simple abstract blue circle on white background",
  "minimalist geometric red square",
  "soft green gradient with small white dots",
];

console.log("=== codex mcp-server persistent-session benchmark ===");
console.log(`  binary:  ${bin}`);
console.log(`  prompts: ${prompts.length} (first=new session, rest=codex-reply on same threadId)`);
console.log("");

const child = spawn(bin, ["mcp-server"], { stdio: ["pipe", "pipe", "pipe"] });
let stderrBuf = "";
child.stderr.on("data", (c) => { stderrBuf += c.toString(); });

const rl = createInterface({ input: child.stdout });
let nextId = 1;
const pending = new Map();
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id && pending.has(msg.id)) {
    const { resolve } = pending.get(msg.id);
    pending.delete(msg.id);
    resolve(msg);
  }
});

function send(method, params, timeoutMs = 5 * 60_000) {
  const id = nextId++;
  const msg = { jsonrpc: "2.0", id, method, params };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify(msg) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout ${timeoutMs}ms for ${method}`));
      }
    }, timeoutMs);
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

async function callWithImagePoll(toolName, args) {
  const beforePngs = await listPngs(codexImagesDir);
  const callStart = Date.now();
  const result = await send("tools/call", { name: toolName, arguments: args });
  const callEnd = Date.now();
  const afterPngs = await listPngs(codexImagesDir);
  const png = pickNewest(afterPngs, beforePngs);
  const pngSize = png ? (await stat(png)).size : 0;
  return {
    result,
    callMs: callEnd - callStart,
    png,
    pngSize,
  };
}

try {
  // --- MCP handshake ---
  const handshakeStart = Date.now();
  const init = await send("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: { tools: {} },
    clientInfo: { name: "bench-persistent", version: "0.0.1" },
  });
  notify("notifications/initialized", {});
  const handshakeMs = Date.now() - handshakeStart;
  console.log(`MCP handshake:         ${(handshakeMs / 1000).toFixed(2)}s`);
  console.log("");

  // --- Call #1: new session (codex tool) ---
  console.log(`[1/${prompts.length}] new session: ${JSON.stringify(prompts[0])}`);
  const first = await callWithImagePoll("codex", {
    prompt: `generate image: ${prompts[0]}`,
    sandbox: "danger-full-access",
    "approval-policy": "never",
    config: { "reasoning.effort": "minimal" },
  });
  const threadId = parseThreadId(first.result);
  const pngKb1 = first.pngSize ? Math.round(first.pngSize / 1024) : "?";
  console.log(`  ${(first.callMs / 1000).toFixed(1)}s   PNG: ${first.png ? `${pngKb1}KB` : "NONE"}   threadId: ${threadId ?? "MISSING"}`);
  if (!threadId) {
    console.log("  stderr:", stderrBuf.slice(0, 300));
    console.log("  result:", JSON.stringify(first.result).slice(0, 400));
    throw new Error("no threadId returned from codex tool");
  }

  // --- Calls 2..N: codex-reply on same threadId ---
  const followups = [];
  for (let i = 1; i < prompts.length; i++) {
    console.log(`[${i + 1}/${prompts.length}] reply on ${threadId.slice(0, 12)}…: ${JSON.stringify(prompts[i])}`);
    const r = await callWithImagePoll("codex-reply", {
      threadId,
      prompt: `generate image: ${prompts[i]}`,
    });
    const pngKb = r.pngSize ? Math.round(r.pngSize / 1024) : "?";
    console.log(`  ${(r.callMs / 1000).toFixed(1)}s   PNG: ${r.png ? `${pngKb}KB` : "NONE"}`);
    followups.push(r);
  }

  console.log("");
  console.log("=== Summary ===");
  console.log(`  handshake:   ${(handshakeMs / 1000).toFixed(2)}s`);
  console.log(`  call #1:     ${(first.callMs / 1000).toFixed(1)}s (fresh session)`);
  followups.forEach((r, i) => {
    console.log(`  call #${i + 2}:     ${(r.callMs / 1000).toFixed(1)}s (codex-reply, warm session)`);
  });
  if (followups.length > 0) {
    const avgWarm = followups.reduce((a, b) => a + b.callMs, 0) / followups.length;
    const savings = first.callMs - avgWarm;
    console.log("");
    console.log(`  warm avg:    ${(avgWarm / 1000).toFixed(1)}s`);
    console.log(`  savings:     ${(savings / 1000).toFixed(1)}s per call vs fresh (${Math.round((savings / first.callMs) * 100)}% faster)`);
  }
} catch (err) {
  console.error("\nERROR:", err instanceof Error ? err.message : String(err));
  console.error("stderr tail:", stderrBuf.slice(-600));
  process.exitCode = 1;
} finally {
  try { child.kill("SIGKILL"); } catch {}
}

function parseThreadId(result) {
  const r = result?.result;
  if (!r) return null;
  if (r.threadId) return r.threadId;
  // Fallback: content[0].text may be a JSON blob
  const content = r.content;
  if (Array.isArray(content)) {
    for (const c of content) {
      if (c.type === "text" && typeof c.text === "string") {
        try {
          const j = JSON.parse(c.text);
          if (j.threadId) return j.threadId;
        } catch {}
      }
    }
  }
  if (r.structuredContent?.threadId) return r.structuredContent.threadId;
  return null;
}
