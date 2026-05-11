//// Neocompany Modification — tests for imageApprove
//// End Neocompany Modification

import { describe, expect, it } from "vitest";
import { runImageApprove } from "./image-approve.js";
import { IMAGE_ENTITY_TYPE } from "../../images/types.js";
import {
  makeRunCtx,
  makeEntitiesStore,
  makeActivityLog,
  makePluginContext,
  makeCtxAccess,
} from "../../__tests__/test-helpers.js";

describe("runImageApprove", () => {
  it("flips status to approved and logs activity", async () => {
    const entities = makeEntitiesStore();
    const activity = makeActivityLog();
    const { ctx } = makePluginContext({ entities, activity });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    await entities.upsert({
      entityType: IMAGE_ENTITY_TYPE,
      scopeKind: "company",
      scopeId: runCtx.companyId,
      externalId: "img-1",
      title: "stub",
      status: "pending",
      data: { prompt: "test", status: "pending" },
    });

    const result = await runImageApprove(
      { imageId: "img-1", status: "approved" },
      undefined,
      runCtx,
      ctxAccess,
    );

    expect(result.error).toBeUndefined();
    expect(result.content).toContain("approved");
    expect(result.data).toEqual(expect.objectContaining({ imageId: "img-1", status: "approved" }));

    const record = [...entities.records.values()][0];
    expect(record.status).toBe("approved");
    expect((record.data as { status: string }).status).toBe("approved");
    expect(activity.log).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Image img-1 approved" }),
    );
  });

  it("supports rejection with feedback", async () => {
    const entities = makeEntitiesStore();
    const activity = makeActivityLog();
    const { ctx } = makePluginContext({ entities, activity });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    await entities.upsert({
      entityType: IMAGE_ENTITY_TYPE,
      scopeKind: "company",
      scopeId: runCtx.companyId,
      externalId: "img-bad",
      title: "stub",
      status: "pending",
      data: { prompt: "test", status: "pending" },
    });

    const result = await runImageApprove(
      { imageId: "img-bad", status: "rejected", feedback: "too dark" },
      undefined,
      runCtx,
      ctxAccess,
    );

    expect(result.data).toEqual(
      expect.objectContaining({ imageId: "img-bad", status: "rejected", feedback: "too dark" }),
    );
    const record = [...entities.records.values()][0];
    expect((record.data as { feedback?: string }).feedback).toBe("too dark");
    expect(activity.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ feedback: "too dark" }),
      }),
    );
  });

  it("returns IMAGE_NOT_FOUND when externalId is unknown", async () => {
    const entities = makeEntitiesStore();
    const activity = makeActivityLog();
    const { ctx } = makePluginContext({ entities, activity });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    const result = await runImageApprove(
      { imageId: "ghost", status: "approved" },
      undefined,
      runCtx,
      ctxAccess,
    );

    expect(result.error).toBe("IMAGE_NOT_FOUND");
    expect(entities.upsert).toHaveBeenCalledTimes(0);
    expect(activity.log).not.toHaveBeenCalled();
  });

  it("preserves the previous feedback when no new feedback is supplied", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    await entities.upsert({
      entityType: IMAGE_ENTITY_TYPE,
      scopeKind: "company",
      scopeId: runCtx.companyId,
      externalId: "img-1",
      title: "stub",
      status: "pending",
      data: { prompt: "test", status: "pending", feedback: "needs review" },
    });

    await runImageApprove({ imageId: "img-1", status: "approved" }, undefined, runCtx, ctxAccess);

    const record = [...entities.records.values()][0];
    expect((record.data as { feedback?: string }).feedback).toBe("needs review");
  });
});
