//// Neocompany Modification — tests for imageList (filter/sort semantics)
//// End Neocompany Modification

import { describe, expect, it } from "vitest";
import { runImageList } from "./image-list.js";
import { IMAGE_ENTITY_TYPE } from "../../images/types.js";
import {
  makeRunCtx,
  makeEntitiesStore,
  makePluginContext,
  makeCtxAccess,
} from "../../__tests__/test-helpers.js";

async function seedImage(
  entities: ReturnType<typeof makeEntitiesStore>,
  runCtx: { companyId: string },
  overrides: {
    externalId: string;
    status?: "pending" | "approved" | "rejected";
    batchId?: string;
    source?: "generated" | "uploaded";
    tags?: string[];
    prompt?: string;
  },
) {
  await entities.upsert({
    entityType: IMAGE_ENTITY_TYPE,
    scopeKind: "company",
    scopeId: runCtx.companyId,
    externalId: overrides.externalId,
    title: overrides.prompt ?? overrides.externalId,
    status: overrides.status ?? "pending",
    data: {
      prompt: overrides.prompt ?? "test",
      status: overrides.status ?? "pending",
      batchId: overrides.batchId,
      source: overrides.source ?? "generated",
      tags: overrides.tags ?? [],
      finalImageUrl: `https://cdn.example.com/${overrides.externalId}.png`,
      rawImageUrl: `https://cdn.example.com/raw/${overrides.externalId}.png`,
    },
  });
}

describe("runImageList", () => {
  it("returns all images for the company by default", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    await seedImage(entities, runCtx, { externalId: "a" });
    await seedImage(entities, runCtx, { externalId: "b" });

    const result = await runImageList({}, undefined, runCtx, ctxAccess);
    expect(result.error).toBeUndefined();
    const data = result.data as { images: Array<{ id: string }>; count: number };
    expect(data.count).toBe(2);
    expect(data.images.map((i) => i.id).sort()).toEqual(["a", "b"]);
  });

  it("filters by status", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    await seedImage(entities, runCtx, { externalId: "a", status: "approved" });
    await seedImage(entities, runCtx, { externalId: "b", status: "pending" });
    await seedImage(entities, runCtx, { externalId: "c", status: "approved" });

    const result = await runImageList({ status: "approved" }, undefined, runCtx, ctxAccess);
    const data = result.data as { images: Array<{ id: string; status: string }> };
    expect(data.images.map((i) => i.id).sort()).toEqual(["a", "c"]);
    expect(data.images.every((i) => i.status === "approved")).toBe(true);
  });

  it("filters by batchId", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    await seedImage(entities, runCtx, { externalId: "a", batchId: "batch-1" });
    await seedImage(entities, runCtx, { externalId: "b", batchId: "batch-2" });

    const result = await runImageList({ batchId: "batch-1" }, undefined, runCtx, ctxAccess);
    const data = result.data as { images: Array<{ id: string }> };
    expect(data.images.map((i) => i.id)).toEqual(["a"]);
  });

  it("filters by source (uploaded vs generated)", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    await seedImage(entities, runCtx, { externalId: "g", source: "generated" });
    await seedImage(entities, runCtx, { externalId: "u", source: "uploaded" });

    const result = await runImageList({ source: "uploaded" }, undefined, runCtx, ctxAccess);
    const data = result.data as { images: Array<{ id: string }> };
    expect(data.images.map((i) => i.id)).toEqual(["u"]);
  });

  it("filters by tags (matches ANY of provided tags)", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    await seedImage(entities, runCtx, { externalId: "a", tags: ["winter", "luxe"] });
    await seedImage(entities, runCtx, { externalId: "b", tags: ["summer"] });
    await seedImage(entities, runCtx, { externalId: "c", tags: [] });

    const result = await runImageList({ tags: ["luxe"] }, undefined, runCtx, ctxAccess);
    const data = result.data as { images: Array<{ id: string }> };
    expect(data.images.map((i) => i.id)).toEqual(["a"]);
  });

  it("strips heavy URLs when includeImages=false", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    await seedImage(entities, runCtx, { externalId: "a" });

    const result = await runImageList({ includeImages: false }, undefined, runCtx, ctxAccess);
    const data = result.data as { images: Array<{ finalImageUrl?: string; rawImageUrl?: string }> };
    expect(data.images[0].finalImageUrl).toBeUndefined();
    expect(data.images[0].rawImageUrl).toBeUndefined();
  });

  it("returns count=0 with friendly message when no images match", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    const result = await runImageList({ status: "rejected" }, undefined, runCtx, ctxAccess);
    const data = result.data as { count: number };
    expect(data.count).toBe(0);
    expect(result.content).toMatch(/Found 0 image/);
  });
});
