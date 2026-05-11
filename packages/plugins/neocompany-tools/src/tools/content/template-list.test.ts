//// Neocompany Modification — tests for templateList
//// End Neocompany Modification

import { describe, expect, it } from "vitest";
import { runTemplateList } from "./template-list.js";
import { ENTITY_TYPE as TEMPLATE_ENTITY_TYPE } from "../../templates/types.js";
import {
  makeRunCtx,
  makeEntitiesStore,
  makePluginContext,
  makeCtxAccess,
} from "../../__tests__/test-helpers.js";

async function seedTemplate(
  entities: ReturnType<typeof makeEntitiesStore>,
  runCtx: { companyId: string },
  opts: {
    externalId: string;
    name: string;
    width: number;
    height: number;
    isDefault?: boolean;
  },
) {
  await entities.upsert({
    entityType: TEMPLATE_ENTITY_TYPE,
    scopeKind: "company",
    scopeId: runCtx.companyId,
    externalId: opts.externalId,
    title: opts.name,
    data: {
      name: opts.name,
      width: opts.width,
      height: opts.height,
      isDefault: opts.isDefault ?? false,
    },
  });
}

describe("runTemplateList", () => {
  it("returns the friendly 'no templates' message when company has none", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });

    const result = await runTemplateList({}, undefined, makeRunCtx(), ctxAccess);
    expect(result.content).toMatch(/No templates/i);
    expect(result.data).toEqual({ templates: [] });
  });

  it("lists templates with name + dimensions + id", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    await seedTemplate(entities, runCtx, {
      externalId: "tpl-square",
      name: "Brand square",
      width: 1080,
      height: 1080,
      isDefault: true,
    });
    await seedTemplate(entities, runCtx, {
      externalId: "tpl-story",
      name: "Brand story",
      width: 1080,
      height: 1920,
    });

    const result = await runTemplateList({}, undefined, runCtx, ctxAccess);
    const data = result.data as { templates: Array<{ name: string; width: number; height: number; isDefault: boolean }> };
    expect(data.templates).toHaveLength(2);
    expect(result.content).toContain("Brand square");
    expect(result.content).toContain("1080×1080");
    expect(result.content).toContain("Brand story");
    expect(result.content).toContain("1080×1920");
    expect(data.templates.find((t) => t.name === "Brand square")?.isDefault).toBe(true);
  });

  it("honours the limit parameter (passed through to entities.list)", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    for (let i = 0; i < 5; i++) {
      await seedTemplate(entities, runCtx, {
        externalId: `tpl-${i}`,
        name: `Tpl ${i}`,
        width: 100,
        height: 100,
      });
    }

    await runTemplateList({ limit: 3 }, undefined, runCtx, ctxAccess);
    expect(entities.list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 3, scopeKind: "company", scopeId: runCtx.companyId }),
    );
  });

  it("only returns brand_template entities (not other entities sharing the same scope)", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    await seedTemplate(entities, runCtx, {
      externalId: "tpl-1",
      name: "Brand",
      width: 1080,
      height: 1080,
    });
    // Foreign entity in the same scope — should be ignored.
    await entities.upsert({
      entityType: "generated_image",
      scopeKind: "company",
      scopeId: runCtx.companyId,
      externalId: "img-1",
      data: {},
    });

    const result = await runTemplateList({}, undefined, runCtx, ctxAccess);
    const data = result.data as { templates: Array<{ name: string }> };
    expect(data.templates).toHaveLength(1);
    expect(data.templates[0].name).toBe("Brand");
  });
});
