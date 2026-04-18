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
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
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
}

const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";
const DEFAULT_MODEL = "gpt-image-1";

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
  // gpt-image-1 accepts sizes "1024x1024", "1024x1536", "1536x1024", "auto"
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
  timeoutMs = 12 * 60_000,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const workspace = await mkdtemp(join(tmpdir(), "codex-imagegen-"));
  const ratio = width === height ? "square" : width > height ? "landscape" : "portrait";
  const instruction =
    `Use the image_generation tool now — do not reason, do not shell out, do not list files. ` +
    `Prompt: ${prompt}. ` +
    `Aspect: ${ratio} (${width}x${height}). ` +
    `Reply with "ok" immediately after calling the tool.`;

  const env = {
    ...process.env,
    PATH: `${process.env.PATH ?? ""}:/home/ubuntu/.npm-global/bin:/usr/local/bin`,
    HOME: process.env.HOME ?? homedir(),
  };

  // Snapshot the codex generated_images dir before running so we can diff
  // and pick the PNG that belongs to this exact run.
  const codexImagesDir = join(homedir(), ".codex", "generated_images");
  const beforeSnapshot = await listPngsRecursive(codexImagesDir);

  let lastErr: unknown;
  for (const bin of CODEX_BINARY_CANDIDATES) {
    try {
      await spawnCodex(bin, instruction, workspace, env, timeoutMs);
      const afterSnapshot = await listPngsRecursive(codexImagesDir);
      const newOne = pickNewest(afterSnapshot, beforeSnapshot);
      if (!newOne) throw new Error("codex-cli finished but no new PNG was created");
      const buffer = await readFile(newOne);
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
      return { buffer, mimeType: "image/png" };
    } catch (err) {
      lastErr = err;
      // Try next binary candidate
    }
  }
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  throw lastErr instanceof Error ? lastErr : new Error(`codex-cli failed: ${String(lastErr)}`);
}

function spawnCodex(
  bin: string,
  prompt: string,
  workspace: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "exec",
      "--enable",
      "image_generation",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "-c",
      "reasoning.effort=minimal",
      "--cd",
      workspace,
      "--color",
      "never",
      prompt,
    ];
    const child = spawn(bin, args, { env, cwd: workspace });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`codex-cli timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`codex-cli exit ${code}: ${stderr.slice(0, 400)}`));
      }
    });
  });
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

export async function runImageGenerate(
  params: Params,
  _config: unknown,
  runCtx: ToolRunContext,
  ctxAccess: ToolContextAccess,
): Promise<ToolResult> {
  const ctx = ctxAccess.getPluginContext();
  const { prompt, templateId, provider = "openai", batchId, logoUrl } = params;
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
  }

  // ── Generate raw image ───────────────────────────────────────────
  let rawBuffer: Buffer;
  let mimeType: string;
  try {
    if (provider === "openai") {
      const gen = await generateWithOpenAI(ctx, apiKey!, prompt, width, height);
      rawBuffer = gen.buffer;
      mimeType = gen.mimeType;
    } else if (provider === "codex-cli") {
      const gen = await generateWithCodexCli(prompt, width, height);
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
    return { content: `Image generation failed: ${msg}`, error: msg };
  }

  const rawImageUrl = `data:${mimeType};base64,${rawBuffer.toString("base64")}`;

  // ── Optional composite with template ─────────────────────────────
  let finalImageUrl = rawImageUrl;
  let finalMime = mimeType;
  if (templateData) {
    try {
      // The compositor fetches the source image; we feed it our data URL
      const result = await compositeImage(
        rawImageUrl,
        templateData.config,
        templateData.width,
        templateData.height,
        logoUrl,
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
