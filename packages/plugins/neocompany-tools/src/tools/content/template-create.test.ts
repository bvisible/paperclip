//// Neocompany Modification — tests for templateCreate
//// End Neocompany Modification

import { describe, expect, it } from "vitest";
import { runTemplateCreate } from "./template-create.js";
import { ENTITY_TYPE, DIMENSION_PRESETS, DEFAULT_TEMPLATE_CONFIG } from "../../templates/types.js";
import {
  makeRunCtx,
  makeEntitiesStore,
  makePluginContext,
  makeCtxAccess,
} from "../../__tests__/test-helpers.js";

describe("runTemplateCreate", () => {
  it("resolves dimensions from a known preset", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    const result = await runTemplateCreate(
      { name: "Insta square", preset: "instagram-square" },
      undefined,
      runCtx,
      ctxAccess,
    );

    expect(result.error).toBeUndefined();
    const data = result.data as { width: number; height: number; templateId: string };
    expect(data.width).toBe(1080);
    expect(data.height).toBe(1080);
    expect(typeof data.templateId).toBe("string");
    expect(data.templateId.length).toBeGreaterThan(0);
  });

  it("supports custom width/height (preset overridden when both supplied)", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    const result = await runTemplateCreate(
      { name: "Custom", width: 2000, height: 1000 },
      undefined,
      runCtx,
      ctxAccess,
    );
    const data = result.data as { width: number; height: number };
    expect(data.width).toBe(2000);
    expect(data.height).toBe(1000);
  });

  it("returns MISSING_DIMENSIONS when neither preset nor width/height is supplied", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    const result = await runTemplateCreate({ name: "Oops" }, undefined, runCtx, ctxAccess);
    expect(result.error).toBe("MISSING_DIMENSIONS");
    expect(entities.upsert).not.toHaveBeenCalled();
  });

  it("returns MISSING_DIMENSIONS when preset is unknown and no width/height provided", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    const result = await runTemplateCreate(
      { name: "Bad preset", preset: "tiktok-portrait" },
      undefined,
      runCtx,
      ctxAccess,
    );
    expect(result.error).toBe("MISSING_DIMENSIONS");
  });

  it("merges partial config on top of DEFAULT_TEMPLATE_CONFIG", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx();

    await runTemplateCreate(
      {
        name: "Configured",
        preset: "linkedin-post",
        config: {
          backgroundColor: "#ff0000",
        },
      },
      undefined,
      runCtx,
      ctxAccess,
    );

    const stored = [...entities.records.values()][0];
    const data = stored.data as { config: { backgroundColor: string; logo: unknown } };
    expect(data.config.backgroundColor).toBe("#ff0000");
    // Other defaults preserved.
    expect(data.config.logo).toEqual(DEFAULT_TEMPLATE_CONFIG.logo);
  });

  it("persists with entityType=brand_template and scopeKind=company", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx({ companyId: "company-xyz" });

    await runTemplateCreate(
      { name: "Persist", preset: "facebook-post" },
      undefined,
      runCtx,
      ctxAccess,
    );

    expect(entities.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: ENTITY_TYPE,
        scopeKind: "company",
        scopeId: "company-xyz",
        title: "Persist",
      }),
    );
  });

  it("isDefault is false on new templates", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });

    await runTemplateCreate(
      { name: "Fresh", preset: "twitter-post" },
      undefined,
      makeRunCtx(),
      ctxAccess,
    );
    const stored = [...entities.records.values()][0];
    expect((stored.data as { isDefault: boolean }).isDefault).toBe(false);
  });

  it("all 9 dimension presets resolve dimensions", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const ctxAccess = makeCtxAccess({ ctx });

    for (const preset of DIMENSION_PRESETS) {
      const result = await runTemplateCreate(
        { name: preset.label, preset: preset.key },
        undefined,
        makeRunCtx(),
        ctxAccess,
      );
      expect(result.error, `preset ${preset.key}`).toBeUndefined();
      const data = result.data as { width: number; height: number };
      expect(data.width).toBe(preset.width);
      expect(data.height).toBe(preset.height);
    }
  });
});
