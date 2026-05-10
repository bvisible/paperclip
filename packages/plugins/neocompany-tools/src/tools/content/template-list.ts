/**
 * Tool: templateList — list brand templates for a company.
 */

import type { ToolRunContext, ToolResult } from "@paperclipai/plugin-sdk";
import type { ToolContextAccess } from "../index.js";
import { ENTITY_TYPE, type BrandTemplateData } from "../../templates/types.js";

interface Params {
  limit?: number;
}

export async function runTemplateList(
  params: Params,
  _config: unknown,
  runCtx: ToolRunContext,
  ctxAccess: ToolContextAccess,
): Promise<ToolResult> {
  const ctx = ctxAccess.getPluginContext();

  const records = await ctx.entities.list({
    entityType: ENTITY_TYPE,
    scopeKind: "company",
    scopeId: runCtx.companyId,
    limit: params.limit ?? 50,
  });

  const templates = records.map((r) => {
    const d = r.data as unknown as BrandTemplateData;
    return {
      id: r.id,
      name: d.name,
      description: d.description,
      width: d.width,
      height: d.height,
      isDefault: d.isDefault,
      createdAt: r.createdAt,
    };
  });

  return {
    content: templates.length > 0
      ? `Found ${templates.length} template(s):\n${templates.map((t) => `- ${t.name} (${t.width}×${t.height}) id=${t.id}`).join("\n")}`
      : "No templates found for this company.",
    data: { templates },
  };
}
