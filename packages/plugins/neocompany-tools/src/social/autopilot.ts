/**
 * Pixel autopilot cron — keeps each company's draft queue filled according
 * to its editorial strategy.
 *
 * Runs every 15 minutes (declared in manifest.jobs). The tick:
 *   1. For every company with a saved editorial_strategy AND at least one
 *      default channel, count posts currently in the "live pipeline"
 *      (pending_review + approved + scheduled) per channel.
 *   2. Compute target per channel: `postsPerWeek × leadTimeWeeks`, capped
 *      so the TOTAL pending_review count stays <= `queueSize`.
 *   3. For each channel that is below its target, generate one draft
 *      (capped at 2 drafts per tick across the whole tick so codex-cli
 *      never saturates).
 *   4. A draft is created by:
 *      - Picking a library image tagged for this channel (or any approved
 *        image if no tag match).
 *      - If the library has no suitable image, queuing a codex-cli
 *        generation inline and waiting for it (~60-90s).
 *      - Drafting a caption from the strategy's voiceGuidelines + a
 *        topic hint derived from the company/brand context.
 *      - Calling draftCreate with the chosen channel and a proposedAt
 *        that aligns with the next publishingSlot.
 *
 * Pixel the agent does NOT run this — the cron is a plain worker job. The
 * "intelligence" upgrade (delegating draft authoring to the Pixel agent
 * via ctx.agents.sessions) is deferred to the phase where agents have a
 * proper per-agent claimed API key.
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";
import {
  EDITORIAL_STRATEGY_ENTITY_TYPE,
  EDITORIAL_STRATEGY_SINGLETON_EXTERNAL_ID,
  SOCIAL_POST_ENTITY_TYPE,
  type EditorialStrategyData,
  type EditorialStrategyPublishingSlot,
  type SocialPostData,
  type SocialProviderKey,
} from "./types.js";
import {
  IMAGE_ENTITY_TYPE,
  type GeneratedImageData,
} from "../images/types.js";

const MAX_NEW_DRAFTS_PER_TICK = 2;

interface AutopilotReport {
  companies: number;
  planned: number;
  created: number;
  skipped: number;
}

export async function runPixelAutopilotTick(
  ctx: PluginContext,
): Promise<AutopilotReport> {
  const report: AutopilotReport = {
    companies: 0,
    planned: 0,
    created: 0,
    skipped: 0,
  };

  const companies = await ctx.companies.list();
  for (const company of companies) {
    const strategyRows = await ctx.entities.list({
      entityType: EDITORIAL_STRATEGY_ENTITY_TYPE,
      scopeKind: "company",
      scopeId: company.id,
      externalId: EDITORIAL_STRATEGY_SINGLETON_EXTERNAL_ID,
      limit: 1,
    });
    const strategyRow = strategyRows[0];
    if (!strategyRow) continue;
    const strategy = strategyRow.data as unknown as EditorialStrategyData;
    if (!strategy.defaultChannels || strategy.defaultChannels.length === 0) continue;

    report.companies += 1;

    // Count current live posts per channel.
    const postRows = await ctx.entities.list({
      entityType: SOCIAL_POST_ENTITY_TYPE,
      scopeKind: "company",
      scopeId: company.id,
      limit: 500,
    });
    const liveByChannel = new Map<string, number>();
    let totalPendingReview = 0;
    for (const row of postRows) {
      const data = row.data as unknown as SocialPostData;
      if (!["pending_review", "approved", "scheduled"].includes(data.status)) continue;
      const key = data.channel.channelKey;
      liveByChannel.set(key, (liveByChannel.get(key) ?? 0) + 1);
      if (data.status === "pending_review") totalPendingReview += 1;
    }

    // Compute gap per channel, respecting queueSize ceiling.
    const queueSlack = Math.max(0, strategy.queueSize - totalPendingReview);
    let budget = Math.min(MAX_NEW_DRAFTS_PER_TICK, queueSlack);
    if (budget <= 0) continue;

    for (const channel of strategy.defaultChannels) {
      if (budget <= 0) break;
      const perWeek = strategy.postsPerWeek[channel.channelKey] ?? 0;
      if (perWeek <= 0) continue;
      const target = perWeek * Math.max(1, strategy.leadTimeWeeks);
      const current = liveByChannel.get(channel.channelKey) ?? 0;
      const missing = Math.max(0, target - current);
      if (missing <= 0) continue;

      const toCreate = Math.min(missing, budget);
      for (let i = 0; i < toCreate; i++) {
        report.planned += 1;
        try {
          const created = await createDraftForChannel(ctx, company.id, strategy, channel.provider, channel.channelKey);
          if (created) report.created += 1;
          else report.skipped += 1;
        } catch (err) {
          report.skipped += 1;
          ctx.logger?.warn?.(
            `[pixel-autopilot] failed to create draft for ${company.id} / ${channel.channelKey}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        budget -= 1;
      }
    }
  }

  return report;
}

async function createDraftForChannel(
  ctx: PluginContext,
  companyId: string,
  strategy: EditorialStrategyData,
  provider: SocialProviderKey,
  channelKey: string,
): Promise<boolean> {
  // 1) Try to find an approved image we can reuse. Prefer the oldest
  //    approved image not yet bound to another scheduled post — dead
  //    simple heuristic for now.
  const imageRows = await ctx.entities.list({
    entityType: IMAGE_ENTITY_TYPE,
    scopeKind: "company",
    scopeId: companyId,
    limit: 500,
  });
  const approved = imageRows
    .map((r) => ({ id: r.externalId ?? r.id, data: r.data as unknown as GeneratedImageData, createdAt: r.createdAt }))
    .filter((r) => r.data.status === "approved")
    .sort((a, b) => (a.data.createdAt ?? "").localeCompare(b.data.createdAt ?? ""));

  // Track which image IDs are already bound to live posts to avoid reuse.
  const postRows = await ctx.entities.list({
    entityType: SOCIAL_POST_ENTITY_TYPE,
    scopeKind: "company",
    scopeId: companyId,
    limit: 500,
  });
  const boundImageIds = new Set<string>();
  for (const row of postRows) {
    const data = row.data as unknown as SocialPostData;
    if (["pending_review", "approved", "scheduled"].includes(data.status) && data.imageId) {
      boundImageIds.add(data.imageId);
    }
  }
  const availableApproved = approved.filter((img) => !boundImageIds.has(img.id));

  let imageId: string | undefined;
  let dimensions: { width: number; height: number } | undefined;
  let imagePrompt: string | undefined;

  if (availableApproved.length > 0) {
    const pick = availableApproved[0]!;
    imageId = pick.id;
    dimensions = { width: pick.data.width, height: pick.data.height };
    imagePrompt = pick.data.prompt;
  } else {
    // 2) No reusable library image — generate a fresh one. We don't run
    //    Pixel via ctx.agents.sessions; we call the imageGenerate logic
    //    directly for speed and determinism.
    const prompt = buildFallbackGenerationPrompt(strategy);
    const dims = dimensionsForProvider(provider);
    try {
      const { runImageGenerate } = await import("../tools/content/image-generate.js");
      const result = await runImageGenerate(
        { prompt, provider: "codex-cli", width: dims.width, height: dims.height },
        {},
        {
          runId: globalThis.crypto.randomUUID(),
          companyId,
          projectId: companyId,
          agentId: "00000000-0000-0000-0000-000000000000",
        },
        // imageGenerate only reads getPluginContext from ctxAccess, so we
        // hand over a minimal shim cast to the full type.
        ({
          getPluginContext: () => ctx,
          getToolConfig: async <T>(_c: string, _t: string, d: T) => d,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any),
      );
      if (!result.error) {
        imageId = (result.data as { imageId?: string } | undefined)?.imageId;
        dimensions = dims;
        imagePrompt = prompt;
        // Auto-approve the image since autopilot is the one authoring this
        // batch; the human reviews the post, not each intermediate image.
        if (imageId) {
          const { runImageApprove } = await import("../tools/content/image-approve.js");
          await runImageApprove(
            { imageId, status: "approved" },
            {},
            {
              runId: globalThis.crypto.randomUUID(),
              companyId,
              projectId: companyId,
              agentId: "00000000-0000-0000-0000-000000000000",
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ({ getPluginContext: () => ctx } as any),
          );
        }
      }
    } catch {
      return false;
    }
  }

  // 3) Pick the next publishing slot strictly in the future.
  const proposedAt = nextPublishingSlot(strategy.publishingSlots, new Date());

  // 4) Build a caption. Lean on the voice guidelines + prompt hint.
  const captionPreview = imagePrompt?.slice(0, 120) ?? "";
  const text = buildCaption(strategy, captionPreview);

  // 5) Create the draft (status = pending_review).
  const slug = globalThis.crypto.randomUUID();
  const now = new Date().toISOString();
  const draft: SocialPostData = {
    text,
    imageId,
    dimensions,
    channel: { provider, channelKey },
    proposedAt,
    status: "pending_review",
    generatedByAgentId: "pixel-autopilot",
    createdAt: now,
  };
  await ctx.entities.upsert({
    entityType: SOCIAL_POST_ENTITY_TYPE,
    scopeKind: "company",
    scopeId: companyId,
    externalId: slug,
    title: text.slice(0, 80),
    status: "pending_review",
    data: draft as unknown as Record<string, unknown>,
  });
  await ctx.activity.log({
    companyId,
    message: `Pixel autopilot drafted a ${provider} post (${slug})`,
    entityType: SOCIAL_POST_ENTITY_TYPE,
    entityId: slug,
  });
  return true;
}

function dimensionsForProvider(provider: SocialProviderKey): { width: number; height: number } {
  switch (provider) {
    case "linkedin":
      return { width: 1200, height: 627 };
    case "facebook":
      return { width: 1200, height: 630 };
    case "instagram":
      return { width: 1080, height: 1080 };
    default:
      return { width: 1080, height: 1080 };
  }
}

function buildFallbackGenerationPrompt(strategy: EditorialStrategyData): string {
  const voice = (strategy.voiceGuidelines ?? "").trim().slice(0, 200);
  const base = voice
    ? `Brand social post visual. Voice: ${voice}`
    : "Brand social post visual, clean modern aesthetic, professional but warm.";
  return base;
}

function buildCaption(strategy: EditorialStrategyData, imagePromptPreview: string): string {
  const voice = (strategy.voiceGuidelines ?? "").trim();
  const lines: string[] = [];
  if (imagePromptPreview) {
    lines.push(imagePromptPreview);
  } else {
    lines.push("Pixel prepared this draft. Edit before approving.");
  }
  if (voice) {
    lines.push("");
    lines.push(`Voice: ${voice.slice(0, 100)}`);
  }
  return lines.join("\n").slice(0, 2500);
}

function nextPublishingSlot(
  slots: EditorialStrategyPublishingSlot[],
  from: Date,
): string {
  if (!slots || slots.length === 0) {
    // Default 2 days out at 10h if no slots defined.
    const fallback = new Date(from);
    fallback.setDate(fallback.getDate() + 2);
    fallback.setHours(10, 0, 0, 0);
    return fallback.toISOString();
  }
  // Find the soonest slot in the next 14 days.
  const candidates: Date[] = [];
  for (let offset = 0; offset < 14; offset++) {
    const day = new Date(from);
    day.setDate(from.getDate() + offset);
    const dow = day.getDay();
    for (const slot of slots) {
      if (slot.dayOfWeek !== dow) continue;
      const candidate = new Date(day);
      candidate.setHours(slot.hour, slot.minute ?? 0, 0, 0);
      if (candidate.getTime() > from.getTime()) candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return (candidates[0] ?? new Date(from.getTime() + 24 * 60 * 60 * 1000)).toISOString();
}
