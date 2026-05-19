//// Neocompany Modification — WooCommerce catalog sync.
////
//// Walks /wp-json/wc/v3/products + /products/categories and upserts every
//// row into plugin_entities (entityType "product" / "product_category",
//// scope=company). Idempotent thanks to externalId-based dedup
//// (wc-<id> / wc-cat-<id>). Products that disappear from the store get a
//// soft-delete (status="deleted") so any generated_image referencing the
//// product can still resolve a name.
////
//// Triggerable two ways:
////   - bridge action `productCatalogSync` (manual "Sync" button)
////   - daily cron job `wc-catalog-sync` (idempotent re-sync)
//// End Neocompany Modification

import type { ToolResult, ToolRunContext, PluginContext } from "@paperclipai/plugin-sdk";
import type { ToolContextAccess } from "../index.js";
import { wcFetchWithHeaders, WordPressFetchError, type WordPressConfig } from "../../adapters/wordpress.js";
import {
  PRODUCT_ENTITY_TYPE,
  PRODUCT_CATEGORY_ENTITY_TYPE,
  type ProductData,
  type ProductCategoryData,
  type ProductStatus,
  wcProductExternalId,
  wcCategoryExternalId,
} from "../../products/types.js";

const PER_PAGE = 100;
const MAX_PAGES = 50; // hard ceiling — 5000 products before we bail out

interface WcProductImage {
  id: number;
  src: string;
  name?: string;
  alt?: string;
}

interface WcProductCategory {
  id: number;
  name: string;
  slug: string;
}

interface WcProductTag {
  id: number;
  name: string;
  slug: string;
}

interface WcProductAttribute {
  id?: number;
  name: string;
  options?: string[];
  visible?: boolean;
}

interface WcProductRow {
  id: number;
  name: string;
  slug: string;
  permalink?: string;
  date_modified_gmt?: string;
  description?: string;
  short_description?: string;
  sku?: string;
  price?: string;
  regular_price?: string;
  sale_price?: string;
  status?: string;
  categories?: WcProductCategory[];
  tags?: WcProductTag[];
  images?: WcProductImage[];
  attributes?: WcProductAttribute[];
}

interface WcCategoryRow {
  id: number;
  name: string;
  slug: string;
  parent?: number;
  count?: number;
}

interface WcStoreSettings {
  id?: string;
  value?: string;
}

export interface ProductCatalogSyncParams {
  /** Force a full sync even if WC reports the same date_modified. Default false. */
  force?: boolean;
}

export interface ProductCatalogSyncResult {
  upserted: number;
  softDeleted: number;
  categoriesUpserted: number;
  scanned: number;
  errors: string[];
}

function stripHtml(html: string | undefined): string {
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function coerceStatus(raw: string | undefined): ProductStatus {
  if (raw === "publish" || raw === "draft" || raw === "pending" || raw === "private") return raw;
  return "draft";
}

function flattenAttributes(attrs: WcProductAttribute[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of attrs ?? []) {
    if (!a.name) continue;
    const value = (a.options ?? []).map((o) => String(o)).join(", ");
    if (value) out[a.name] = value;
  }
  return out;
}

async function fetchCurrency(config: WordPressConfig): Promise<string | undefined> {
  try {
    const res = await wcFetchWithHeaders<WcStoreSettings[] | WcStoreSettings>(
      config,
      "/settings/general/woocommerce_currency",
      {},
    );
    const data = res.data as WcStoreSettings;
    return typeof data?.value === "string" ? data.value : undefined;
  } catch {
    // Currency is best-effort — the catalog sync can still work without it.
    return undefined;
  }
}

async function syncCategories(
  ctx: PluginContext,
  companyId: string,
  config: WordPressConfig,
): Promise<{ upserted: number; errors: string[] }> {
  const errors: string[] = [];
  let upserted = 0;
  const now = new Date().toISOString();
  let page = 1;
  while (page <= MAX_PAGES) {
    let res;
    try {
      res = await wcFetchWithHeaders<WcCategoryRow[]>(config, "/products/categories", {
        query: { per_page: PER_PAGE, page },
      });
    } catch (err) {
      const message =
        err instanceof WordPressFetchError ? `WC ${err.status}: ${err.message}` : String(err);
      errors.push(`categories page ${page}: ${message}`);
      break;
    }
    const rows = Array.isArray(res.data) ? res.data : [];
    for (const cat of rows) {
      const data: ProductCategoryData = {
        source: "woocommerce",
        wcId: cat.id,
        name: cat.name,
        slug: cat.slug,
        parentId: cat.parent && cat.parent > 0 ? wcCategoryExternalId(cat.parent) : null,
        count: cat.count ?? 0,
        syncedAt: now,
      };
      try {
        await ctx.entities.upsert({
          entityType: PRODUCT_CATEGORY_ENTITY_TYPE,
          scopeKind: "company",
          scopeId: companyId,
          externalId: wcCategoryExternalId(cat.id),
          title: cat.name,
          status: "active",
          data: data as unknown as Record<string, unknown>,
        });
        upserted += 1;
      } catch (err) {
        errors.push(`category ${cat.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (rows.length < PER_PAGE || page >= res.totalPages) break;
    page += 1;
  }
  return { upserted, errors };
}

export async function runProductCatalogSync(
  params: ProductCatalogSyncParams,
  config: WordPressConfig,
  runCtx: ToolRunContext,
  ctxAccess: ToolContextAccess,
): Promise<ToolResult> {
  const ctx = ctxAccess.getPluginContext();
  const errors: string[] = [];
  const now = new Date().toISOString();

  const [currency, catSync] = await Promise.all([
    fetchCurrency(config),
    syncCategories(ctx, runCtx.companyId, config),
  ]);
  errors.push(...catSync.errors);

  // Snapshot existing product externalIds so we can compute the soft-delete
  // set after walking the WC pages.
  const existingRows = await ctx.entities.list({
    entityType: PRODUCT_ENTITY_TYPE,
    scopeKind: "company",
    scopeId: runCtx.companyId,
    limit: 5000,
  });
  const existingByExternal = new Map<string, (typeof existingRows)[number]>();
  for (const row of existingRows) {
    if (row.externalId) existingByExternal.set(row.externalId, row);
  }

  const seen = new Set<string>();
  let upserted = 0;
  let scanned = 0;

  let page = 1;
  while (page <= MAX_PAGES) {
    let res;
    try {
      res = await wcFetchWithHeaders<WcProductRow[]>(config, "/products", {
        query: { per_page: PER_PAGE, page, status: "any" },
      });
    } catch (err) {
      const message =
        err instanceof WordPressFetchError ? `WC ${err.status}: ${err.message}` : String(err);
      errors.push(`products page ${page}: ${message}`);
      break;
    }
    const rows = Array.isArray(res.data) ? res.data : [];
    scanned += rows.length;

    for (const row of rows) {
      const externalId = wcProductExternalId(row.id);
      seen.add(externalId);

      const existing = existingByExternal.get(externalId);
      const wcModifiedAt = row.date_modified_gmt
        ? new Date(`${row.date_modified_gmt}Z`).toISOString()
        : undefined;
      if (!params.force && existing) {
        const prev = existing.data as unknown as ProductData;
        if (prev.wcModifiedAt && wcModifiedAt && prev.wcModifiedAt === wcModifiedAt) {
          // Up-to-date — skip the upsert to avoid bumping updatedAt for nothing.
          continue;
        }
      }

      const categoryIds = (row.categories ?? []).map((c) => wcCategoryExternalId(c.id));
      const categoryNames = (row.categories ?? []).map((c) => c.name);
      const tags = (row.tags ?? []).map((t) => t.name);
      const imageUrls = (row.images ?? [])
        .map((img) => img.src)
        .filter((u): u is string => typeof u === "string" && u.length > 0);

      const data: ProductData = {
        source: "woocommerce",
        wcId: row.id,
        permalink: row.permalink,
        name: row.name,
        slug: row.slug,
        description: stripHtml(row.description),
        shortDescription: stripHtml(row.short_description),
        sku: row.sku || undefined,
        price: row.price || undefined,
        salePrice: row.sale_price || undefined,
        regularPrice: row.regular_price || undefined,
        currency,
        status: coerceStatus(row.status),
        categoryIds,
        categoryNames,
        tags,
        imageUrls,
        attributes: flattenAttributes(row.attributes),
        wcModifiedAt,
        syncedAt: now,
      };

      try {
        await ctx.entities.upsert({
          entityType: PRODUCT_ENTITY_TYPE,
          scopeKind: "company",
          scopeId: runCtx.companyId,
          externalId,
          title: row.name.slice(0, 200),
          status: data.status,
          data: data as unknown as Record<string, unknown>,
        });
        upserted += 1;
      } catch (err) {
        errors.push(`product ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (rows.length < PER_PAGE || page >= res.totalPages) break;
    page += 1;
  }

  // Soft-delete: any product we previously knew about but didn't see on this
  // pass gets status="deleted" — but we keep the row so generated_image rows
  // can still resolve its name.
  let softDeleted = 0;
  for (const [externalId, row] of existingByExternal) {
    if (seen.has(externalId)) continue;
    const prev = row.data as unknown as ProductData;
    if (prev.status === "deleted") continue;
    try {
      await ctx.entities.upsert({
        entityType: PRODUCT_ENTITY_TYPE,
        scopeKind: "company",
        scopeId: runCtx.companyId,
        externalId,
        title: row.title ?? prev.name,
        status: "deleted",
        data: { ...prev, status: "deleted", syncedAt: now } as unknown as Record<string, unknown>,
      });
      softDeleted += 1;
    } catch (err) {
      errors.push(`soft-delete ${externalId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    await ctx.activity.log({
      companyId: runCtx.companyId,
      message: `WooCommerce catalog sync — ${upserted} upserted, ${softDeleted} deleted, ${catSync.upserted} categories`,
      entityType: "product-catalog-sync",
      entityId: runCtx.companyId,
      metadata: { upserted, softDeleted, categoriesUpserted: catSync.upserted, scanned, errors: errors.length },
    });
  } catch {
    // Activity log is best-effort.
  }

  const result: ProductCatalogSyncResult = {
    upserted,
    softDeleted,
    categoriesUpserted: catSync.upserted,
    scanned,
    errors,
  };

  return {
    content:
      `WooCommerce catalog sync complete — ${upserted} product(s) upserted, ` +
      `${softDeleted} soft-deleted, ${catSync.upserted} categor(ies). ` +
      `${errors.length ? `${errors.length} error(s).` : "No errors."}`,
    data: result as unknown as Record<string, unknown>,
  };
}

export const wcSyncCatalogDeclaration = {
  displayName: "Sync WooCommerce catalog",
  description:
    "Pull the full product catalog and category tree from the connected WooCommerce store into the agent's memory. Idempotent — re-running only re-fetches changed products. Soft-deletes products that disappeared from the store.",
  parametersSchema: {
    type: "object",
    properties: {
      force: {
        type: "boolean",
        description: "Force re-upserting every product even when WC reports the same date_modified.",
        default: false,
      },
    },
  } as const,
};
