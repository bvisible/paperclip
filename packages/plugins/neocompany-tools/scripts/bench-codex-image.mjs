#!/usr/bin/env node
// Codex CLI image generation benchmark.
//
// Mirrors the spawn+poll+kill-on-png logic of `generateWithCodexCli` in
// `src/tools/content/image-generate.ts`, but runs standalone so we can time
// pure codex latency without the plugin worker / compositor overhead.
//
// Usage:
//   node scripts/bench-codex-image.mjs [options]
//
// Options:
//   --iterations N       Number of runs per prompt (default: 3)
//   --prompt "..."       Single custom prompt (repeated N times)
//   --reasoning X        minimal | low | medium (default: minimal)
//   --timeout-ms N       Per-iteration timeout (default: 600000 = 10 min)
//   --keep-workspaces    Don't clean up scratch dirs after run
//   --json PATH          Also write JSON report to PATH
//   --help               Print this help
//
// Environment:
//   CODEX_BIN            Override codex binary path (default: auto-detect)

import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(readHeaderComment());
  process.exit(0);
}

const DEFAULT_PROMPTS = [
  "aurora borealis over snowy forest",
  "minimalist corporate office desk with laptop and coffee, soft morning light",
  "abstract blue and purple gradient background, geometric shapes",
];

const prompts = args.prompt ? [args.prompt] : DEFAULT_PROMPTS;
const iterations = args.iterations ?? 3;
const reasoning = args.reasoning ?? "minimal";
const timeoutMs = args["timeout-ms"] ?? 10 * 60_000;
const keepWorkspaces = Boolean(args["keep-workspaces"]);

const CODEX_BINARY_CANDIDATES = [
  process.env.CODEX_BIN,
  "codex",
  "/home/ubuntu/.npm-global/bin/codex",
  "/usr/local/bin/codex",
].filter((p) => typeof p === "string" && p.length > 0);

const codexBin = await resolveCodexBin();
const codexVersion = await getCodexVersion(codexBin);

console.log("=== Codex image-gen benchmark ===");
console.log(`  binary:      ${codexBin}`);
console.log(`  version:     ${codexVersion}`);
console.log(`  reasoning:   ${reasoning}`);
console.log(`  iterations:  ${iterations} per prompt`);
console.log(`  prompts:     ${prompts.length}`);
console.log(`  timeout:     ${timeoutMs / 1000}s per run`);
console.log("");

const results = [];

for (const prompt of prompts) {
  console.log(`--- prompt: ${JSON.stringify(prompt)} ---`);
  for (let i = 1; i <= iterations; i++) {
    const run = await benchOne(prompt, i);
    results.push({ prompt, iteration: i, ...run });
    if (run.ok) {
      console.log(
        `  [${i}/${iterations}] OK  ${(run.elapsedMs / 1000).toFixed(1)}s  ${run.pngBytes ? `${(run.pngBytes / 1024).toFixed(0)}KB` : "?KB"}  → ${run.pngPath}`,
      );
    } else {
      console.log(
        `  [${i}/${iterations}] FAIL ${(run.elapsedMs / 1000).toFixed(1)}s  ${run.error}`,
      );
    }
  }
}

console.log("");
console.log("=== Summary ===");
const ok = results.filter((r) => r.ok);
const fail = results.filter((r) => !r.ok);
console.log(`  runs:     ${results.length} (ok ${ok.length}, fail ${fail.length})`);
if (ok.length > 0) {
  const durations = ok.map((r) => r.elapsedMs).sort((a, b) => a - b);
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
  const median = durations[Math.floor(durations.length / 2)];
  const min = durations[0];
  const max = durations[durations.length - 1];
  const p90 = durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.9))];
  console.log(`  min:      ${(min / 1000).toFixed(1)}s`);
  console.log(`  median:   ${(median / 1000).toFixed(1)}s`);
  console.log(`  mean:     ${(mean / 1000).toFixed(1)}s`);
  console.log(`  p90:      ${(p90 / 1000).toFixed(1)}s`);
  console.log(`  max:      ${(max / 1000).toFixed(1)}s`);
  console.log("");
  if (mean <= 15_000) {
    console.log("  ⚡ Mean ≤ 15s — great for interactive generation.");
  } else if (mean <= 30_000) {
    console.log("  ✓ Mean ≤ 30s — acceptable for batch workflows with progress UI.");
  } else if (mean <= 60_000) {
    console.log("  ⚠ Mean 30-60s — usable for background autopilot but not interactive.");
  } else {
    console.log("  ✗ Mean > 60s — too slow for UX. Consider OpenAI API (gpt-image-1).");
  }
}

if (args.json) {
  const report = {
    generatedAt: new Date().toISOString(),
    codexBin,
    codexVersion,
    reasoning,
    iterations,
    timeoutMs,
    results,
  };
  await writeFile(args.json, JSON.stringify(report, null, 2), "utf8");
  console.log(`\n  JSON report written to ${args.json}`);
}

process.exit(fail.length === 0 ? 0 : 1);

// ---------- helpers ----------

async function benchOne(prompt, iteration) {
  const started = Date.now();
  const workspace = await mkdtemp(join(tmpdir(), `bench-codex-imagegen-${iteration}-`));
  const codexImagesDir = join(homedir(), ".codex", "generated_images");
  const beforeSnapshot = await listPngsRecursive(codexImagesDir);
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
    `reasoning.effort=${reasoning}`,
    "--cd",
    workspace,
    "--color",
    "never",
    `generate image: ${prompt}`,
  ];
  const child = spawn(codexBin, args, {
    env,
    cwd: workspace,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let spawnError = null;
  child.stdout?.on("data", () => {});
  child.stderr.on("data", (c) => { stderr += c.toString(); });
  child.on("error", (err) => { spawnError = err; });
  const killCodex = () => {
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
    }
  };
  try {
    while (Date.now() - started < timeoutMs) {
      if (spawnError) throw spawnError;
      const exited = child.exitCode !== null;
      const afterSnapshot = await listPngsRecursive(codexImagesDir);
      const newPng = pickNewest(afterSnapshot, beforeSnapshot);
      if (newPng) {
        killCodex();
        const st = await stat(newPng);
        const elapsedMs = Date.now() - started;
        if (!keepWorkspaces) {
          await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
        }
        return {
          ok: true,
          elapsedMs,
          pngPath: newPng,
          pngBytes: st.size,
          stderrSnippet: stderr.slice(0, 200),
        };
      }
      if (exited) {
        const elapsedMs = Date.now() - started;
        if (!keepWorkspaces) {
          await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
        }
        return {
          ok: false,
          elapsedMs,
          error: `codex exited without PNG: ${stderr.slice(0, 400)}`,
        };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    killCodex();
    const elapsedMs = Date.now() - started;
    if (!keepWorkspaces) {
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
    return { ok: false, elapsedMs, error: `timed out after ${timeoutMs}ms` };
  } catch (err) {
    killCodex();
    const elapsedMs = Date.now() - started;
    if (!keepWorkspaces) {
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
    return { ok: false, elapsedMs, error: err instanceof Error ? err.message : String(err) };
  }
}

async function listPngsRecursive(root) {
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

async function resolveCodexBin() {
  for (const candidate of CODEX_BINARY_CANDIDATES) {
    try {
      const v = await getCodexVersion(candidate);
      if (v) return candidate;
    } catch { /* try next */ }
  }
  throw new Error(`No usable codex binary found. Tried: ${CODEX_BINARY_CANDIDATES.join(", ")}`);
}

function getCodexVersion(bin) {
  return new Promise((resolve) => {
    const child = spawn(bin, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c) => { out += c.toString(); });
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 ? out.trim() : null));
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { out.help = true; continue; }
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (key === "keep-workspaces") { out[key] = true; continue; }
    if (next === undefined || next.startsWith("--")) { out[key] = true; continue; }
    if (key === "iterations" || key === "timeout-ms") out[key] = parseInt(next, 10);
    else out[key] = next;
    i++;
  }
  return out;
}

function readHeaderComment() {
  return `Codex CLI image generation benchmark.

Usage:
  node scripts/bench-codex-image.mjs [options]

Options:
  --iterations N       Number of runs per prompt (default: 3)
  --prompt "..."       Single custom prompt (repeated N times)
  --reasoning X        minimal | low | medium (default: minimal)
  --timeout-ms N       Per-iteration timeout (default: 600000 = 10 min)
  --keep-workspaces    Don't clean up scratch dirs after run
  --json PATH          Also write JSON report to PATH
  --help               Print this help

Environment:
  CODEX_BIN            Override codex binary path (default: auto-detect)`;
}
