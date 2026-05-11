//// Neocompany Modification — tests for seoQuickWins (filter + sort + uplift estimate)
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSeoQuickWins } from "./quick-wins.js";
import { makeRunCtx } from "../../__tests__/test-helpers.js";

const GSC_CONFIG = { clientId: "c", clientSecret: "s", refreshToken: "r" };
const originalFetch = globalThis.fetch;

function gscFlow(rows: unknown[]) {
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

describe("runSeoQuickWins", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requires siteUrl", async () => {
    const result = await runSeoQuickWins({ siteUrl: "" }, GSC_CONFIG, makeRunCtx());
    expect(result.error).toMatch(/siteUrl/);
  });

  it("filters by position 4-maxPosition and minImpressions", async () => {
    gscFlow([
      { keys: ["too-low-pos"], position: 2.5, impressions: 100 },  // pos <4 → excluded
      { keys: ["too-high-pos"], position: 25, impressions: 100 },  // pos >20 → excluded
      { keys: ["too-few-impr"], position: 10, impressions: 5 },    // impr <10 → excluded
      { keys: ["good"], position: 8, impressions: 200 },           // ✓
      { keys: ["edge-pos-4"], position: 4, impressions: 50 },      // ✓ (4 included)
      { keys: ["edge-pos-20"], position: 20, impressions: 50 },    // ✓ (20 included)
    ]);
    const result = await runSeoQuickWins(
      { siteUrl: "https://neo.ai/" },
      GSC_CONFIG,
      makeRunCtx(),
    );
    const data = result.data as { opportunities: Array<{ query: string }> };
    const queries = data.opportunities.map((o) => o.query).sort();
    expect(queries).toEqual(["edge-pos-20", "edge-pos-4", "good"]);
  });

  it("sorts opportunities by impressions descending", async () => {
    gscFlow([
      { keys: ["small"], position: 8, impressions: 50 },
      { keys: ["big"], position: 8, impressions: 500 },
      { keys: ["medium"], position: 8, impressions: 200 },
    ]);
    const result = await runSeoQuickWins({ siteUrl: "https://neo.ai/" }, GSC_CONFIG, makeRunCtx());
    const data = result.data as { opportunities: Array<{ query: string }> };
    expect(data.opportunities.map((o) => o.query)).toEqual(["big", "medium", "small"]);
  });

  it("estimates click uplift = 15% of impressions if top 3", async () => {
    gscFlow([{ keys: ["kw"], position: 8, impressions: 1000 }]);
    const result = await runSeoQuickWins({ siteUrl: "https://neo.ai/" }, GSC_CONFIG, makeRunCtx());
    const data = result.data as { opportunities: Array<{ potential: string }> };
    expect(data.opportunities[0].potential).toMatch(/\+150 clicks\/month/);
  });

  it("custom minImpressions / maxPosition thresholds", async () => {
    gscFlow([
      { keys: ["a"], position: 12, impressions: 100 },   // ✓ with maxPosition=15
      { keys: ["b"], position: 18, impressions: 100 },   // ✗ above 15
      { keys: ["low-impr"], position: 8, impressions: 20 }, // ✗ minImpressions=50
    ]);
    const result = await runSeoQuickWins(
      { siteUrl: "https://neo.ai/", minImpressions: 50, maxPosition: 15 },
      GSC_CONFIG,
      makeRunCtx(),
    );
    const data = result.data as { opportunities: Array<{ query: string }> };
    expect(data.opportunities.map((o) => o.query)).toEqual(["a"]);
  });

  it("returns friendly message when no opportunities match", async () => {
    gscFlow([]);
    const result = await runSeoQuickWins({ siteUrl: "https://neo.ai/" }, GSC_CONFIG, makeRunCtx());
    expect(result.error).toBeUndefined();
    expect(result.content).toMatch(/No SEO quick wins/);
  });

  it("caps results at 15", async () => {
    const rows = Array.from({ length: 50 }, (_, n) => ({
      keys: [`kw-${n}`],
      position: 8,
      impressions: 1000 - n,
    }));
    gscFlow(rows);
    const result = await runSeoQuickWins({ siteUrl: "https://neo.ai/" }, GSC_CONFIG, makeRunCtx());
    const data = result.data as { opportunities: unknown[] };
    expect(data.opportunities).toHaveLength(15);
  });
});
