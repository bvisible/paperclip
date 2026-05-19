//// Neocompany Modification — wcGetProduct tool.
//// Returns the full ProductData for a single product, looked up by
//// externalId (`wc-<id>`). Used by the Generate dialog to attach the
//// product's images as references and by agents when they need the full
//// description / attributes for a content piece.
//// End Neocompany Modification

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { ToolContextAccess } from "../index.js";
import { PRODUCT_ENTITY_TYPE, type ProductData } from "../../products/types.js";

export interface WcGetProductParams {
  productId: string;
}

export async function runWcGetProduct(
  params: WcGetProductParams,
  _config: unknown,
  runCtx: ToolRunContext,
  ctxAccess: ToolContextAccess,
): Promise<ToolResult> {
  const ctx = ctxAccess.getPluginContext();
  const productId = (params.productId ?? "").trim();
  if (!productId) {
    return { content: "productId is required.", error: "MISSING_PRODUCT_ID" };
  }
  const matches = await ctx.entities.list({
    entityType: PRODUCT_ENTITY_TYPE,
    scopeKind: "company",
    scopeId: runCtx.companyId,
    externalId: productId,
    limit: 1,
  });
  const row = matches[0];
  if (!row) {
    return { content: `Product "${productId}" not found.`, error: "PRODUCT_NOT_FOUND" };
  }
  const data = row.data as unknown as ProductData;
  return {
    content:
      `${data.name} — ${data.shortDescription || data.description.slice(0, 160)}` +
      (data.price ? ` (${data.price} ${data.currency ?? ""})` : ""),
    data: {
      id: row.externalId ?? row.id,
      ...data,
    } as unknown as Record<string, unknown>,
  };
}

export const wcGetProductDeclaration = {
  displayName: "Get product details",
  description:
    "Fetch the full details of a single product from the locally-synced catalog: name, description, attributes, categories, image URLs. Use this before generating content for a specific product so the agent can ground the prompt with accurate copy.",
  parametersSchema: {
    type: "object",
    properties: {
      productId: {
        type: "string",
        description: "Product externalId (e.g. `wc-123`) — use wcListProducts to discover it.",
      },
    },
    required: ["productId"],
  } as const,
};
