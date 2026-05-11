//// Neocompany Modification — tests for seoGscTopPages (mêmes patterns que gsc-keywords)
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSeoGscTopPages } from "./gsc-top-pages.js";
import { makeRunCtx } from "../../__tests__/test-helpers.js";

const GSC_CONFIG = { clientId: "c", clientSecret: "s", refreshToken: "r" };
const originalFetch = globalThis.fetch;

function gscFlow(rows: unknown[], opts: { analyticsOk?: boolean; analyticsStatus?: number } = {}) {
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
      ok: opts.analyticsOk ?? true,
      status: opts.analyticsStatus ?? 200,
      json: async () => ({ rows }),
      text: async () => "denied",
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("runSeoGscTopPages", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requires siteUrl", async () => {
    const result = await runSeoGscTopPages({ siteUrl: "" }, GSC_CONFIG, makeRunCtx());
    expect(result.error).toMatch(/siteUrl/);
  });

  it("returns top pages with rounded CTR and position", async () => {
    gscFlow([
      { keys: ["https://neo.ai/a"], clicks: 100, impressions: 5000, ctr: 0.02, position: 3.45 },
      { keys: ["https://neo.ai/b"], clicks: 50, impressions: 2000, ctr: 0.025, position: 5.5 },
    ]);
    const result = await runSeoGscTopPages(
      { siteUrl: "https://neo.ai/" },
      GSC_CONFIG,
      makeRunCtx(),
    );
    const data = result.data as { pages: Array<{ url: string; ctr: number; position: number }> };
    expect(data.pages).toHaveLength(2);
    expect(data.pages[0]).toEqual({
      url: "https://neo.ai/a",
      clicks: 100,
      impressions: 5000,
      ctr: 2,        // 0.02 × 10000 / 100 = 2
      position: 3.5, // rounded to 1 decimal
    });
  });

  it("uses default 30-day window when no explicit dates", async () => {
    gscFlow([]);
    const result = await runSeoGscTopPages({ siteUrl: "https://neo.ai/" }, GSC_CONFIG, makeRunCtx());
    const data = result.data as { range: { startDate: string; endDate: string } };
    expect(data.range.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.range.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("honours explicit date range", async () => {
    gscFlow([]);
    const result = await runSeoGscTopPages(
      { siteUrl: "https://neo.ai/", startDate: "2026-02-01", endDate: "2026-02-28" },
      GSC_CONFIG,
      makeRunCtx(),
    );
    const data = result.data as { range: { startDate: string; endDate: string } };
    expect(data.range).toEqual({ startDate: "2026-02-01", endDate: "2026-02-28" });
  });

  it("returns friendly message when no rows", async () => {
    gscFlow([]);
    const result = await runSeoGscTopPages({ siteUrl: "https://neo.ai/" }, GSC_CONFIG, makeRunCtx());
    expect(result.error).toBeUndefined();
    expect(result.content).toMatch(/No GSC page data/);
  });

  it("surfaces GSC API errors", async () => {
    gscFlow([], { analyticsOk: false, analyticsStatus: 403 });
    const result = await runSeoGscTopPages({ siteUrl: "https://neo.ai/" }, GSC_CONFIG, makeRunCtx());
    expect(result.error).toMatch(/403/);
  });
});
