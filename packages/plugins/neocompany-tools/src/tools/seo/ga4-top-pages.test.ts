//// Neocompany Modification — tests for seoGa4TopPages
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSeoGa4TopPages } from "./ga4-top-pages.js";
import { makeRunCtx } from "../../__tests__/test-helpers.js";

const GA4_CONFIG = {
  clientId: "c",
  clientSecret: "s",
  refreshToken: "r",
  propertyId: "999",
};

const originalFetch = globalThis.fetch;

function ga4Flow(rows: Array<{ path: string; sessions: number; users: number; views: number }>) {
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
      json: async () => ({
        rows: rows.map((r) => ({
          dimensionValues: [{ value: r.path }],
          metricValues: [
            { value: String(r.sessions) },
            { value: String(r.users) },
            { value: String(r.views) },
          ],
        })),
        rowCount: rows.length,
      }),
      text: async () => "",
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("runSeoGa4TopPages", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns top pages with parsed metrics", async () => {
    ga4Flow([
      { path: "/", sessions: 5000, users: 3500, views: 7000 },
      { path: "/blog", sessions: 1500, users: 1100, views: 2400 },
    ]);
    const result = await runSeoGa4TopPages({}, GA4_CONFIG, makeRunCtx());
    const data = result.data as { pages: Array<{ path: string; sessions: number }> };
    expect(data.pages).toEqual([
      { path: "/", sessions: 5000, users: 3500, pageViews: 7000 },
      { path: "/blog", sessions: 1500, users: 1100, pageViews: 2400 },
    ]);
  });

  it("clamps limit between 1 and 100", async () => {
    ga4Flow([]);
    const result = await runSeoGa4TopPages({ limit: 9999 }, GA4_CONFIG, makeRunCtx());
    expect(result.error).toBeUndefined();
    // Verify the limit reached the GA4 API call body.
    // The 2nd fetch was the actual report call.
    expect((globalThis.fetch as unknown as { mock: { calls: Array<[unknown, { body: string }]> } }).mock.calls[1][1].body).toContain('"limit":100');
  });

  it("returns friendly message when no rows", async () => {
    ga4Flow([]);
    const result = await runSeoGa4TopPages({}, GA4_CONFIG, makeRunCtx());
    expect(result.content).toMatch(/No GA4 page data/);
  });

  it("orders by sessions desc (forwarded to GA4 query)", async () => {
    ga4Flow([]);
    await runSeoGa4TopPages({}, GA4_CONFIG, makeRunCtx());
    const callArgs = (globalThis.fetch as unknown as { mock: { calls: Array<[unknown, { body: string }]> } }).mock.calls[1];
    const sentBody = JSON.parse(callArgs[1].body);
    expect(sentBody.orderBys).toEqual([
      { metric: { metricName: "sessions" }, desc: true },
    ]);
  });
});
