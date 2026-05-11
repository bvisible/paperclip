//// Neocompany Modification — tests for contentTopicIdeas (GSC-backed)
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runContentTopicIdeas } from "./topic-ideas.js";
import { makeRunCtx } from "../../__tests__/test-helpers.js";

const GSC_CONFIG = {
  clientId: "c",
  clientSecret: "s",
  refreshToken: "r",
};

const originalFetch = globalThis.fetch;

function gscResponse(rows: unknown[]) {
  let i = 0;
  globalThis.fetch = vi.fn(async () => {
    i++;
    if (i === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "tok" }),
        text: async () => "",
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ rows }),
      text: async () => "",
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("runContentTopicIdeas", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requires siteUrl", async () => {
    const result = await runContentTopicIdeas({ siteUrl: "" }, GSC_CONFIG, makeRunCtx());
    expect(result.error).toMatch(/siteUrl/);
  });

  it("filters out queries with <5 impressions", async () => {
    gscResponse([
      { keys: ["weak"], impressions: 2, position: 12, ctr: 0.02 },
      { keys: ["strong"], impressions: 100, position: 6, ctr: 0.04 },
    ]);
    const result = await runContentTopicIdeas({ siteUrl: "https://neo.ai/" }, GSC_CONFIG, makeRunCtx());
    const data = result.data as { ideas: Array<{ keyword: string }> };
    expect(data.ideas.map((i) => i.keyword)).toEqual(["strong"]);
  });

  it("sorts ideas by impression count descending", async () => {
    gscResponse([
      { keys: ["b"], impressions: 50, position: 8 },
      { keys: ["a"], impressions: 200, position: 4 },
      { keys: ["c"], impressions: 100, position: 7 },
    ]);
    const result = await runContentTopicIdeas({ siteUrl: "https://neo.ai/" }, GSC_CONFIG, makeRunCtx());
    const data = result.data as { ideas: Array<{ keyword: string }> };
    expect(data.ideas.map((i) => i.keyword)).toEqual(["a", "c", "b"]);
  });

  it("classifies angle by position + CTR", async () => {
    gscResponse([
      { keys: ["new"], impressions: 50, position: 25, ctr: 0 },
      { keys: ["optimize"], impressions: 50, position: 15, ctr: 0 },
      { keys: ["ctr"], impressions: 50, position: 5, ctr: 0.01 },
      { keys: ["expand"], impressions: 50, position: 3, ctr: 0.06 },
    ]);
    const result = await runContentTopicIdeas({ siteUrl: "https://neo.ai/" }, GSC_CONFIG, makeRunCtx());
    const data = result.data as { ideas: Array<{ keyword: string; angle: string }> };
    const map = Object.fromEntries(data.ideas.map((i) => [i.keyword, i.angle]));
    expect(map.new).toMatch(/New content needed/);
    expect(map.optimize).toMatch(/Optimize existing/);
    expect(map.ctr).toMatch(/CTR/);
    expect(map.expand).toMatch(/Expand and deepen/);
  });

  it("clamps count between 1 and 30", async () => {
    gscResponse(
      Array.from({ length: 50 }, (_, n) => ({
        keys: [`kw-${n}`],
        impressions: 100 - n,
        position: 5,
      })),
    );
    const result = await runContentTopicIdeas(
      { siteUrl: "https://neo.ai/", count: 999 },
      GSC_CONFIG,
      makeRunCtx(),
    );
    const data = result.data as { ideas: unknown[] };
    expect(data.ideas).toHaveLength(30);
  });

  it("falls back to friendly message when GSC returns no usable rows", async () => {
    gscResponse([]);
    const result = await runContentTopicIdeas({ siteUrl: "https://neo.ai/" }, GSC_CONFIG, makeRunCtx());
    expect(result.error).toBeUndefined();
    expect(result.content).toMatch(/No content opportunities/);
  });

  it("surfaces GSC API error", async () => {
    let i = 0;
    globalThis.fetch = vi.fn(async () => {
      i++;
      if (i === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "tok" }),
          text: async () => "",
        } as unknown as Response;
      }
      return {
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => "GSC down",
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await runContentTopicIdeas({ siteUrl: "https://neo.ai/" }, GSC_CONFIG, makeRunCtx());
    expect(result.error).toMatch(/500/);
  });
});
