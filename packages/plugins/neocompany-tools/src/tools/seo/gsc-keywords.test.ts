//// Neocompany Modification — tests for seoGscKeywords (Google OAuth + GSC API)
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSeoGscKeywords } from "./gsc-keywords.js";
import { makeRunCtx } from "../../__tests__/test-helpers.js";

const GSC_CONFIG = {
  clientId: "client.apps.googleusercontent.com",
  clientSecret: "secret",
  refreshToken: "refresh-token",
};

const originalFetch = globalThis.fetch;

/**
 * Sequenced fetch mock: every call consumes the next response from the queue.
 * GSC pattern is always: POST /token → POST /searchAnalytics/query.
 */
function queueFetchResponses(responses: Array<{ ok?: boolean; status?: number; json?: () => Promise<unknown>; text?: () => Promise<string> }>) {
  let i = 0;
  globalThis.fetch = vi.fn(async () => {
    const r = responses[i] ?? responses[responses.length - 1];
    i++;
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: r.json ?? (async () => ({})),
      text: r.text ?? (async () => ""),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("runSeoGscKeywords", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requires siteUrl", async () => {
    const result = await runSeoGscKeywords({ siteUrl: "" }, GSC_CONFIG, makeRunCtx());
    expect(result.error).toMatch(/siteUrl/);
  });

  it("refreshes the access token then queries searchAnalytics with the bearer", async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "ya29.abc" }),
        text: async () => "",
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          rows: [
            { keys: ["paperclip"], clicks: 50, impressions: 1000, ctr: 0.05, position: 3.2 },
            { keys: ["openclaw"], clicks: 30, impressions: 800, ctr: 0.0375, position: 5.1 },
          ],
        }),
        text: async () => "",
      } as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await runSeoGscKeywords(
      { siteUrl: "https://neoservice.ai/", limit: 10 },
      GSC_CONFIG,
      makeRunCtx(),
    );
    expect(result.error).toBeUndefined();
    const data = result.data as {
      siteUrl: string;
      keywords: Array<{ query: string; clicks: number; ctr: number; position: number }>;
    };
    expect(data.siteUrl).toBe("https://neoservice.ai/");
    expect(data.keywords).toHaveLength(2);
    expect(data.keywords[0].query).toBe("paperclip");
    expect(data.keywords[0].clicks).toBe(50);

    // Token refresh first call.
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, { method: string; body: URLSearchParams }];
    expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(tokenInit.method).toBe("POST");

    // Then the analytics call with the bearer.
    const [analyticsUrl, analyticsInit] = fetchMock.mock.calls[1] as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(analyticsUrl).toContain("https://www.googleapis.com/webmasters/v3/sites/");
    expect(analyticsUrl).toContain(encodeURIComponent("https://neoservice.ai/"));
    expect(analyticsInit.headers.Authorization).toBe("Bearer ya29.abc");
    const sentBody = JSON.parse(analyticsInit.body);
    expect(sentBody.dimensions).toEqual(["query"]);
    expect(sentBody.rowLimit).toBe(10);
  });

  it("uses the explicit date range when both startDate and endDate are passed", async () => {
    queueFetchResponses([
      { json: async () => ({ access_token: "tok" }) },
      { json: async () => ({ rows: [] }) },
    ]);
    const result = await runSeoGscKeywords(
      { siteUrl: "sc-domain:example.com", startDate: "2026-01-01", endDate: "2026-01-31" },
      GSC_CONFIG,
      makeRunCtx(),
    );
    const data = result.data as { range: { startDate: string; endDate: string } };
    expect(data.range.startDate).toBe("2026-01-01");
    expect(data.range.endDate).toBe("2026-01-31");
  });

  it("returns friendly message when GSC returns no rows", async () => {
    queueFetchResponses([
      { json: async () => ({ access_token: "tok" }) },
      { json: async () => ({}) },
    ]);
    const result = await runSeoGscKeywords({ siteUrl: "https://neo.ai/" }, GSC_CONFIG, makeRunCtx());
    expect(result.error).toBeUndefined();
    expect(result.content).toMatch(/No GSC data/);
    const data = result.data as { keywords: unknown[] };
    expect(data.keywords).toEqual([]);
  });

  it("surfaces GscApiError when the analytics call fails", async () => {
    queueFetchResponses([
      { json: async () => ({ access_token: "tok" }) },
      { ok: false, status: 403, text: async () => "User does not have access" },
    ]);
    const result = await runSeoGscKeywords({ siteUrl: "https://neo.ai/" }, GSC_CONFIG, makeRunCtx());
    expect(result.error).toMatch(/403/);
    expect(result.error).toMatch(/User does not have access/);
  });

  it("surfaces token refresh failures", async () => {
    queueFetchResponses([
      { ok: false, status: 401, text: async () => "invalid_grant" },
    ]);
    const result = await runSeoGscKeywords({ siteUrl: "https://neo.ai/" }, GSC_CONFIG, makeRunCtx());
    expect(result.error).toMatch(/Google token refresh failed/);
    expect(result.error).toMatch(/401/);
  });

  it("returns clear error when the OAuth response is missing access_token", async () => {
    queueFetchResponses([
      { json: async () => ({}) },
    ]);
    const result = await runSeoGscKeywords({ siteUrl: "https://neo.ai/" }, GSC_CONFIG, makeRunCtx());
    expect(result.error).toMatch(/did not return an access_token/);
  });
});
