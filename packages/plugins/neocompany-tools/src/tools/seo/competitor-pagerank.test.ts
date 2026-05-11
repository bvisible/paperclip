//// Neocompany Modification — tests for seoCompetitorPageRank (Open PageRank API)
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSeoCompetitorPageRank } from "./competitor-pagerank.js";
import { makeRunCtx } from "../../__tests__/test-helpers.js";

const originalFetch = globalThis.fetch;

function mockOPR(rows: unknown[], init: { ok?: boolean; status?: number } = {}) {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 500);
  globalThis.fetch = vi.fn(async () => ({
    ok,
    status,
    json: async () => ({ response: rows }),
  })) as unknown as typeof fetch;
}

describe("runSeoCompetitorPageRank", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requires a non-empty domains array", async () => {
    const result = await runSeoCompetitorPageRank(
      { domains: [] },
      {},
      makeRunCtx(),
    );
    expect(result.error).toMatch(/non-empty/);
  });

  it("normalises https://, paths, and whitespace", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ response: [] }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await runSeoCompetitorPageRank(
      { domains: ["https://example.com/path", "  HTTPS://other.com/", "third.com"] },
      {},
      makeRunCtx(),
    );
    const url = (fetchMock as unknown as { mock: { calls: Array<[string, unknown]> } }).mock.calls[0][0];
    // The implementation builds the query manually as domains[]=… (no
    // URLSearchParams encoding of the brackets). Domain values themselves
    // are encodeURIComponent'd.
    expect(url).toContain("domains[]=example.com");
    expect(url).toContain("domains[]=other.com");
    expect(url).toContain("domains[]=third.com");
  });

  it("sorts comparison by pageRank descending", async () => {
    mockOPR([
      { domain: "low.com", page_rank_decimal: 2.1, rank: 9000 },
      { domain: "high.com", page_rank_decimal: 6.5, rank: 1200 },
      { domain: "mid.com", page_rank_decimal: 4.3, rank: 4500 },
    ]);
    const result = await runSeoCompetitorPageRank(
      { domains: ["low.com", "high.com", "mid.com"] },
      {},
      makeRunCtx(),
    );
    const data = result.data as { comparison: Array<{ domain: string; pageRank: number }> };
    expect(data.comparison.map((c) => c.domain)).toEqual(["high.com", "mid.com", "low.com"]);
  });

  it("sends API key in API-OPR header when provided", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ response: [] }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await runSeoCompetitorPageRank(
      { domains: ["example.com"] },
      { apiKey: "opr-secret" },
      makeRunCtx(),
    );
    const init = (fetchMock as unknown as { mock: { calls: Array<[string, { headers: Record<string, string> }]> } }).mock.calls[0][1];
    expect(init.headers["API-OPR"]).toBe("opr-secret");
  });

  it("retries once without API key on first failure (rate-limited key)", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 403, json: async () => ({}) } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ response: [{ domain: "example.com", page_rank_decimal: 5, rank: 1000 }] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await runSeoCompetitorPageRank(
      { domains: ["example.com"] },
      { apiKey: "bad-key" },
      makeRunCtx(),
    );
    expect(result.error).toBeUndefined();
    expect(callCount).toBe(2);
    const data = result.data as { comparison: Array<{ pageRank: number }> };
    expect(data.comparison[0].pageRank).toBe(5);
  });

  it("returns final error when both attempts fail", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const result = await runSeoCompetitorPageRank(
      { domains: ["example.com"] },
      { apiKey: "key" },
      makeRunCtx(),
    );
    expect(result.error).toMatch(/500/);
  });

  it("network failure on first call surfaces gracefully", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const result = await runSeoCompetitorPageRank(
      { domains: ["example.com"] },
      {},
      makeRunCtx(),
    );
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  it("tolerates rows with missing fields", async () => {
    mockOPR([{ domain: "example.com" }, {}]);
    const result = await runSeoCompetitorPageRank(
      { domains: ["example.com", "other.com"] },
      {},
      makeRunCtx(),
    );
    const data = result.data as { comparison: Array<{ pageRank: number; rank: number }> };
    expect(data.comparison.every((c) => c.pageRank === 0 && c.rank === 0)).toBe(true);
  });
});
