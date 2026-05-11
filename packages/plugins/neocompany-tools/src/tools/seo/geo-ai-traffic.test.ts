//// Neocompany Modification — tests for geoAITraffic (GA4 AI referrals)
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGeoAITraffic } from "./geo-ai-traffic.js";
import { makeRunCtx } from "../../__tests__/test-helpers.js";

const GA4_CONFIG = {
  clientId: "c",
  clientSecret: "s",
  refreshToken: "r",
  propertyId: "999",
};

const originalFetch = globalThis.fetch;

function ga4SourcesFlow(rows: Array<{ source: string; sessions: number; users: number }>) {
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
          dimensionValues: [{ value: r.source }],
          metricValues: [
            { value: String(r.sessions) },
            { value: String(r.users) },
          ],
        })),
        rowCount: rows.length,
      }),
      text: async () => "",
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("runGeoAITraffic", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("extracts AI referrals from GA4 sessionSource report", async () => {
    ga4SourcesFlow([
      { source: "google", sessions: 5000, users: 4500 },
      { source: "chatgpt.com", sessions: 300, users: 250 },
      { source: "perplexity.ai", sessions: 150, users: 130 },
      { source: "direct", sessions: 1000, users: 800 },
      { source: "claude.ai", sessions: 50, users: 45 },
    ]);
    const result = await runGeoAITraffic({}, GA4_CONFIG, makeRunCtx());
    expect(result.error).toBeUndefined();
    const data = result.data as {
      totalSessions: number;
      totalAISessions: number;
      aiReferrals: Array<{ source: string }>;
      aiPercentage: number;
    };
    expect(data.totalSessions).toBe(6500);
    expect(data.totalAISessions).toBe(500);  // 300 + 150 + 50
    expect(data.aiReferrals.map((r) => r.source)).toEqual([
      "chatgpt.com",
      "perplexity.ai",
      "claude.ai",
    ]);
    // 500/6500 ≈ 7.69%
    expect(data.aiPercentage).toBeCloseTo(7.69, 1);
  });

  it("returns 0% AI when no AI sources are present", async () => {
    ga4SourcesFlow([
      { source: "google", sessions: 1000, users: 800 },
      { source: "facebook.com", sessions: 200, users: 180 },
    ]);
    const result = await runGeoAITraffic({}, GA4_CONFIG, makeRunCtx());
    const data = result.data as { aiPercentage: number; totalAISessions: number; aiReferrals: unknown[] };
    expect(data.totalAISessions).toBe(0);
    expect(data.aiPercentage).toBe(0);
    expect(data.aiReferrals).toEqual([]);
  });

  it("sorts AI referrals by sessions descending", async () => {
    ga4SourcesFlow([
      { source: "you.com", sessions: 10, users: 9 },
      { source: "chatgpt.com", sessions: 500, users: 400 },
      { source: "perplexity.ai", sessions: 250, users: 200 },
    ]);
    const result = await runGeoAITraffic({}, GA4_CONFIG, makeRunCtx());
    const data = result.data as { aiReferrals: Array<{ source: string }> };
    expect(data.aiReferrals.map((r) => r.source)).toEqual([
      "chatgpt.com",
      "perplexity.ai",
      "you.com",
    ]);
  });

  it("recognises chat.openai.com as an AI source (legacy ChatGPT URL)", async () => {
    ga4SourcesFlow([{ source: "chat.openai.com", sessions: 75, users: 60 }]);
    const result = await runGeoAITraffic({}, GA4_CONFIG, makeRunCtx());
    const data = result.data as { aiReferrals: Array<{ source: string; sessions: number }> };
    expect(data.aiReferrals).toEqual([
      { source: "chat.openai.com", sessions: 75, users: 60 },
    ]);
  });

  it("surfaces GA4 API errors", async () => {
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
        text: async () => "GA4 down",
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const result = await runGeoAITraffic({}, GA4_CONFIG, makeRunCtx());
    expect(result.error).toMatch(/500/);
  });
});
