/**
 * Tool: imageList — list generated images for the current company.
 */

import type { ToolRunContext, ToolResult } from "@paperclipai/plugin-sdk";
import type { ToolContextAccess } from "../index.js";
import { IMAGE_ENTITY_TYPE, type GeneratedImageData, type ImageStatus } from "../../images/types.js";

interface Params {
  status?: ImageStatus;
  batchId?: string;
  limit?: number;
  /** When true, strip the finalImageUrl/rawImageUrl (data URLs can be MB-sized). */
  includeImages?: boolean;
}

export async function runImageList(
  params: Params,
  _config: unknown,
  runCtx: ToolRunContext,
  ctxAccess: ToolContextAccess,
): Promise<ToolResult> {
  const ctx = ctxAccess.getPluginContext();
  const { status, batchId, limit = 50, includeImages = true } = params;

  const records = await ctx.entities.list({
    entityType: IMAGE_ENTITY_TYPE,
    scopeKind: "company",
    scopeId: runCtx.companyId,
    limit,
  });

  let images = records.map((r) => {
    const d = r.data as unknown as GeneratedImageData;
    const base = {
      id: r.externalId ?? r.id,
      ...d,
      createdAt: r.createdAt,
    };
    if (!includeImages) {
      return { ...base, rawImageUrl: undefined, finalImageUrl: undefined };
    }
    return base;
  });

  if (status) images = images.filter((img) => img.status === status);
  if (batchId) images = images.filter((img) => img.batchId === batchId);

  // Sort newest first
  images.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  return {
    content: `Found ${images.length} generated image(s).`,
    data: { images, count: images.length },
  };
}
