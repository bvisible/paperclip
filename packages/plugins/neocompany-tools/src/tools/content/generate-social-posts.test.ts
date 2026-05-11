//// Neocompany Modification — tests for contentGenerateSocialPosts (stateless lookup)
//// End Neocompany Modification

import { describe, expect, it } from "vitest";
import {
  runContentGenerateSocialPosts,
  contentGenerateSocialPostsDeclaration,
} from "./generate-social-posts.js";
import { makeRunCtx } from "../../__tests__/test-helpers.js";

describe("runContentGenerateSocialPosts", () => {
  it("defaults to x + linkedin + instagram when no platforms passed", async () => {
    const result = await runContentGenerateSocialPosts({}, makeRunCtx());
    expect(result.error).toBeUndefined();
    const data = result.data as { guidelines: Array<{ platform: string }> };
    expect(data.guidelines.map((g) => g.platform)).toEqual(["x", "linkedin", "instagram"]);
  });

  it("returns guidelines for each known platform", async () => {
    const result = await runContentGenerateSocialPosts(
      { platforms: ["linkedin"] },
      makeRunCtx(),
    );
    const data = result.data as {
      guidelines: Array<{ platform: string; maxChars: number; hashtagCount: string; style: string }>;
    };
    expect(data.guidelines).toHaveLength(1);
    expect(data.guidelines[0].platform).toBe("linkedin");
    expect(data.guidelines[0].maxChars).toBe(700);
    expect(data.guidelines[0].style).toMatch(/professional/);
  });

  it("is case-insensitive on platform names", async () => {
    const result = await runContentGenerateSocialPosts(
      { platforms: ["LinkedIn", "INSTAGRAM"] },
      makeRunCtx(),
    );
    const data = result.data as { guidelines: Array<{ platform: string; maxChars: number }> };
    // Platform names preserved as-passed; lookup is normalised under the hood.
    expect(data.guidelines.map((g) => g.maxChars)).toEqual([700, 2200]);
  });

  it("falls back to defaults for unknown platforms", async () => {
    const result = await runContentGenerateSocialPosts(
      { platforms: ["myspace"] },
      makeRunCtx(),
    );
    const data = result.data as { guidelines: Array<{ maxChars: number; hashtagCount: string }> };
    expect(data.guidelines[0].maxChars).toBe(500);
    expect(data.guidelines[0].hashtagCount).toBe("3-5");
  });

  it("renders a human-readable summary in content", async () => {
    const result = await runContentGenerateSocialPosts(
      { platforms: ["x"] },
      makeRunCtx(),
    );
    expect(result.content).toMatch(/x:/i);
    expect(result.content).toMatch(/280/);
    expect(result.content).toMatch(/Formatting guidelines/);
  });

  it("handles empty platforms array as 'use default trio'", async () => {
    const result = await runContentGenerateSocialPosts(
      { platforms: [] },
      makeRunCtx(),
    );
    const data = result.data as { guidelines: Array<{ platform: string }> };
    expect(data.guidelines).toHaveLength(3);
  });

  it("declaration shape is JSON Schema-compliant", () => {
    const decl = contentGenerateSocialPostsDeclaration;
    expect(decl.displayName).toBeTruthy();
    expect(decl.parametersSchema.type).toBe("object");
    expect(decl.parametersSchema.properties).toHaveProperty("platforms");
  });
});
