//// Neocompany Modification — tests for the WooCommerce catalog sync.
//// We mock global.fetch to simulate paginated WC REST responses + verify
//// the entities store ends up with one row per product + one row per
//// category, including the soft-delete pass for products that disappeared
//// from the store between two syncs.
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runProductCatalogSync } from "./sync-catalog.js";
import {
  PRODUCT_ENTITY_TYPE,
  PRODUCT_CATEGORY_ENTITY_TYPE,
  wcProductExternalId,
  wcCategoryExternalId,
} from "../../products/types.js";
import {
  makeCtxAccess,
  makeEntitiesStore,
  makePluginContext,
  makeRunCtx,
} from "../../__tests__/test-helpers.js";

const WP_CONFIG = {
  siteUrl: "https://shop.example.com",
  username: "neo",
  appPassword: "pwd",
};

const originalFetch = globalThis.fetch;

type FakeResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  headers: { get: (k: string) => string | null };
};

function mkResponse(rows: unknown, headers: Record<string, string> = {}): FakeResponse {
  const text = typeof rows === "string" ? rows : JSON.stringify(rows);
  return {
    ok: true,
    status: 200,
    text: async () => text,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  };
}

/**
 * Returns a fetch mock that walks a scripted list of responses in order.
 * Each call shifts the next response off the queue.
 */
function scriptedFetch(responses: FakeResponse[]) {
  const queue = [...responses];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("scriptedFetch: queue exhausted");
    return next;
  }) as unknown as typeof fetch;
}

describe("runProductCatalogSync", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("upserts products + categories with namespaced externalIds", async () => {
    // Order matters — runProductCatalogSync calls (in order):
    //   1. /settings/general/woocommerce_currency
    //   2. /products/categories (page 1)
    //   3. /products (page 1)
    globalThis.fetch = scriptedFetch([
      mkResponse({ id: "woocommerce_currency", value: "CHF" }),
      mkResponse(
        [{ id: 10, name: "Été", slug: "ete", parent: 0, count: 2 }],
        { "x-wp-totalpages": "1" },
      ),
      mkResponse(
        [
          {
            id: 1001,
            name: "Robe légère",
            slug: "robe-legere",
            permalink: "https://shop.example.com/produit/robe-legere",
            description: "<p>Robe d'été en lin.</p>",
            short_description: "Lin léger",
            sku: "ROBE-001",
            price: "129.00",
            regular_price: "149.00",
            sale_price: "129.00",
            status: "publish",
            date_modified_gmt: "2026-05-01T10:00:00",
            categories: [{ id: 10, name: "Été", slug: "ete" }],
            tags: [{ id: 1, name: "Lin", slug: "lin" }],
            images: [{ id: 5, src: "https://cdn.example.com/robe.jpg" }],
            attributes: [{ name: "Couleur", options: ["Crème", "Bleu"] }],
          },
        ],
        { "x-wp-totalpages": "1" },
      ),
    ]);

    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });

    const result = await runProductCatalogSync(
      { force: false },
      WP_CONFIG,
      makeRunCtx({ companyId: "co-1" }),
      ctxAccess,
    );

    const data = result.data as {
      upserted: number;
      softDeleted: number;
      categoriesUpserted: number;
      scanned: number;
      errors: string[];
    };
    expect(data.upserted).toBe(1);
    expect(data.softDeleted).toBe(0);
    expect(data.categoriesUpserted).toBe(1);
    expect(data.scanned).toBe(1);
    expect(data.errors).toEqual([]);

    // One product upsert + one category upsert
    const upsertedTypes = entities.upsert.mock.calls.map((c) => c[0].entityType);
    expect(upsertedTypes).toContain(PRODUCT_ENTITY_TYPE);
    expect(upsertedTypes).toContain(PRODUCT_CATEGORY_ENTITY_TYPE);

    const productCall = entities.upsert.mock.calls.find(
      (c) => c[0].entityType === PRODUCT_ENTITY_TYPE,
    )!;
    expect(productCall[0].externalId).toBe(wcProductExternalId(1001));
    const productData = productCall[0].data as Record<string, unknown>;
    expect(productData.name).toBe("Robe légère");
    expect(productData.currency).toBe("CHF");
    expect(productData.description).toBe("Robe d'été en lin.");
    expect(productData.imageUrls).toEqual(["https://cdn.example.com/robe.jpg"]);
    expect(productData.categoryIds).toEqual([wcCategoryExternalId(10)]);
    expect((productData.attributes as Record<string, string>).Couleur).toBe("Crème, Bleu");
  });

  it("soft-deletes products that disappeared from the store", async () => {
    const entities = makeEntitiesStore();
    // Pre-seed an existing product so the diff has something to remove.
    await entities.upsert({
      entityType: PRODUCT_ENTITY_TYPE,
      scopeKind: "company",
      scopeId: "co-1",
      externalId: wcProductExternalId(999),
      title: "Old SKU",
      status: "publish",
      data: {
        source: "woocommerce",
        wcId: 999,
        name: "Old SKU",
        slug: "old-sku",
        description: "",
        shortDescription: "",
        status: "publish",
        categoryIds: [],
        categoryNames: [],
        tags: [],
        imageUrls: [],
        attributes: {},
        syncedAt: "2026-05-01T00:00:00Z",
      },
    });

    globalThis.fetch = scriptedFetch([
      mkResponse({ id: "woocommerce_currency", value: "EUR" }),
      mkResponse([], { "x-wp-totalpages": "1" }), // no categories
      mkResponse([], { "x-wp-totalpages": "1" }), // no products this time
    ]);
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });

    const result = await runProductCatalogSync(
      { force: false },
      WP_CONFIG,
      makeRunCtx({ companyId: "co-1" }),
      ctxAccess,
    );

    const data = result.data as { softDeleted: number };
    expect(data.softDeleted).toBe(1);

    // The latest upsert for that externalId should have status="deleted"
    const calls = entities.upsert.mock.calls.filter(
      (c) => c[0].externalId === wcProductExternalId(999),
    );
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall[0].status).toBe("deleted");
    expect((lastCall[0].data as Record<string, unknown>).status).toBe("deleted");
  });

  it("skips re-upserting products whose date_modified is unchanged", async () => {
    const entities = makeEntitiesStore();
    await entities.upsert({
      entityType: PRODUCT_ENTITY_TYPE,
      scopeKind: "company",
      scopeId: "co-1",
      externalId: wcProductExternalId(2001),
      title: "Steady",
      status: "publish",
      data: {
        source: "woocommerce",
        wcId: 2001,
        name: "Steady",
        slug: "steady",
        description: "",
        shortDescription: "",
        status: "publish",
        categoryIds: [],
        categoryNames: [],
        tags: [],
        imageUrls: [],
        attributes: {},
        wcModifiedAt: "2026-05-10T10:00:00.000Z",
        syncedAt: "2026-05-10T10:00:00Z",
      },
    });
    const upsertsBefore = entities.upsert.mock.calls.length;

    globalThis.fetch = scriptedFetch([
      mkResponse({ value: "CHF" }),
      mkResponse([], { "x-wp-totalpages": "1" }),
      mkResponse(
        [
          {
            id: 2001,
            name: "Steady",
            slug: "steady",
            status: "publish",
            date_modified_gmt: "2026-05-10T10:00:00", // same → skip
            categories: [],
            tags: [],
            images: [],
            attributes: [],
          },
        ],
        { "x-wp-totalpages": "1" },
      ),
    ]);
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });

    const result = await runProductCatalogSync(
      { force: false },
      WP_CONFIG,
      makeRunCtx({ companyId: "co-1" }),
      ctxAccess,
    );
    const data = result.data as { upserted: number; scanned: number };
    expect(data.scanned).toBe(1);
    expect(data.upserted).toBe(0);

    // Only the original seed upsert + maybe categories — no new product upsert.
    const productUpsertsAfter = entities.upsert.mock.calls
      .slice(upsertsBefore)
      .filter((c) => c[0].entityType === PRODUCT_ENTITY_TYPE);
    expect(productUpsertsAfter).toHaveLength(0);
  });
});
