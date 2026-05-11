//// Neocompany Modification — tests for seoPageSpeed (PSI JSON parser)
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSeoPageSpeed } from "./pagespeed.js";
import { makeRunCtx } from "../../__tests__/test-helpers.js";

const originalFetch = globalThis.fetch;

function mockPSI(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 500);
  globalThis.fetch = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

const PSI_RESPONSE = {
  lighthouseResult: {
    categories: {
      performance: { score: 0.92 },
      seo: { score: 0.95 },
      accessibility: { score: 0.88 },
      "best-practices": { score: 1.0 },
    },
    audits: {
      "largest-contentful-paint": { displayValue: "1.4 s" },
      "cumulative-layout-shift": { displayValue: "0.02" },
      "interaction-to-next-paint": { displayValue: "120 ms" },
      "render-blocking-resources": {
        title: "Eliminate render-blocking resources",
        score: 0.4,
        details: { overallSavingsMs: 850 },
      },
      "unused-css-rules": {
        title: "Reduce unused CSS",
        score: 0.9,
      },
    },
  },
};

describe("runSeoPageSpeed", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requires a url", async () => {
    const result = await runSeoPageSpeed({ url: "" }, {}, makeRunCtx());
    expect(result.error).toMatch(/required/);
  });

  it("returns error on PSI HTTP failure", async () => {
    mockPSI({}, { ok: false, status: 429 });
    const result = await runSeoPageSpeed({ url: "https://example.com" }, {}, makeRunCtx());
    expect(result.error).toMatch(/429/);
  });

  it("parses scores, core web vitals, and top recommendations", async () => {
    mockPSI(PSI_RESPONSE);
    const result = await runSeoPageSpeed(
      { url: "https://example.com", strategy: "desktop" },
      {},
      makeRunCtx(),
    );
    expect(result.error).toBeUndefined();
    const data = result.data as {
      strategy: string;
      scores: { performance: number; seo: number; accessibility: number; bestPractices: number };
      coreWebVitals: { lcp: string; cls: string; inp: string };
      recommendations: string[];
    };
    expect(data.strategy).toBe("desktop");
    expect(data.scores).toEqual({
      performance: 92,
      seo: 95,
      accessibility: 88,
      bestPractices: 100,
    });
    expect(data.coreWebVitals.lcp).toBe("1.4 s");
    expect(data.coreWebVitals.cls).toBe("0.02");
    expect(data.coreWebVitals.inp).toBe("120 ms");
    expect(data.recommendations).toContain("Eliminate render-blocking resources (save 850ms)");
    // unused-css has score 0.9 (still imperfect) — it's included too.
    expect(data.recommendations.some((r) => r.startsWith("Reduce unused CSS"))).toBe(true);
  });

  it("defaults strategy to 'mobile' when omitted", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => PSI_RESPONSE,
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await runSeoPageSpeed({ url: "https://example.com" }, {}, makeRunCtx());
    const url = (fetchMock as unknown as { mock: { calls: Array<[string]> } }).mock.calls[0][0];
    expect(url).toContain("strategy=mobile");
  });

  it("appends the API key when provided in config", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => PSI_RESPONSE,
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await runSeoPageSpeed(
      { url: "https://example.com" },
      { apiKey: "AIzaSyTEST" },
      makeRunCtx(),
    );
    const url = (fetchMock as unknown as { mock: { calls: Array<[string]> } }).mock.calls[0][0];
    expect(url).toContain("key=AIzaSyTEST");
  });

  it("falls back to max-potential-fid when INP is missing", async () => {
    const body = {
      lighthouseResult: {
        categories: { performance: { score: 1 } },
        audits: {
          "max-potential-fid": { displayValue: "200 ms" },
          // no interaction-to-next-paint
        },
      },
    };
    mockPSI(body);
    const result = await runSeoPageSpeed({ url: "https://example.com" }, {}, makeRunCtx());
    const data = result.data as { coreWebVitals: { inp: string } };
    expect(data.coreWebVitals.inp).toBe("200 ms");
  });

  it("handles network failure gracefully", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ETIMEDOUT");
    }) as unknown as typeof fetch;
    const result = await runSeoPageSpeed({ url: "https://example.com" }, {}, makeRunCtx());
    expect(result.error).toMatch(/ETIMEDOUT/);
  });

  it("returns 'N/A' for missing CWV metrics", async () => {
    const body = {
      lighthouseResult: {
        categories: { performance: { score: 0.5 } },
        audits: {},
      },
    };
    mockPSI(body);
    const result = await runSeoPageSpeed({ url: "https://example.com" }, {}, makeRunCtx());
    const data = result.data as { coreWebVitals: { lcp: string; cls: string; inp: string } };
    expect(data.coreWebVitals).toEqual({ lcp: "N/A", cls: "N/A", inp: "N/A" });
  });

  it("recommendations are capped at 5", async () => {
    const audits: Record<string, { title: string; score: number }> = {};
    for (const k of [
      "render-blocking-resources",
      "unused-css-rules",
      "unused-javascript",
      "offscreen-images",
      "unminified-css",
      "unminified-javascript",
      "modern-image-formats",
    ]) {
      audits[k] = { title: k, score: 0.2 };
    }
    mockPSI({
      lighthouseResult: { categories: {}, audits },
    });
    const result = await runSeoPageSpeed({ url: "https://example.com" }, {}, makeRunCtx());
    const data = result.data as { recommendations: string[] };
    expect(data.recommendations).toHaveLength(5);
  });
});
