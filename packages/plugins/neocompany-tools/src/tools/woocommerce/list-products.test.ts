//// Neocompany Modification — tests for wcListProducts.
//// We seed the in-memory entities store with a few products and verify
//// the search / category / status filters narrow the result set without
//// hitting the network (the tool reads from the locally-synced catalog).
//// End Neocompany Modification

import { describe, expect, it } from "vitest";
import { runWcListProducts } from "./list-products.js";
import {
  PRODUCT_ENTITY_TYPE,
  wcCategoryExternalId,
  wcProductExternalId,
} from "../../products/types.js";
import {
  makeCtxAccess,
  makeEntitiesStore,
  makePluginContext,
  makeRunCtx,
} from "../../__tests__/test-helpers.js";

async function seedCatalog(entities: ReturnType<typeof makeEntitiesStore>, companyId: string) {
  const products = [
    {
      wcId: 1,
      name: "Robe d'été en lin",
      slug: "robe-ete-lin",
      status: "publish" as const,
      categoryIds: [wcCategoryExternalId(10)],
      categoryNames: ["Été"],
      price: "129.00",
      currency: "CHF",
    },
    {
      wcId: 2,
      name: "Pull en cachemire",
      slug: "pull-cachemire",
      status: "publish" as const,
      categoryIds: [wcCategoryExternalId(11)],
      categoryNames: ["Hiver"],
      price: "249.00",
      currency: "CHF",
    },
    {
      wcId: 3,
      name: "Top léger",
      slug: "top-leger",
      status: "draft" as const,
      categoryIds: [wcCategoryExternalId(10)],
      categoryNames: ["Été"],
      price: "59.00",
      currency: "CHF",
    },
    {
      wcId: 4,
      name: "Ancien produit",
      slug: "vieux",
      status: "deleted" as const,
      categoryIds: [wcCategoryExternalId(10)],
      categoryNames: ["Été"],
    },
  ];
  for (const p of products) {
    await entities.upsert({
      entityType: PRODUCT_ENTITY_TYPE,
      scopeKind: "company",
      scopeId: companyId,
      externalId: wcProductExternalId(p.wcId),
      title: p.name,
      status: p.status,
      data: {
        source: "woocommerce",
        ...p,
        description: "",
        shortDescription: "",
        tags: [],
        imageUrls: ["https://cdn/" + p.slug + ".jpg"],
        attributes: {},
        syncedAt: "2026-05-19T00:00:00Z",
      },
    });
  }
}

describe("runWcListProducts", () => {
  it("returns all non-deleted products by default", async () => {
    const entities = makeEntitiesStore();
    await seedCatalog(entities, "co-1");
    const { ctx } = makePluginContext({ entities });
    const result = await runWcListProducts(
      {},
      undefined,
      makeRunCtx({ companyId: "co-1" }),
      makeCtxAccess({ ctx }),
    );
    const data = result.data as { products: Array<{ name: string }>; total: number };
    expect(data.total).toBe(3); // 4 seeded, 1 soft-deleted
    expect(data.products.map((p) => p.name)).not.toContain("Ancien produit");
  });

  it("search narrows by name substring (case-insensitive)", async () => {
    const entities = makeEntitiesStore();
    await seedCatalog(entities, "co-1");
    const { ctx } = makePluginContext({ entities });
    const result = await runWcListProducts(
      { search: "ROBE" },
      undefined,
      makeRunCtx({ companyId: "co-1" }),
      makeCtxAccess({ ctx }),
    );
    const data = result.data as { products: Array<{ name: string }>; total: number };
    expect(data.total).toBe(1);
    expect(data.products[0].name).toBe("Robe d'été en lin");
  });

  it("categoryId filter pulls only products in that category", async () => {
    const entities = makeEntitiesStore();
    await seedCatalog(entities, "co-1");
    const { ctx } = makePluginContext({ entities });
    const result = await runWcListProducts(
      { categoryId: wcCategoryExternalId(10) },
      undefined,
      makeRunCtx({ companyId: "co-1" }),
      makeCtxAccess({ ctx }),
    );
    const data = result.data as { products: Array<{ name: string }>; total: number };
    // Été: Robe + Top léger (draft) — Ancien produit is soft-deleted and hidden by default
    expect(data.total).toBe(2);
    expect(data.products.map((p) => p.name).sort()).toEqual(["Robe d'été en lin", "Top léger"]);
  });

  it("status=publish filters out drafts and deleted", async () => {
    const entities = makeEntitiesStore();
    await seedCatalog(entities, "co-1");
    const { ctx } = makePluginContext({ entities });
    const result = await runWcListProducts(
      { status: "publish" },
      undefined,
      makeRunCtx({ companyId: "co-1" }),
      makeCtxAccess({ ctx }),
    );
    const data = result.data as { total: number };
    expect(data.total).toBe(2);
  });

  it("status=deleted surfaces soft-deleted rows", async () => {
    const entities = makeEntitiesStore();
    await seedCatalog(entities, "co-1");
    const { ctx } = makePluginContext({ entities });
    const result = await runWcListProducts(
      { status: "deleted" },
      undefined,
      makeRunCtx({ companyId: "co-1" }),
      makeCtxAccess({ ctx }),
    );
    const data = result.data as { products: Array<{ name: string }>; total: number };
    expect(data.total).toBe(1);
    expect(data.products[0].name).toBe("Ancien produit");
  });
});
