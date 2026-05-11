//// Neocompany Modification — tests for imageDelete (uses SDK entities.delete)
//// imageDelete is the canary for our SDK extension: it depends on the
//// entities.delete RPC we added to the SDK + worker-rpc-host +
//// host-client-factory. If the RPC ever regresses, this test fails first.
//// End Neocompany Modification

import { describe, expect, it } from "vitest";
import { runImageDelete } from "./image-delete.js";
import { IMAGE_ENTITY_TYPE } from "../../images/types.js";
import {
  makeRunCtx,
  makeEntitiesStore,
  makeActivityLog,
  makePluginContext,
  makeCtxAccess,
} from "../../__tests__/test-helpers.js";

describe("runImageDelete", () => {
  it("deletes an existing image and logs the activity", async () => {
    const entities = makeEntitiesStore();
    const activity = makeActivityLog();
    const { ctx } = makePluginContext({ entities, activity });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    // Seed an image record so list() finds it.
    await entities.upsert({
      entityType: IMAGE_ENTITY_TYPE,
      scopeKind: "company",
      scopeId: runCtx.companyId,
      externalId: "img-abc",
      title: "Test image",
      data: { url: "https://example.com/img-abc.png", prompt: "a red square" },
    });

    const result = await runImageDelete({ imageId: "img-abc" }, undefined, runCtx, ctxAccess);

    expect(result.error).toBeUndefined();
    expect(result.content).toContain("img-abc");
    expect(result.content).toMatch(/delet(e|ed)/i);
    expect(entities.delete).toHaveBeenCalledTimes(1);
    expect(entities.delete).toHaveBeenCalledWith({ id: "entity-1" });
    expect(entities.records.size).toBe(0);
    expect(activity.log).toHaveBeenCalledTimes(1);
    expect(activity.log).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: runCtx.companyId,
        entityType: IMAGE_ENTITY_TYPE,
        entityId: "img-abc",
      }),
    );
  });

  it("returns IMAGE_NOT_FOUND for a missing externalId without calling delete", async () => {
    const entities = makeEntitiesStore();
    const activity = makeActivityLog();
    const { ctx } = makePluginContext({ entities, activity });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    const result = await runImageDelete({ imageId: "nope" }, undefined, runCtx, ctxAccess);

    expect(result.error).toBe("IMAGE_NOT_FOUND");
    expect(result.content).toContain("nope");
    expect(entities.delete).not.toHaveBeenCalled();
    expect(activity.log).not.toHaveBeenCalled();
  });

  it("scopes lookup to the caller's company (multi-tenancy isolation)", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });

    // Same externalId in two different companies — only the caller's should resolve.
    await entities.upsert({
      entityType: IMAGE_ENTITY_TYPE,
      scopeKind: "company",
      scopeId: "company-A",
      externalId: "shared-id",
      data: {},
    });
    await entities.upsert({
      entityType: IMAGE_ENTITY_TYPE,
      scopeKind: "company",
      scopeId: "company-B",
      externalId: "shared-id",
      data: {},
    });

    const result = await runImageDelete(
      { imageId: "shared-id" },
      undefined,
      makeRunCtx({ companyId: "company-A" }),
      ctxAccess,
    );

    expect(result.error).toBeUndefined();
    expect(entities.records.size).toBe(1);
    // The remaining record must be company-B's.
    const remaining = [...entities.records.values()][0];
    expect(remaining.scopeId).toBe("company-B");
  });

  it("only queries images (entityType filter)", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    // Mixed entity types in the same company — only the IMAGE_ENTITY_TYPE row should be found.
    await entities.upsert({
      entityType: "brand_template",
      scopeKind: "company",
      scopeId: runCtx.companyId,
      externalId: "img-abc",
      data: {},
    });
    await entities.upsert({
      entityType: IMAGE_ENTITY_TYPE,
      scopeKind: "company",
      scopeId: runCtx.companyId,
      externalId: "img-abc",
      data: { kind: "image" },
    });

    const result = await runImageDelete({ imageId: "img-abc" }, undefined, runCtx, ctxAccess);
    expect(result.error).toBeUndefined();

    // Brand template still around, only the image got deleted.
    expect(entities.records.size).toBe(1);
    const remaining = [...entities.records.values()][0];
    expect(remaining.entityType).toBe("brand_template");
  });
});
