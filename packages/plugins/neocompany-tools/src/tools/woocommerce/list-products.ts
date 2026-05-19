//// Neocompany Modification — wcListProducts tool.
//// Reads from the locally-synced catalog (plugin_entities, entityType
//// "product") rather than hitting the WC REST API directly. This makes the
//// listing fast, tenant-scoped (via registry.listEntities), and survives a
//// WC outage. Supports search, category filter, status filter, and
//// pagination.
//// End Neocompany Modification

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { ToolContextAccess } from "../index.js";
import {
  PRODUCT_ENTITY_TYPE,
  type ProductData,
  type ProductStatus,
} from "../../products/types.js";

export interface WcListProductsParams {
  search?: string;
  /** Category externalId (`wc-cat-<id>`). */
  categoryId?: string;
  status?: ProductStatus | "any";
  limit?: number;
  offset?: number;
}

export interface ListedProduct {
  id: string;
  wcId: number;
  name: string;
  slug: string;
  status: ProductStatus;
  price?: string;
  currency?: string;
  permalink?: string;
  categoryIds: string[];
  categoryNames: string[];
  thumbnailUrl?: string;
  imageCount: number;
}

export async function runWcListProducts(
  params: WcListProductsParams,
  _config: unknown,
  runCtx: ToolRunContext,
  ctxAccess: ToolContextAccess,
): Promise<ToolResult> {
  const ctx = ctxAccess.getPluginContext();
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 500);
  const offset = Math.max(params.offset ?? 0, 0);
  const statusFilter = params.status ?? "any";
  const searchTerm = (params.search ?? "").trim().toLowerCase();

  // Pull a larger window than `limit` because we apply search / category /
  // status filters in memory. The catalog typically holds a few hundred
  // products per tenant so this stays cheap.
  const rows = await ctx.entities.list({
    entityType: PRODUCT_ENTITY_TYPE,
    scopeKind: "company",
    scopeId: runCtx.companyId,
    limit: 5000,
  });

  let products: ListedProduct[] = rows.map((r) => {
    const d = r.data as unknown as ProductData;
    return {
      id: r.externalId ?? r.id,
      wcId: d.wcId,
      name: d.name,
      slug: d.slug,
      status: d.status,
      price: d.price,
      currency: d.currency,
      permalink: d.permalink,
      categoryIds: d.categoryIds ?? [],
      categoryNames: d.categoryNames ?? [],
      thumbnailUrl: d.imageUrls?.[0],
      imageCount: d.imageUrls?.length ?? 0,
    };
  });

  if (statusFilter !== "any") {
    products = products.filter((p) => p.status === statusFilter);
  } else {
    // Default — hide soft-deleted unless explicitly requested.
    products = products.filter((p) => p.status !== "deleted");
  }

  if (params.categoryId) {
    products = products.filter((p) => p.categoryIds.includes(params.categoryId!));
  }

  if (searchTerm) {
    products = products.filter((p) =>
      p.name.toLowerCase().includes(searchTerm) ||
      p.slug.toLowerCase().includes(searchTerm),
    );
  }

  // Sort by name for deterministic UI ordering.
  products.sort((a, b) => a.name.localeCompare(b.name));

  const total = products.length;
  const paged = products.slice(offset, offset + limit);

  return {
    content: `Found ${total} product(s)${searchTerm ? ` matching "${searchTerm}"` : ""}${
      params.categoryId ? ` in category ${params.categoryId}` : ""
    }. Returning ${paged.length}.`,
    data: {
      products: paged,
      total,
      limit,
      offset,
    } as unknown as Record<string, unknown>,
  };
}

export const wcListProductsDeclaration = {
  displayName: "List products from catalog",
  description:
    "List products from the locally-synced WooCommerce catalog. Supports search by name/slug, category filter (use category externalId from the catalog), status filter, and pagination. Call this when an agent needs to plan content around a specific product or collection.",
  parametersSchema: {
    type: "object",
    properties: {
      search: { type: "string", description: "Substring match on product name or slug." },
      categoryId: {
        type: "string",
        description: "Category externalId (e.g. `wc-cat-42`). Use wcListCategories or pull from a product to discover ids.",
      },
      status: {
        type: "string",
        enum: ["publish", "draft", "pending", "private", "deleted", "any"],
        description: "Product status filter. Defaults to all non-deleted.",
        default: "any",
      },
      limit: { type: "number", description: "Page size (default 50, max 500).", default: 50 },
      offset: { type: "number", description: "Pagination offset.", default: 0 },
    },
  } as const,
};
