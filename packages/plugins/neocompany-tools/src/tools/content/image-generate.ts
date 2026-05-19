/**
 * Tool: imageGenerate — AI image generation with optional template overlay.
 *
 * Three providers are supported:
 *  - `openai`    → direct API call to `/v1/images/generations` with an API key
 *                  (requires `openaiApiKeyRef` in plugin platform config)
 *  - `codex-cli` → spawn the OpenAI Codex CLI with `$imagegen` — uses the
 *                  ChatGPT Pro subscription OAuth (no API key). Requires the
 *                  `codex` binary on PATH and a prior interactive `codex login`.
 *  - `gemini`    → not yet implemented
 *
 * If a `templateId` is provided, the generated image is composited with the
 * brand template via Sharp before being stored. The resulting entity
 * (`generated_image`, scope=company) is created with status=pending so a
 * reviewer can approve or reject it.
 */

import type { ToolRunContext, ToolResult, PluginContext } from "@paperclipai/plugin-sdk";
import type { ToolContextAccess } from "../index.js";
import { IMAGE_ENTITY_TYPE, type GeneratedImageData, type ImageProvider } from "../../images/types.js";
import { ENTITY_TYPE as TEMPLATE_ENTITY_TYPE, type BrandTemplateData } from "../../templates/types.js";
import { compositeImage } from "../../templates/compositor.js";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

interface Params {
  prompt: string;
  templateId?: string;
  provider?: ImageProvider;
  width?: number;
  height?: number;
  batchId?: string;
  logoUrl?: string;
  //// Neocompany Modification — visual references for the generator.
  //// referenceImageIds: externalIds of `generated_image` entities (uploads
  //// or earlier generations) that the worker resolves to their stored
  //// finalImageUrl / rawImageUrl and writes to a tmp file before feeding
  //// codex `-i` flags. Preferred path — keeps an audit trail.
  //// referenceImageUrls: raw data: or https:// URLs. Useful for one-off
  //// refs that aren't in the library. Both arrays can be passed together.
  referenceImageIds?: string[];
  referenceImageUrls?: string[];
  //// End Neocompany Modification
}

const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";
const DEFAULT_MODEL = "gpt-image-2";

async function resolveSecret(
  ctx: PluginContext,
  ref: string | undefined,
): Promise<string | undefined> {
  if (!ref) return undefined;
  try {
    return await ctx.secrets.resolve(ref);
  } catch {
    return undefined;
  }
}

async function generateWithOpenAI(
  ctx: PluginContext,
  apiKey: string,
  prompt: string,
  width: number,
  height: number,
): Promise<{ buffer: Buffer; mimeType: string }> {
  // gpt-image-2 supports up to 2K output, varied aspect ratios, and native
  // thinking (slower than 1.5 but better text rendering + prompt adherence).
  // Same size parameter shape as 1.5/1.
  const size = pickOpenAISize(width, height);
  const res = await ctx.http.fetch(OPENAI_IMAGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      prompt,
      size,
      n: 1,
    }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`OpenAI image API ${res.status}: ${bodyText.slice(0, 300)}`);
  }
  const body = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const item = body.data?.[0];
  if (!item) throw new Error("OpenAI image API returned no data");
  if (item.b64_json) {
    return { buffer: Buffer.from(item.b64_json, "base64"), mimeType: "image/png" };
  }
  if (item.url) {
    const download = await ctx.http.fetch(item.url);
    if (!download.ok) throw new Error(`Failed to download image: ${download.status}`);
    const ab = await download.arrayBuffer();
    return { buffer: Buffer.from(ab), mimeType: "image/png" };
  }
  throw new Error("OpenAI image API returned neither b64_json nor url");
}

function pickOpenAISize(width: number, height: number): string {
  const ratio = width / height;
  if (ratio > 1.2) return "1536x1024"; // landscape
  if (ratio < 0.85) return "1024x1536"; // portrait
  return "1024x1024"; // square/close to square
}

// ---------------------------------------------------------------------------
// Codex CLI provider — spawns the `codex` binary, lets $imagegen do its job,
// and grabs the PNG the CLI writes into our scratch workspace.
// ---------------------------------------------------------------------------

const CODEX_BINARY_CANDIDATES = [
  process.env.CODEX_BIN,
  "codex",
  "/home/ubuntu/.npm-global/bin/codex",
  "/usr/local/bin/codex",
].filter((p): p is string => typeof p === "string" && p.length > 0);

async function generateWithCodexCli(
  prompt: string,
  width: number,
  height: number,
  refImagePaths: string[],
  timeoutMs = 12 * 60_000,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const workspace = await mkdtemp(join(tmpdir(), "codex-imagegen-"));
  // Simple prompt form — complex instructions trigger extra reasoning cycles
  // that add minutes. Keep it terse.
  const instruction = `generate image: ${prompt}`;

  const env = {
    ...process.env,
    PATH: `${process.env.PATH ?? ""}:/home/ubuntu/.npm-global/bin:/usr/local/bin`,
    HOME: process.env.HOME ?? homedir(),
  };

  // Snapshot the codex generated_images dir before running so we can diff
  // and pick the PNG that belongs to this exact run.
  const codexImagesDir = join(homedir(), ".codex", "generated_images");
  const beforeSnapshot = await listPngsRecursive(codexImagesDir);

  //// Neocompany Modification — pre-filter candidates to those whose file
  //// actually exists on disk. Otherwise spawn() reports ENOENT and the
  //// loop falls through to the next, eventually surfacing the *last*
  //// candidate's error (`/usr/local/bin/codex ENOENT`) — which is
  //// misleading: the real issue is usually that none of the candidates
  //// resolve, or the worker env is missing PATH. Bare "codex" stays in
  //// the list because spawn() will resolve it via PATH at runtime.
  const resolvedCandidates = CODEX_BINARY_CANDIDATES.filter(
    (p) => p === "codex" || existsSync(p),
  );
  if (resolvedCandidates.length === 0) {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(
      `codex binary not found. Tried: ${CODEX_BINARY_CANDIDATES.join(", ")}. ` +
        `Set CODEX_BIN env var to the absolute path of the codex binary.`,
    );
  }

  let lastErr: unknown;
  for (const bin of resolvedCandidates) {
    try {
      // Spawn codex but don't wait for it to exit — it tends to keep reasoning
      // long after the image was generated. We poll ~/.codex/generated_images/
      // until a new PNG appears, then kill codex.
      const newPng = await spawnCodexAndWaitForPng(
        bin, instruction, workspace, env, codexImagesDir, beforeSnapshot, refImagePaths, timeoutMs,
      );
      const buffer = await readFile(newPng);
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
      return { buffer, mimeType: "image/png" };
    } catch (err) {
      lastErr = err;
      // Try next binary candidate
    }
  }
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  throw lastErr instanceof Error ? lastErr : new Error(`codex-cli failed: ${String(lastErr)}`);
  //// End Neocompany Modification
}

async function spawnCodexAndWaitForPng(
  bin: string,
  prompt: string,
  workspace: string,
  env: NodeJS.ProcessEnv,
  codexImagesDir: string,
  beforeSnapshot: Map<string, number>,
  refImagePaths: string[],
  timeoutMs: number,
): Promise<string> {
  // Codex 0.122+ ships image_generation as a stable feature (enabled by default)
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
  ];
  //// Neocompany Modification — visual reference images.
  //// Each `-i <abs-path>` attaches a reference codex feeds to the image
  //// backend. Pattern lifted from Reed-Blake-communication's
  //// product_image_gen_mcp/codex_runner.py:125-128. The `--` separator
  //// after the refs is mandatory: without it codex parses the prompt as
  //// another file path and errors out.
  for (const ref of refImagePaths) {
    args.push("-i", ref);
  }
  args.push("--", prompt);
  //// End Neocompany Modification

  // stdin: 'ignore' avoids codex hanging when it probes for TTY/keyboard input.
  // stdout piped so we can keep stream draining (codex writes progress there).
  const child = spawn(bin, args, {
    env,
    cwd: workspace,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Drain stdout so the child doesn't block on a full pipe buffer after codex
  // prints its status/token lines.
  child.stdout?.on("data", () => {});
  let stderr = "";
  let spawnError: Error | null = null;
  child.stderr.on("data", (c) => { stderr += c.toString(); });
  child.on("error", (err) => {
    // spawn() reports ENOENT and similar via this event, not via throw —
    // if we ignore it the worker process will crash with an uncaught exception.
    spawnError = err;
  });

  const killCodex = () => {
    try {
      // Kill the whole process group (codex wrapper + rust binary child)
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
    }
  };

  const startedAt = Date.now();
  const pollIntervalMs = 1_000;

  try {
    while (Date.now() - startedAt < timeoutMs) {
      if (spawnError) throw spawnError;
      // Quick check: is the child still alive?
      const exited = child.exitCode !== null;
      const afterSnapshot = await listPngsRecursive(codexImagesDir);
      const newPng = pickNewest(afterSnapshot, beforeSnapshot);
      if (newPng) {
        // PNG produced — kill codex and return
        killCodex();
        return newPng;
      }
      if (exited) {
        throw new Error(`codex-cli exited without producing a PNG: ${stderr.slice(0, 400)}`);
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new Error(`codex-cli timed out after ${timeoutMs}ms without producing a PNG`);
  } finally {
    killCodex();
  }
}

async function listPngsRecursive(root: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
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
      } catch {
        // session dir disappeared or unreadable — ignore
      }
    }
  } catch {
    // root doesn't exist yet
  }
  return out;
}

function pickNewest(after: Map<string, number>, before: Map<string, number>): string | null {
  let best: { path: string; mtime: number } | null = null;
  for (const [path, mtime] of after) {
    if (before.has(path)) continue;
    if (!best || mtime > best.mtime) best = { path, mtime };
  }
  return best?.path ?? null;
}

//// Neocompany Modification — resolve reference images to local files.
//// referenceImageIds → fetch the `generated_image` entity (uploads or
//// earlier generations) and pull the inlined data URL out of its data
//// blob. referenceImageUrls → accept data: URLs verbatim or fetch
//// https:// URLs to a buffer. Both paths end up writing a temp .png file
//// codex can attach via `-i`. The returned tmp dir must be cleaned up by
//// the caller (we do it in a `finally`).
//// End Neocompany Modification
async function prepareReferenceFiles(
  ctx: PluginContext,
  companyId: string,
  referenceImageIds: string[] | undefined,
  referenceImageUrls: string[] | undefined,
): Promise<{ paths: string[]; cleanupDir: string | null; resolvedIds: string[]; resolvedUrls: string[] }> {
  const ids = (referenceImageIds ?? []).filter((s): s is string => typeof s === "string" && s.length > 0);
  const urls = (referenceImageUrls ?? []).filter((s): s is string => typeof s === "string" && s.length > 0);
  if (ids.length === 0 && urls.length === 0) {
    return { paths: [], cleanupDir: null, resolvedIds: [], resolvedUrls: [] };
  }
  const dir = await mkdtemp(join(tmpdir(), "codex-refs-"));
  const paths: string[] = [];
  const resolvedIds: string[] = [];
  const resolvedUrls: string[] = [];
  let i = 0;
  for (const externalId of ids) {
    const matches = await ctx.entities.list({
      entityType: IMAGE_ENTITY_TYPE,
      scopeKind: "company",
      scopeId: companyId,
      externalId,
      limit: 1,
    });
    const row = matches[0];
    if (!row) continue;
    const data = row.data as unknown as GeneratedImageData | undefined;
    // Prefer the raw upload for "upload" refs (more faithful), the final
    // composited image for "generated" refs (what the user actually saw).
    const url =
      data?.source === "upload"
        ? data?.rawImageUrl
        : data?.finalImageUrl ?? data?.rawImageUrl;
    if (!url) continue;
    const buf = await dataUrlOrFetchToBuffer(ctx, url);
    if (!buf) continue;
    const p = join(dir, `ref_${i++}.png`);
    await writeFile(p, buf);
    paths.push(p);
    resolvedIds.push(externalId);
  }
  for (const url of urls) {
    const buf = await dataUrlOrFetchToBuffer(ctx, url);
    if (!buf) continue;
    const p = join(dir, `ref_${i++}.png`);
    await writeFile(p, buf);
    paths.push(p);
    resolvedUrls.push(url);
  }
  return { paths, cleanupDir: dir, resolvedIds, resolvedUrls };
}

async function dataUrlOrFetchToBuffer(ctx: PluginContext, url: string): Promise<Buffer | null> {
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    if (comma === -1) return null;
    const header = url.slice(5, comma);
    const payload = url.slice(comma + 1);
    if (header.includes("base64")) {
      return Buffer.from(payload, "base64");
    }
    return Buffer.from(decodeURIComponent(payload), "utf8");
  }
  try {
    const res = await ctx.http.fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function runImageGenerate(
  params: Params,
  _config: unknown,
  runCtx: ToolRunContext,
  ctxAccess: ToolContextAccess,
): Promise<ToolResult> {
  const ctx = ctxAccess.getPluginContext();
  const { prompt, templateId, provider = "openai", batchId, logoUrl, referenceImageIds, referenceImageUrls } = params;
  let { width = 1080, height = 1080 } = params;

  if (!prompt || prompt.trim().length === 0) {
    return { content: "Prompt is required.", error: "MISSING_PROMPT" };
  }

  // ── Resolve platform API key (only required for the `openai` provider)
  const platform = (await ctx.config.get()) as { openaiApiKeyRef?: string } | null;
  const apiKey = await resolveSecret(ctx, platform?.openaiApiKeyRef);
  if (provider === "openai" && !apiKey) {
    return {
      content: "Platform OpenAI API key is not configured. Ask an admin to set `openaiApiKeyRef` in the plugin's platform settings, or switch to provider=codex-cli to use a ChatGPT subscription.",
      error: "MISSING_OPENAI_KEY",
    };
  }

  // ── Optional: load template to use its dimensions and compositor ─
  // Either explicit (templateId) or the company's default "brand overlay".
  let templateData: BrandTemplateData | undefined;
  if (templateId) {
    const matches = await ctx.entities.list({
      entityType: TEMPLATE_ENTITY_TYPE,
      scopeKind: "company",
      scopeId: runCtx.companyId,
      externalId: templateId,
      limit: 1,
    });
    const record = matches[0];
    if (record) {
      templateData = record.data as unknown as BrandTemplateData;
      width = templateData.width;
      height = templateData.height;
    }
  } else {
    // No explicit templateId — fall back to the company's brand overlay
    // template (isDefault=true) if one exists.
    const all = await ctx.entities.list({
      entityType: TEMPLATE_ENTITY_TYPE,
      scopeKind: "company",
      scopeId: runCtx.companyId,
      limit: 50,
    });
    const def = all.find((r) => {
      const d = r.data as unknown as BrandTemplateData | undefined;
      return d?.isDefault === true;
    });
    if (def) {
      templateData = def.data as unknown as BrandTemplateData;
      width = templateData.width;
      height = templateData.height;
    }
  }

  //// Neocompany Modification — resolve reference images once for the run.
  //// Both providers receive the same path list; today only the codex-cli
  //// path uses them (OpenAI image edits has a different API shape — left
  //// as a Phase 2 TODO).
  const refs = await prepareReferenceFiles(ctx, runCtx.companyId, referenceImageIds, referenceImageUrls);

  // ── Generate raw image ───────────────────────────────────────────
  let rawBuffer: Buffer;
  let mimeType: string;
  try {
    if (provider === "openai") {
      if (refs.paths.length > 0) {
        ctx.logger?.warn?.(
          "imageGenerate: OpenAI provider does not yet wire reference images; falling back to prompt-only",
          { refs: refs.paths.length },
        );
      }
      const gen = await generateWithOpenAI(ctx, apiKey!, prompt, width, height);
      rawBuffer = gen.buffer;
      mimeType = gen.mimeType;
    } else if (provider === "codex-cli") {
      const gen = await generateWithCodexCli(prompt, width, height, refs.paths);
      rawBuffer = gen.buffer;
      mimeType = gen.mimeType;
    } else {
      return {
        content: `Provider "${provider}" is not yet implemented. Use provider=openai.`,
        error: "UNSUPPORTED_PROVIDER",
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (refs.cleanupDir) await rm(refs.cleanupDir, { recursive: true, force: true }).catch(() => undefined);
    return { content: `Image generation failed: ${msg}`, error: msg };
  } finally {
    if (refs.cleanupDir) {
      await rm(refs.cleanupDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  //// End Neocompany Modification

  const rawImageUrl = `data:${mimeType};base64,${rawBuffer.toString("base64")}`;

  // ── Optional composite with template ─────────────────────────────
  let finalImageUrl = rawImageUrl;
  let finalMime = mimeType;
  if (templateData) {
    // Priority: explicit param > template's embedded data URL > company brand logo
    let resolvedLogoUrl = logoUrl;
    if (!resolvedLogoUrl) {
      resolvedLogoUrl = templateData.config.logo?.imageDataUrl;
    }
    if (!resolvedLogoUrl) {
      try {
        const company = await ctx.companies.get(runCtx.companyId);
        resolvedLogoUrl = company?.logoUrl ?? undefined;
      } catch {
        // companies.read not granted or company missing — proceed without logo
      }
    }
    // Paperclip returns the brand logo as a relative, auth-gated URL
    // (/api/assets/…/content). The worker sandbox cannot reach it, so unless
    // the URL is already a data: URL we drop it and rely on in-template logo.
    if (resolvedLogoUrl && resolvedLogoUrl.startsWith("/")) {
      resolvedLogoUrl = undefined;
    }
    try {
      // The compositor fetches the source image; we feed it our data URL
      const result = await compositeImage(
        rawImageUrl,
        templateData.config,
        templateData.width,
        templateData.height,
        resolvedLogoUrl,
      );
      finalImageUrl = `data:${result.mimeType};base64,${result.buffer.toString("base64")}`;
      finalMime = result.mimeType;
    } catch (err) {
      ctx.logger?.warn?.("imageGenerate: template composite failed, returning raw image", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Persist as generated_image entity ────────────────────────────
  const slug = globalThis.crypto.randomUUID();
  const now = new Date().toISOString();
  const data: GeneratedImageData = {
    prompt,
    provider,
    rawImageUrl,
    finalImageUrl,
    templateId,
    width,
    height,
    status: "pending",
    batchId,
    createdAt: now,
    //// Neocompany Modification — audit trail of what fed the generation.
    ...(refs.resolvedIds.length > 0 ? { referenceImageIds: refs.resolvedIds } : {}),
    ...(refs.resolvedUrls.length > 0 ? { referenceImageUrls: refs.resolvedUrls } : {}),
    //// End Neocompany Modification
  };

  await ctx.entities.upsert({
    entityType: IMAGE_ENTITY_TYPE,
    scopeKind: "company",
    scopeId: runCtx.companyId,
    externalId: slug,
    title: prompt.slice(0, 80),
    status: "pending",
    data: data as unknown as Record<string, unknown>,
  });

  await ctx.activity.log({
    companyId: runCtx.companyId,
    message: `Generated image "${prompt.slice(0, 50)}"`,
    entityType: IMAGE_ENTITY_TYPE,
    entityId: slug,
  });

  const sizeKb = Math.round(Buffer.from(finalImageUrl.split(",")[1] ?? "", "base64").length / 1024);
  return {
    content: `Image generated (${width}×${height}, ${sizeKb}KB ${finalMime}). Awaiting approval. Image id: ${slug}`,
    data: {
      imageId: slug,
      prompt,
      provider,
      width,
      height,
      status: "pending",
      templateApplied: Boolean(templateData),
      finalImageUrl,
    },
  };
}
