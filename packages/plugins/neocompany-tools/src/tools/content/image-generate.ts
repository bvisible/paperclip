/**
 * Tool: imageGenerate — AI image generation with optional template overlay.
 *
 * Uses the OpenAI Images API (model `gpt-image-1` by default) with the
 * platform-level API key stored in `plugin_config.openaiApiKeyRef`.
 * If a `templateId` is provided, the generated image is composited with
 * the brand template via Sharp before being stored.
 *
 * The resulting entity (`generated_image`, scope=company) is created with
 * status=pending so a reviewer can approve or reject it. Approved images
 * become the stock an agent can pull from when publishing.
 */

import type { ToolRunContext, ToolResult, PluginContext } from "@paperclipai/plugin-sdk";
import type { ToolContextAccess } from "../index.js";
import { IMAGE_ENTITY_TYPE, type GeneratedImageData, type ImageProvider } from "../../images/types.js";
import { ENTITY_TYPE as TEMPLATE_ENTITY_TYPE, type BrandTemplateData } from "../../templates/types.js";
import { compositeImage } from "../../templates/compositor.js";

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

  // ── Resolve platform API key ─────────────────────────────────────
  const platform = (await ctx.config.get()) as { openaiApiKeyRef?: string } | null;
  const apiKey = await resolveSecret(ctx, platform?.openaiApiKeyRef);
  if (!apiKey) {
    return {
      content: "Platform OpenAI API key is not configured. Ask an admin to set `openaiApiKeyRef` in the plugin's platform settings.",
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
      const gen = await generateWithOpenAI(ctx, apiKey, prompt, width, height);
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
