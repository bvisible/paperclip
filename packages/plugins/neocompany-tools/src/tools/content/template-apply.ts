/**
 * Tool: templateApply — apply a brand template to a source image.
 *
 * Returns the composited image as a base64 data URL since the plugin
 * SDK does not provide a file upload API. The data URL can be used
 * directly in markdown or saved by the agent.
 */

import type { ToolRunContext, ToolResult } from "@paperclipai/plugin-sdk";
import type { ToolContextAccess } from "../index.js";
import { ENTITY_TYPE, type BrandTemplateData } from "../../templates/types.js";
import { compositeImage } from "../../templates/compositor.js";

interface Params {
  templateId: string;
  sourceImageUrl: string;
  logoUrl?: string;
}

export async function runTemplateApply(
  params: Params,
  _config: unknown,
  runCtx: ToolRunContext,
  ctxAccess: ToolContextAccess,
): Promise<ToolResult> {
  const ctx = ctxAccess.getPluginContext();
  const { templateId, sourceImageUrl, logoUrl } = params;

  // Fetch the template entity (templateId is the externalId stable slug)
  const externalMatches = await ctx.entities.list({
    entityType: ENTITY_TYPE,
    scopeKind: "company",
    scopeId: runCtx.companyId,
    externalId: templateId,
    limit: 1,
  });
  let record = externalMatches[0] as typeof externalMatches[0] | undefined;
  // Fallback: legacy row referenced by internal UUID
  if (!record) {
    const all = await ctx.entities.list({
      entityType: ENTITY_TYPE,
      scopeKind: "company",
      scopeId: runCtx.companyId,
    });
    record = all.find((r) => r.id === templateId);
  }
  if (!record) {
    return {
      content: `Template "${templateId}" not found.`,
      error: "TEMPLATE_NOT_FOUND",
    };
  }

  const data = record.data as unknown as BrandTemplateData;

  try {
    const result = await compositeImage(
      sourceImageUrl,
      data.config,
      data.width,
      data.height,
      logoUrl,
    );

    // Return as base64 data URL (no file upload API available)
    const base64 = result.buffer.toString("base64");
    const dataUrl = `data:${result.mimeType};base64,${base64}`;

    // Truncate the data field to avoid huge payloads in the tool result
    // that would be stored in chat segments. The full dataUrl can be
    // very large (megabytes), so we only include metadata in the
    // structured data and mention the dataUrl size.
    const sizeKb = Math.round(result.buffer.length / 1024);

    return {
      content: `Template "${data.name}" applied to image (${data.width}×${data.height}, ${sizeKb}KB PNG). The composited image is available as a data URL in the result data.`,
      data: {
        templateId,
        templateName: data.name,
        width: data.width,
        height: data.height,
        sizeKb,
        mimeType: result.mimeType,
        // Include the full dataUrl so callers that need it can access it
        processedImageDataUrl: dataUrl,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: `Failed to apply template: ${msg}`,
      error: msg,
    };
  }
}
