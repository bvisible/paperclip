//// Neocompany Modification — registry sanity tests for neocompany-tools
//// Pins the contract that the plugin exposes exactly 33 tools with the
//// expected names. Catches accidental removal / renaming during refactors,
//// and acts as a smoke test for the whole tool surface.
//// End Neocompany Modification

import { describe, expect, it } from "vitest";
import { ALL_TOOLS } from "../tools/index.js";

const EXPECTED_TOOLS = [
  // SEO (no secrets)
  "seoRobotsCheck",
  "seoSitemapCheck",
  "seoPageSpeed",
  "seoContentAudit",
  "seoCompetitorPageRank",
  "geoVisibilityCheck",
  // Content (stateless)
  "contentGenerateSocialPosts",
  "contentTopicIdeas",
  // WordPress
  "wpListPosts",
  "wpCreatePost",
  "wpUpdatePost",
  "wpListCategories",
  "wpSiteHealth",
  // WooCommerce catalog
  "wcSyncCatalog",
  "wcListProducts",
  "wcGetProduct",
  // SEO (Google OAuth)
  "seoGscKeywords",
  "seoGscTopPages",
  "seoQuickWins",
  "seoTrendAnalysis",
  "seoGa4Traffic",
  "seoGa4TopPages",
  "geoAITraffic",
  // Email
  "emailSendMessage",
  "emailListMessages",
  "emailReadMessage",
  // Templates
  "templateCreate",
  "templateList",
  "templateApply",
  // Image generation
  "imageGenerate",
  "imageList",
  "imageApprove",
  "imageDelete",
];

describe("ALL_TOOLS registry", () => {
  it("exposes exactly 33 tools", () => {
    expect(ALL_TOOLS).toHaveLength(33);
  });

  it("exposes all expected tool names", () => {
    const actual = ALL_TOOLS.map((t) => t.name).sort();
    const expected = [...EXPECTED_TOOLS].sort();
    expect(actual).toEqual(expected);
  });

  it("has no duplicate names", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("every tool has a declaration with displayName + description + parametersSchema", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.declaration, `${tool.name}.declaration`).toBeDefined();
      expect(typeof tool.declaration.displayName, `${tool.name}.declaration.displayName`).toBe(
        "string",
      );
      expect(tool.declaration.displayName.length, `${tool.name}.declaration.displayName length`).toBeGreaterThan(
        0,
      );
      expect(typeof tool.declaration.description, `${tool.name}.declaration.description`).toBe(
        "string",
      );
      expect(tool.declaration.parametersSchema, `${tool.name}.declaration.parametersSchema`).toBeDefined();
      expect(typeof tool.declaration.parametersSchema, `${tool.name}.parametersSchema type`).toBe(
        "object",
      );
    }
  });

  it("every tool has a runnable function", () => {
    for (const tool of ALL_TOOLS) {
      expect(typeof tool.run, `${tool.name}.run`).toBe("function");
    }
  });

  it("parametersSchema is JSON Schema-shaped (type=object with properties)", () => {
    for (const tool of ALL_TOOLS) {
      const schema = tool.declaration.parametersSchema as Record<string, unknown>;
      expect(schema.type, `${tool.name}.parametersSchema.type`).toBe("object");
      // Properties may be empty for zero-arg tools, but the key should exist.
      expect("properties" in schema, `${tool.name}.parametersSchema.properties`).toBe(true);
    }
  });

  it("tools with configSchema have valid field definitions", () => {
    for (const tool of ALL_TOOLS) {
      if (!tool.configSchema) continue;
      expect(tool.configSchema.title, `${tool.name}.configSchema.title`).toBeDefined();
      expect(Array.isArray(tool.configSchema.fields), `${tool.name}.configSchema.fields`).toBe(true);
      for (const field of tool.configSchema.fields) {
        expect(field.name, `${tool.name} field.name`).toBeDefined();
        expect(field.label, `${tool.name} field.label`).toBeDefined();
        expect(["string", "url", "number", "boolean", "enum"], `${tool.name} field.type`).toContain(field.type);
        if (field.type === "enum") {
          expect(Array.isArray(field.options), `${tool.name} enum.options`).toBe(true);
        }
      }
    }
  });
});
