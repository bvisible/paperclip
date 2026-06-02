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
import type { SceneStyle, SceneVariantData } from "../../scenes/types.js";
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
  //// productId: externalId (`wc-<wcId>`) of a catalog product to ground
  //// the generation. When set, the worker prepends a "[Contexte produit:
  //// <name> — <shortDescription>]" line to the prompt and auto-attaches
  //// the product's gallery images as refs (up to a combined max of 5).
  productId?: string;
  //// sceneStyle / sceneVariantId: when set, skip the [Mission] directive
  //// and build the prompt from a scene_variant body instead. Variants are
  //// stored per-company via the /content/scenes editor. `autoCycleVariant`
  //// (default true when count>1) bumps the variant index between successive
  //// generations in a batch so a count of 5 produces 5 different scenes
  //// rather than 5 copies.
  sceneStyle?: string;
  sceneVariantId?: string;
  sceneVariantIndex?: number;
  autoCycleVariant?: boolean;
  //// filterRefsWhiteBg: opt-in flag. When true, every ref URL is fetched,
  //// analysed via detectWhiteBg, and only studio (white-bg) refs reach
  //// codex — sorted by white-bg ratio descending. Off by default because
  //// it adds latency (~200ms per ref) and not every brand has studio shots.
  filterRefsWhiteBg?: boolean;
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

//// Neocompany Modification — natural-language aspect description for codex.
//// gpt-image-2 (the model behind codex `image_generation`) understands these
//// shapes via prompt hints. We map common social formats:
////   1:1   → "square"
////   4:5   → "vertical portrait, 4:5 ratio" (Instagram feed)
////   9:16  → "vertical story, 9:16 ratio" (Story / Reel / TikTok)
////   16:9  → "horizontal landscape, 16:9 ratio"
////   3:2 / 2:3 → "horizontal" / "vertical" as fallbacks
//// End Neocompany Modification
function describeAspectRatio(width: number, height: number): string {
  const ratio = width / height;
  if (ratio >= 0.97 && ratio <= 1.03) return "square 1:1";
  if (ratio >= 1.7 && ratio <= 1.9) return "horizontal landscape, 16:9 ratio";
  if (ratio >= 0.5 && ratio <= 0.6) return "vertical story, 9:16 ratio";
  if (ratio >= 0.77 && ratio <= 0.83) return "vertical portrait, 4:5 ratio";
  if (ratio > 1.2) return "horizontal landscape";
  if (ratio < 0.85) return "vertical portrait";
  return "square 1:1";
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
  //// Neocompany Modification — aspect ratio hint.
  //// Codex's `image_generation` tool doesn't take width/height flags; it
  //// reads the requested aspect from the prompt instead. We compute the
  //// closest natural-language aspect (square / portrait / landscape /
  //// vertical story) so the chosen format actually reaches Codex.
  //// End Neocompany Modification
  const aspectHint = describeAspectRatio(width, height);
  const instruction = `generate image (${aspectHint}): ${prompt}`;

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
  //// Neocompany Modification — default image provider is `codex-cli`, not
  //// `openai`. NeoCompany instances have no OpenAI API key configured, so the
  //// `openai` default failed every agent imageGenerate call with
  //// MISSING_OPENAI_KEY (surfaced to the agent as a misleading HTTP 502). The
  //// Pixel autopilot already generates images via `codex-cli` (the codex
  //// binary the Hermes agents use, no separate API key), so we align the
  //// agent-facing default with the path that actually works here. A caller can
  //// still pass `provider: "openai"` explicitly on instances that set a key.
  const { templateId, provider = "codex-cli", batchId, logoUrl, productId, sceneStyle, sceneVariantId, filterRefsWhiteBg } = params;
  const sceneVariantIndex = params.sceneVariantIndex ?? 0;
  let { prompt } = params;
  let referenceImageIds = params.referenceImageIds;
  let referenceImageUrls = params.referenceImageUrls;
  let { width = 1080, height = 1080 } = params;
  let resolvedSceneVariantId: string | undefined;
  let resolvedSceneVariantName: string | undefined;

  if (!prompt && !sceneStyle && !sceneVariantId) {
    return { content: "Prompt is required (or a scene must be selected).", error: "MISSING_PROMPT" };
  }
  if (!prompt) prompt = "";

  //// Neocompany Modification — Scene + product grounding.
  ////
  //// Two paths share the product lookup:
  ////   (a) scene path — sceneStyle and/or sceneVariantId provided. Body
  ////       comes from a `scene_variant` entity, interpolated with the
  ////       product's descriptor. The user `prompt` becomes an optional
  ////       "Brief additionnel" appended at the end.
  ////   (b) productId-only path — keeps the existing [Mission]+[Product]
  ////       +[Brief] focal-point directive used when no scene is selected.
  ////
  //// Both paths dedup + cap (MAX_REFS=5) the gallery imageUrls into the
  //// refs list. Product-lookup failures are non-fatal — the worker logs
  //// a warning and continues with the user prompt.
  //// End Neocompany Modification
  const MAX_REFS = 5;

  // Resolve product first (shared by both paths).
  interface ProductRow {
    name: string;
    shortDescription?: string;
    description?: string;
    imageUrls?: string[];
    attributes?: Record<string, string>;
    categoryNames?: string[];
  }
  let productRow: ProductRow | null = null;
  if (productId) {
    try {
      const { PRODUCT_ENTITY_TYPE } = await import("../../products/types.js");
      const matches = await ctx.entities.list({
        entityType: PRODUCT_ENTITY_TYPE,
        scopeKind: "company",
        scopeId: runCtx.companyId,
        externalId: productId,
        limit: 1,
      });
      const row = matches[0];
      if (row) {
        productRow = row.data as unknown as ProductRow;
        const urls = productRow.imageUrls;
        if (Array.isArray(urls) && urls.length > 0) {
          const already = new Set(referenceImageUrls ?? []);
          const newUrls = urls.filter((u: string) => !already.has(u));
          const existingCount = (referenceImageIds?.length ?? 0) + (referenceImageUrls?.length ?? 0);
          const budget = Math.max(0, MAX_REFS - existingCount);
          if (budget > 0 && newUrls.length > 0) {
            referenceImageUrls = [...(referenceImageUrls ?? []), ...newUrls.slice(0, budget)];
          }
        }
      } else {
        ctx.logger?.warn?.("imageGenerate: productId not found in catalog", { productId });
      }
    } catch (err) {
      ctx.logger?.warn?.("imageGenerate: failed to load productId context", {
        productId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Path (a): scene-based prompt.
  if (sceneStyle || sceneVariantId) {
    try {
      const { SCENE_VARIANT_ENTITY_TYPE } = await import("../../scenes/types.js");
      const { audienceForProduct, selectVariantPool, pickVariantByIndex, formatProductDescriptor, interpolateBody } = await import("../../scenes/picker.js");
      type SceneVariantT = SceneVariantData & { id: string };

      let chosen: SceneVariantT | null = null;
      if (sceneVariantId) {
        const rows = await ctx.entities.list({
          entityType: SCENE_VARIANT_ENTITY_TYPE,
          scopeKind: "company",
          scopeId: runCtx.companyId,
          externalId: sceneVariantId,
          limit: 1,
        });
        const row = rows[0];
        if (row) {
          const data = row.data as unknown as SceneVariantData;
          chosen = { id: row.externalId ?? row.id, ...data };
        }
      }
      if (!chosen && sceneStyle) {
        const all = await ctx.entities.list({
          entityType: SCENE_VARIANT_ENTITY_TYPE,
          scopeKind: "company",
          scopeId: runCtx.companyId,
          limit: 500,
        });
        const variants = all.map((r) => {
          const data = r.data as unknown as SceneVariantData;
          return { id: r.externalId ?? r.id, ...data } as SceneVariantT;
        });
        const audience = productRow?.categoryNames ? audienceForProduct(productRow.categoryNames) : [];
        const pool = selectVariantPool({
          variants,
          style: sceneStyle as SceneStyle,
          productAudience: audience,
        });
        chosen = pickVariantByIndex(pool, sceneVariantIndex) as SceneVariantT | null;
      }

      if (chosen) {
        resolvedSceneVariantId = chosen.id;
        resolvedSceneVariantName = chosen.displayName;
        const descriptor = productRow
          ? formatProductDescriptor({ name: productRow.name, attributes: productRow.attributes ?? {} })
          : "the product shown in the reference images";
        let brand = "the brand";
        try {
          const company = await ctx.companies.get(runCtx.companyId);
          brand = company?.name ?? brand;
        } catch { /* not granted — keep default */ }
        const interpolated = interpolateBody(chosen.body, {
          descriptor,
          title: productRow?.name ?? "the product",
          brand,
          description: productRow?.shortDescription || productRow?.description?.slice(0, 240) || "",
        });
        const userBrief = prompt.trim();
        prompt = userBrief
          ? `${interpolated}\n\n[Brief additionnel] ${userBrief}`
          : interpolated;
      } else {
        ctx.logger?.warn?.("imageGenerate: no scene variant resolved, falling back to prompt", { sceneStyle, sceneVariantId });
      }
    } catch (err) {
      ctx.logger?.warn?.("imageGenerate: scene resolution failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (productRow) {
    // Path (b): legacy focal-point directive when no scene is selected.
    const context = productRow.shortDescription || productRow.description?.slice(0, 240) || "";
    prompt = [
      `[Mission] The reference images show "${productRow.name}". This product MUST be the focal point of the generated image. ` +
        `Non-negotiable composition rules:`,
      `  • The product is shown in its ENTIRETY — every edge of the product is inside the frame, ` +
        `with a clear visible margin (at least ~8% of the frame) on all four sides.`,
      `  • The product NEVER touches or crosses the frame edges, NEVER is partially cropped, ` +
        `cut off, hidden behind people/objects, faded out, or covered by overlays.`,
      `  • The product occupies a meaningful share of the composition (roughly 30%+ of the visible area) ` +
        `and is rendered in sharp focus with clean detail. Lifestyle elements stay decorative — they ` +
        `complement the product but never compete with it for the viewer's eye.`,
      `  • Stay 100% faithful to the product's exact design, silhouette, colors, materials, branding ` +
        `and proportions as shown in the reference images. Do not invent variants or alter details.`,
      `  • For footwear: frame the composition so BOTH shoes are fully visible (low-angle / waist-down / ` +
        `flat-lay / on-foot close-up are all acceptable). Avoid full-body shots that push the shoes to ` +
        `the bottom edge — prefer tight crops on the lower body or close-ups that keep the entire shoe ` +
        `inside the frame with margin underneath.`,
      `If you cannot satisfy these rules simultaneously, prioritize the product's full visibility over ` +
        `the lifestyle scene.`,
      `[Product] ${productRow.name}${context ? ` — ${context}` : ""}`,
      `[Brief] ${prompt}`,
    ].join("\n\n");
  }

  //// Neocompany Modification — White-bg ref filter.
  ////
  //// codex `-i` conditions the generation on the reference images. If a ref
  //// is itself a lifestyle shot (a model wearing the product, a coloured
  //// background, or worse — a PREVIOUS AI generation that got uploaded to
  //// the product gallery), codex copies that composition instead of the
  //// product, and the output stops resembling the actual product.
  ////
  //// Two trigger paths:
  ////   - AUTO when `productId` is set — product galleries routinely mix
  ////     studio shots with lifestyle/AI images (observed on Reed-Blake's
  ////     Bradley: 3 studio + 2 ai-pending PNGs). Studio-only is the only
  ////     way codex stays faithful. This mirrors Reed-Blake's pipeline
  ////     which ALWAYS filters via `find_white_bg_refs`.
  ////   - OPT-IN via `filterRefsWhiteBg` for manually-picked refs.
  ////
  //// Path filter: any URL under `/ai-pending/` or `/ai-generated/` is a
  //// prior AI render — dropped outright before the pixel heuristic even
  //// runs (cheap + reliable).
  ////
  //// Fallback: if filtering removes EVERY ref, we keep the originals — a
  //// lifestyle ref still beats no ref at all, and we log a warning so the
  //// tenant knows the product needs proper studio shots.
  //// End Neocompany Modification
  const shouldFilterRefs = (filterRefsWhiteBg || Boolean(productId)) &&
    Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0;
  if (shouldFilterRefs && referenceImageUrls) {
    const before = referenceImageUrls.length;
    // Heuristic 1 — drop known AI-render paths outright. This is the
    // GUARANTEED layer: prior AI renders that got uploaded to the product
    // gallery are the worst kind of ref (codex copies their composition).
    // A regex on the path is cheap and never throws.
    const AI_PATH_RE = /\/(ai-pending|ai-generated|ai-images)\//i;
    const pathFiltered = referenceImageUrls.filter((u) => !AI_PATH_RE.test(u));

    // Heuristic 2 — white-bg pixel check, BEST-EFFORT. Refines the path
    // result by keeping only studio shots, sorted by white-bg ratio. If
    // it yields nothing (fetch errors, exotic colour profiles, etc.) we
    // fall back to `pathFiltered` — never to the AI-polluted originals.
    let pixelKept: string[] = [];
    try {
      const { detectWhiteBg } = await import("../../content/white-bg-detect.js");
      const scored: Array<{ url: string; ratio: number }> = [];
      for (const url of pathFiltered) {
        try {
          let buf: Buffer | null = null;
          if (url.startsWith("data:")) {
            const comma = url.indexOf(",");
            if (comma >= 0) {
              const header = url.slice(5, comma);
              const payload = url.slice(comma + 1);
              buf = header.includes("base64")
                ? Buffer.from(payload, "base64")
                : Buffer.from(decodeURIComponent(payload), "utf8");
            }
          } else {
            const res = await ctx.http.fetch(url);
            if (!res.ok) {
              ctx.logger?.warn?.("imageGenerate: white-bg ref fetch non-ok", { url, status: res.status });
              continue;
            }
            buf = Buffer.from(await res.arrayBuffer());
          }
          if (!buf || buf.length === 0) continue;
          const verdict = await detectWhiteBg(buf);
          if (verdict.isWhiteBg) scored.push({ url, ratio: verdict.ratio });
        } catch (perUrlErr) {
          ctx.logger?.warn?.("imageGenerate: white-bg check failed for ref", {
            url,
            error: perUrlErr instanceof Error ? perUrlErr.message : String(perUrlErr),
          });
        }
      }
      scored.sort((a, b) => b.ratio - a.ratio);
      pixelKept = scored.slice(0, MAX_REFS).map((s) => s.url);
    } catch (err) {
      ctx.logger?.warn?.("imageGenerate: white-bg detector unavailable", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (pixelKept.length > 0) {
      referenceImageUrls = pixelKept;
      ctx.logger?.info?.("imageGenerate: ref filter — pixel white-bg", {
        kept: pixelKept.length, dropped: before - pixelKept.length,
        trigger: productId ? "auto-product" : "manual-toggle",
      });
    } else if (pathFiltered.length > 0) {
      // Pixel check yielded nothing — fall back to the path-filtered set
      // (AI renders still excluded). Studio fidelity may be imperfect but
      // we never feed codex a prior AI lifestyle render.
      referenceImageUrls = pathFiltered.slice(0, MAX_REFS);
      ctx.logger?.warn?.("imageGenerate: ref filter — pixel check empty, using path-filtered set", {
        kept: referenceImageUrls.length, droppedAiPaths: before - pathFiltered.length,
      });
    } else {
      ctx.logger?.warn?.("imageGenerate: ref filter removed everything — keeping originals", {
        total: before,
      });
    }
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
      //// Neocompany Modification — Templates are responsive now. We keep
      //// the caller's width/height (driven by the format picker) and let
      //// the compositor scale the template's zones proportionally.
      //// End Neocompany Modification
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
      //// Neocompany Modification — see comment above: templates are
      //// responsive, we keep the caller's format dimensions.
      //// End Neocompany Modification
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
        content: `Provider "${provider}" is not implemented. Leave provider unset to use the Codex CLI generator (codex-cli).`,
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

  //// Neocompany Modification — Aspect re-crop fallback (silent, default ON).
  //// codex / gpt-image-2 occasionally ignores the aspect-ratio hint in the
  //// prompt and returns a square PNG when 16:9 / 9:16 was requested. The
  //// subject is composed near the centre of the frame, so a centred crop
  //// to the target ratio keeps it intact. No-op when the input already
  //// matches the target within ±2%.
  //// End Neocompany Modification
  let aspectAdjustedBuffer = rawBuffer;
  try {
    const { centerCropToAspect } = await import("../../content/aspect-recrop.js");
    const recrop = await centerCropToAspect(rawBuffer, width, height);
    if (recrop.cropped) {
      ctx.logger?.info?.("imageGenerate: aspect re-cropped", {
        to: `${recrop.width}x${recrop.height}`,
        targetRatio: `${width}:${height}`,
      });
      aspectAdjustedBuffer = recrop.buffer;
    }
  } catch (err) {
    ctx.logger?.warn?.("imageGenerate: aspect re-crop failed, keeping raw", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const rawImageUrl = `data:${mimeType};base64,${aspectAdjustedBuffer.toString("base64")}`;

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
      //// Neocompany Modification — pass the CALLER's width/height to the
      //// compositor, not templateData.{width,height}. Templates are now
      //// responsive (zones stored as percentages) — letting them dictate
      //// the canvas would defeat the Format picker.
      //// End Neocompany Modification
      const result = await compositeImage(
        rawImageUrl,
        templateData.config,
        width,
        height,
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
    ...(productId ? { productId } : {}),
    ...(sceneStyle ? { sceneStyle } : {}),
    ...(resolvedSceneVariantId ? { sceneVariantId: resolvedSceneVariantId } : {}),
    ...(resolvedSceneVariantName ? { sceneVariantName: resolvedSceneVariantName } : {}),
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
