#!/usr/bin/env node
// Decompose codex-cli image-gen latency into phases:
//   [spawn]   t0 → first stdout/stderr byte (process is alive)
//   [boot]    → first "thinking" / "codex" line (session opened with backend)
//   [llm]     → first mention of image tool / "generating" in output
//   [gen]     → PNG appears on disk
//
// Helps identify whether the bottleneck is: (a) codex binary startup,
// (b) fresh ChatGPT session handshake, (c) model inference itself, or
// (d) post-processing / polling overhead.

import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

async function listPngs(root) {
  const out = new Map();
  try {
    const sessions = await readdir(root);
    for (const session of sessions) {
      const sessionDir = join(root, session);
      try {
        const files = await readdir(sessionDir);
        for (const f of files) {
          if (f.toLowerCase().endsWith(".png")) {
            const p = join(sessionDir, f);
            const st = await stat(p);
            out.set(p, st.mtimeMs);
          }
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
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

const CODEX_BIN = process.env.CODEX_BIN
  ?? "/home/ubuntu/.npm-global/bin/codex";
const PROMPT = process.argv[2] ?? "simple blue circle on white background";

console.log(`=== Codex image-gen latency decomposition ===`);
console.log(`  binary:  ${CODEX_BIN}`);
console.log(`  prompt:  ${JSON.stringify(PROMPT)}`);
console.log("");

const workspace = await mkdtemp(join(tmpdir(), "bench-decompose-"));
const codexImagesDir = join(homedir(), ".codex", "generated_images");
const before = await listPngs(codexImagesDir);

const timestamps = {
  t0_spawn: Date.now(),
  t1_firstByte: null,
  t2_firstBoot: null,
  t3_firstImage: null,
  t4_png: null,
};

const env = {
  ...process.env,
  PATH: `${process.env.PATH ?? ""}:/home/ubuntu/.npm-global/bin:/usr/local/bin`,
  HOME: process.env.HOME ?? homedir(),
};

const args = [
  "exec",
  "--dangerously-bypass-approvals-and-sandbox",
  "--skip-git-repo-check",
  "-c",
  "reasoning.effort=minimal",
  "--cd",
  workspace,
  "--color",
  "never",
  `generate image: ${PROMPT}`,
];

const child = spawn(CODEX_BIN, args, {
  env,
  cwd: workspace,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});

let stdoutBuf = "";
let stderrBuf = "";

function onChunk(source, chunk) {
  const now = Date.now();
  const text = chunk.toString();
  if (source === "stdout") stdoutBuf += text; else stderrBuf += text;

  if (!timestamps.t1_firstByte) timestamps.t1_firstByte = now;

  const combined = text.toLowerCase();
  if (!timestamps.t2_firstBoot && (combined.includes("codex") || combined.includes("thinking") || combined.includes("session"))) {
    timestamps.t2_firstBoot = now;
  }
  if (!timestamps.t3_firstImage && (combined.includes("image") || combined.includes("generating") || combined.includes("imagegen"))) {
    timestamps.t3_firstImage = now;
  }
}

child.stdout.on("data", (c) => onChunk("stdout", c));
child.stderr.on("data", (c) => onChunk("stderr", c));

const killCodex = () => {
  try { if (child.pid) process.kill(-child.pid, "SIGKILL"); }
  catch { try { child.kill("SIGKILL"); } catch {} }
};

const POLL_MS = 200;
const TIMEOUT_MS = 5 * 60_000;
let pngPath = null;

while (Date.now() - timestamps.t0_spawn < TIMEOUT_MS) {
  const after = await listPngs(codexImagesDir);
  const newPng = pickNewest(after, before);
  if (newPng) {
    timestamps.t4_png = Date.now();
    pngPath = newPng;
    break;
  }
  if (child.exitCode !== null) break;
  await new Promise((r) => setTimeout(r, POLL_MS));
}

killCodex();

if (!pngPath) {
  console.log(`❌ No PNG produced within ${TIMEOUT_MS}ms`);
  console.log(`stdout: ${stdoutBuf.slice(0, 600)}`);
  console.log(`stderr: ${stderrBuf.slice(0, 600)}`);
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  process.exit(1);
}

const st = await stat(pngPath);
await rm(workspace, { recursive: true, force: true }).catch(() => undefined);

const t0 = timestamps.t0_spawn;
function phase(label, tLabel, prev) {
  const t = timestamps[tLabel];
  if (!t) return `  ${label.padEnd(22)}  -`;
  const ms = t - t0;
  const delta = t - (timestamps[prev] ?? t0);
  return `  ${label.padEnd(22)}  t+${(ms / 1000).toFixed(1)}s   (+${(delta / 1000).toFixed(1)}s)`;
}

console.log(`PNG: ${pngPath} (${(st.size / 1024).toFixed(0)} KB)`);
console.log("");
console.log("Timeline:");
console.log(phase("spawn",          "t0_spawn",      null));
console.log(phase("first byte",     "t1_firstByte",  "t0_spawn"));
console.log(phase("boot / session", "t2_firstBoot",  "t1_firstByte"));
console.log(phase("llm / imagegen", "t3_firstImage", "t2_firstBoot"));
console.log(phase("PNG on disk",    "t4_png",        "t3_firstImage"));
console.log("");
const total = timestamps.t4_png - timestamps.t0_spawn;
const spawnOverhead = (timestamps.t1_firstByte ?? timestamps.t4_png) - timestamps.t0_spawn;
const genPhase = timestamps.t4_png - (timestamps.t3_firstImage ?? timestamps.t1_firstByte ?? timestamps.t0_spawn);
console.log(`Totals:`);
console.log(`  total:                ${(total / 1000).toFixed(1)}s`);
console.log(`  spawn overhead:       ${(spawnOverhead / 1000).toFixed(1)}s  (process boot + first byte)`);
console.log(`  post-llm to PNG:      ${(genPhase / 1000).toFixed(1)}s  (includes polling jitter up to 200ms)`);

console.log("");
console.log("--- first 800 chars of codex stderr (truncated) ---");
console.log(stderrBuf.slice(0, 800));
