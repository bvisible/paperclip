/**
 * Tool: imageDelete — remove a generated image.
 */

import type { ToolRunContext, ToolResult } from "@paperclipai/plugin-sdk";
import type { ToolContextAccess } from "../index.js";
import { IMAGE_ENTITY_TYPE } from "../../images/types.js";

interface Params {
  imageId: string;
}

export async function runImageDelete(
  params: Params,
  _config: unknown,
  runCtx: ToolRunContext,
  ctxAccess: ToolContextAccess,
): Promise<ToolResult> {
  const ctx = ctxAccess.getPluginContext();
  const { imageId } = params;

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

  await ctx.entities.delete({ id: record.id });
  await ctx.activity.log({
    companyId: runCtx.companyId,
    message: `Image ${imageId} deleted`,
    entityType: IMAGE_ENTITY_TYPE,
    entityId: imageId,
  });

  return { content: `Image ${imageId} deleted.`, data: { imageId } };
}
