/**
 * Tool: templateCreate — create a new brand template for a company.
 */

import type { ToolRunContext, ToolResult } from "@paperclipai/plugin-sdk";
import type { ToolContextAccess } from "../index.js";
import {
  DIMENSION_PRESETS,
  DEFAULT_TEMPLATE_CONFIG,
  ENTITY_TYPE,
  type TemplateConfig,
  type BrandTemplateData,
} from "../../templates/types.js";

interface Params {
  name: string;
  description?: string;
  preset?: string;
  width?: number;
  height?: number;
  config?: Partial<TemplateConfig>;
}

export async function runTemplateCreate(
  params: Params,
  _config: unknown,
  runCtx: ToolRunContext,
  ctxAccess: ToolContextAccess,
): Promise<ToolResult> {
  const ctx = ctxAccess.getPluginContext();
  const { name, description, preset, config: partialConfig } = params;
  let { width, height } = params;

  // Resolve dimension preset
  if (preset) {
    const match = DIMENSION_PRESETS.find((p) => p.key === preset);
    if (match) {
      width = width ?? match.width;
      height = height ?? match.height;
    }
  }
  if (!width || !height) {
    return {
      content: "Missing width/height. Provide dimensions or a preset (e.g. 'instagram-square').",
      error: "MISSING_DIMENSIONS",
    };
  }

  const config: TemplateConfig = {
    ...DEFAULT_TEMPLATE_CONFIG,
    ...(partialConfig ?? {}),
  };

  const data: BrandTemplateData = {
    name,
    description,
    width,
    height,
    config,
    isDefault: false,
  };

  const record = await ctx.entities.upsert({
    entityType: ENTITY_TYPE,
    scopeKind: "company",
    scopeId: runCtx.companyId,
    title: name,
    status: "active",
    data: data as unknown as Record<string, unknown>,
  });

  return {
    content: `Template "${name}" created (${width}×${height}).`,
    data: { templateId: record.id, name, width, height },
  };
}
