/**
 * Tool: imageApprove — approve or reject a generated image.
 */

import type { ToolRunContext, ToolResult } from "@paperclipai/plugin-sdk";
import type { ToolContextAccess } from "../index.js";
import { IMAGE_ENTITY_TYPE, type GeneratedImageData, type ImageStatus } from "../../images/types.js";

interface Params {
  imageId: string;
  status: ImageStatus;
  feedback?: string;
}

export async function runImageApprove(
  params: Params,
  _config: unknown,
  runCtx: ToolRunContext,
  ctxAccess: ToolContextAccess,
): Promise<ToolResult> {
  const ctx = ctxAccess.getPluginContext();
  const { imageId, status, feedback } = params;

  const matches = await ctx.entities.list({
    entityType: IMAGE_ENTITY_TYPE,
    scopeKind: "company",
    scopeId: runCtx.companyId,
    externalId: imageId,
    limit: 1,
  });
  const record = matches[0];
  if (!record) {
    return { content: `Image "${imageId}" not found.`, error: "IMAGE_NOT_FOUND" };
  }

  const prev = record.data as unknown as GeneratedImageData;
  const next: GeneratedImageData = {
    ...prev,
    status,
    feedback: feedback ?? prev.feedback,
  };

  await ctx.entities.upsert({
    entityType: IMAGE_ENTITY_TYPE,
    scopeKind: "company",
    scopeId: runCtx.companyId,
    externalId: imageId,
    title: record.title ?? next.prompt.slice(0, 80),
    status,
    data: next as unknown as Record<string, unknown>,
  });

  await ctx.activity.log({
    companyId: runCtx.companyId,
    message: `Image ${imageId} ${status}`,
    entityType: IMAGE_ENTITY_TYPE,
    entityId: imageId,
    metadata: { feedback },
  });

  return {
    content: `Image ${imageId} is now ${status}.`,
    data: { imageId, status, feedback },
  };
}
