//// Neocompany Modification — tests for seoTrendAnalysis (2-period diff)
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSeoTrendAnalysis } from "./trend-analysis.js";
import { makeRunCtx } from "../../__tests__/test-helpers.js";

const GSC_CONFIG = { clientId: "c", clientSecret: "s", refreshToken: "r" };
const originalFetch = globalThis.fetch;

/**
 * Sets up fetch so:
 *   - every `oauth2.googleapis.com/token` call returns a token
 *   - the first analytics call returns the "recent" rows
 *   - the second analytics call returns the "previous" rows
 *
 * Trend-analysis fires the two analytics queries in parallel via Promise.all,
 * but the test makes no assumption on order — we differentiate by the
 * startDate in the request body: the more recent window has a startDate
 * lexicographically greater than the previous window's startDate.
 */
function trendFlow(
  recentRows: Array<{ q: string; clicks: number }>,
  previousRows: Array<{ q: string; clicks: number }>,
) {
  // Discriminate the two windows by comparing the body's startDate against
  // a reference computed the same way as the impl: the previous window
  // starts at `now - recentDays - compareDays` (= ~60 days ago for defaults),
  // the recent window starts at `now - recentDays` (= ~30 days ago).
  // Any analytics request with a startDate that lands AFTER the half-way
  // point (~45 days ago) is the recent one.
  const today = new Date();
  const fortyFiveDaysAgo = new Date(today);
  fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45);
  const cutoff = fortyFiveDaysAgo.toISOString().slice(0, 10);

  globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as { toString: () => string }).toString();
    if (url.includes("oauth2.googleapis.com/token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "tok" }),
        text: async () => "",
      } as unknown as Response;
    }
    const body = JSON.parse((init?.body as string) ?? "{}");
    const isRecent = body.startDate >= cutoff;
    const rows = isRecent ? recentRows : previousRows;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        rows: rows.map((r) => ({
          keys: [r.q],
          clicks: r.clicks,
          impressions: r.clicks * 10,
        })),
      }),
      text: async () => "",
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("runSeoTrendAnalysis", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requires siteUrl", async () => {
    const result = await runSeoTrendAnalysis({ siteUrl: "" }, GSC_CONFIG, makeRunCtx());
    expect(result.error).toMatch(/siteUrl/);
  });

  it("identifies growing and declining keywords vs the previous window", async () => {
    trendFlow(
      [
        { q: "growing", clicks: 100 },
        { q: "declining", clicks: 10 },
        { q: "stable", clicks: 50 },
      ],
      [
        { q: "growing", clicks: 20 },
        { q: "declining", clicks: 100 },
        { q: "stable", clicks: 55 },
      ],
    );
    const result = await runSeoTrendAnalysis(
      { siteUrl: "https://neo.ai/" },
      GSC_CONFIG,
      makeRunCtx(),
    );
    expect(result.error).toBeUndefined();
    const data = result.data as {
      trendingUp: Array<{ query: string; change: string }>;
      trendingDown: Array<{ query: string; change: string }>;
    };
    expect(data.trendingUp.map((t) => t.query)).toContain("growing");
    expect(data.trendingDown.map((t) => t.query)).toContain("declining");
  });

  it("returns valid data shape", async () => {
    trendFlow(
      [{ q: "a", clicks: 100 }, { q: "b", clicks: 200 }],
      [{ q: "a", clicks: 50 }, { q: "b", clicks: 50 }],
    );
    const result = await runSeoTrendAnalysis(
      { siteUrl: "https://neo.ai/" },
      GSC_CONFIG,
      makeRunCtx(),
    );
    const data = result.data as {
      siteUrl: string;
      trendingUp: unknown[];
      trendingDown: unknown[];
      overallChange: number;
    };
    expect(data.siteUrl).toBe("https://neo.ai/");
    expect(Array.isArray(data.trendingUp)).toBe(true);
    expect(Array.isArray(data.trendingDown)).toBe(true);
  });

  it("surfaces GSC API errors", async () => {
    globalThis.fetch = vi.fn(async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as { toString: () => string }).toString();
      if (url.includes("oauth2.googleapis.com/token")) {
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

    const result = await runSeoTrendAnalysis(
      { siteUrl: "https://neo.ai/" },
      GSC_CONFIG,
      makeRunCtx(),
    );
    expect(result.error).toMatch(/500/);
  });
});
