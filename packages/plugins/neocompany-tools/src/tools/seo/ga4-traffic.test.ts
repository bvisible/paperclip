//// Neocompany Modification — tests for seoGa4Traffic (GA4 Data API)
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSeoGa4Traffic } from "./ga4-traffic.js";
import { makeRunCtx } from "../../__tests__/test-helpers.js";

const GA4_CONFIG = {
  clientId: "c",
  clientSecret: "s",
  refreshToken: "r",
  propertyId: "367221234",
};

const originalFetch = globalThis.fetch;

function ga4Flow(metricValues: string[], opts: { reportOk?: boolean; reportStatus?: number } = {}) {
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
      ok: opts.reportOk ?? true,
      status: opts.reportStatus ?? 200,
      json: async () => ({
        rows: [{ metricValues: metricValues.map((v) => ({ value: v })) }],
        rowCount: 1,
      }),
      text: async () => "GA4 down",
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("runSeoGa4Traffic", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns parsed traffic metrics", async () => {
    ga4Flow(["5000", "3200", "12000", "0.42", "180"]);
    const result = await runSeoGa4Traffic({}, GA4_CONFIG, makeRunCtx());
    expect(result.error).toBeUndefined();
    const data = result.data as {
      sessions: number;
      users: number;
      pageViews: number;
      bounceRate: number;
      avgSessionDuration: number;
    };
    expect(data.sessions).toBe(5000);
    expect(data.users).toBe(3200);
    expect(data.pageViews).toBe(12000);
    expect(data.bounceRate).toBeCloseTo(0.42);
    expect(data.avgSessionDuration).toBe(180);
  });

  it("defaults to 30daysAgo → today range", async () => {
    ga4Flow(["0", "0", "0", "0", "0"]);
    const result = await runSeoGa4Traffic({}, GA4_CONFIG, makeRunCtx());
    const data = result.data as { range: { startDate: string; endDate: string } };
    expect(data.range).toEqual({ startDate: "30daysAgo", endDate: "today" });
  });

  it("honours explicit start/end dates", async () => {
    ga4Flow(["0", "0", "0", "0", "0"]);
    const result = await runSeoGa4Traffic(
      { startDate: "2026-01-01", endDate: "2026-01-31" },
      GA4_CONFIG,
      makeRunCtx(),
    );
    const data = result.data as { range: { startDate: string; endDate: string } };
    expect(data.range).toEqual({ startDate: "2026-01-01", endDate: "2026-01-31" });
  });

  it("renders human-readable summary with numbers and percentage", async () => {
    ga4Flow(["5000", "3200", "12000", "0.42", "180"]);
    const result = await runSeoGa4Traffic({}, GA4_CONFIG, makeRunCtx());
    expect(result.content).toMatch(/Sessions:.*5,000/);
    expect(result.content).toMatch(/Bounce rate: 42\.0%/);
    expect(result.content).toMatch(/Avg session duration: 180s/);
  });

  it("returns zeros when GA4 returns no rows", async () => {
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
        json: async () => ({ rows: [], rowCount: 0 }),
        text: async () => "",
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await runSeoGa4Traffic({}, GA4_CONFIG, makeRunCtx());
    const data = result.data as { sessions: number; users: number };
    expect(data.sessions).toBe(0);
    expect(data.users).toBe(0);
  });

  it("surfaces Ga4ApiError on report failure", async () => {
    ga4Flow(["0", "0", "0", "0", "0"], { reportOk: false, reportStatus: 403 });
    const result = await runSeoGa4Traffic({}, GA4_CONFIG, makeRunCtx());
    expect(result.error).toMatch(/403/);
  });
});
