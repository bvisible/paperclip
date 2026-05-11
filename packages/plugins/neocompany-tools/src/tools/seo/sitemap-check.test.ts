//// Neocompany Modification — tests for seoSitemapCheck (mocked fetch)
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSeoSitemapCheck } from "./sitemap-check.js";
import { makeRunCtx } from "../../__tests__/test-helpers.js";

const originalFetch = globalThis.fetch;

function mockFetchOnce(body: string, init: { ok?: boolean; status?: number } = {}) {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 404);
  globalThis.fetch = vi.fn(async () => ({
    ok,
    status,
    text: async () => body,
  })) as unknown as typeof fetch;
}

const SITEMAP_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc><lastmod>2026-05-01</lastmod></url>
  <url><loc>https://example.com/about</loc><lastmod>2026-04-10</lastmod></url>
  <url><loc>https://example.com/contact</loc><lastmod>2026-03-15</lastmod></url>
  <url><loc>https://example.com/blog</loc><lastmod>2026-05-08</lastmod></url>
  <url><loc>https://example.com/blog/post-1</loc><lastmod>2026-05-07</lastmod></url>
  <url><loc>https://example.com/blog/post-2</loc><lastmod>2026-04-30</lastmod></url>
</urlset>`;

const SITEMAP_INDEX_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-2.xml</loc></sitemap>
</sitemapindex>`;

describe("runSeoSitemapCheck", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requires a url param", async () => {
    const result = await runSeoSitemapCheck({ url: "" }, makeRunCtx());
    expect(result.error).toMatch(/required/);
  });

  it("rejects an invalid url", async () => {
    const result = await runSeoSitemapCheck({ url: "not a url" }, makeRunCtx());
    expect(result.error).toMatch(/Invalid URL/);
  });

  it("defaults to /sitemap.xml when input is just an origin", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => SITEMAP_BODY,
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await runSeoSitemapCheck({ url: "https://example.com" }, makeRunCtx());
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/sitemap.xml",
      expect.any(Object),
    );
  });

  it("uses the URL as-is when it already contains 'sitemap'", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => SITEMAP_BODY,
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await runSeoSitemapCheck(
      { url: "https://example.com/special/sitemap-news.xml" },
      makeRunCtx(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/special/sitemap-news.xml",
      expect.any(Object),
    );
  });

  it("reports exists=false on HTTP 404", async () => {
    mockFetchOnce("", { ok: false, status: 404 });
    const result = await runSeoSitemapCheck({ url: "https://example.com" }, makeRunCtx());
    const data = result.data as { exists: boolean; status: number };
    expect(data.exists).toBe(false);
    expect(data.status).toBe(404);
  });

  it("counts URLs, extracts lastmod, and flags no issues for a healthy sitemap", async () => {
    mockFetchOnce(SITEMAP_BODY);
    const result = await runSeoSitemapCheck({ url: "https://example.com" }, makeRunCtx());
    const data = result.data as {
      exists: boolean;
      urlCount: number;
      isSitemapIndex: boolean;
      lastModified: string;
      sampleUrls: string[];
      issues: string[];
    };
    expect(data.exists).toBe(true);
    expect(data.urlCount).toBe(6);
    expect(data.isSitemapIndex).toBe(false);
    expect(data.lastModified).toBe("2026-05-08");
    expect(data.sampleUrls).toHaveLength(5);
    expect(data.sampleUrls[0]).toBe("https://example.com/");
    expect(data.issues).toHaveLength(0);
  });

  it("detects sitemap index format", async () => {
    mockFetchOnce(SITEMAP_INDEX_BODY);
    const result = await runSeoSitemapCheck({ url: "https://example.com" }, makeRunCtx());
    const data = result.data as { isSitemapIndex: boolean; urlCount: number };
    expect(data.isSitemapIndex).toBe(true);
    expect(data.urlCount).toBe(2);
  });

  it("flags an empty sitemap as an issue", async () => {
    mockFetchOnce(`<?xml version="1.0"?><urlset></urlset>`);
    const result = await runSeoSitemapCheck({ url: "https://example.com" }, makeRunCtx());
    const data = result.data as { issues: string[]; urlCount: number };
    expect(data.urlCount).toBe(0);
    expect(data.issues.some((i) => i.includes("empty"))).toBe(true);
  });

  it("flags very few URLs (<5) when not a sitemap index", async () => {
    const tinySitemap = `<?xml version="1.0"?><urlset>
      <url><loc>https://example.com/a</loc></url>
      <url><loc>https://example.com/b</loc></url>
    </urlset>`;
    mockFetchOnce(tinySitemap);
    const result = await runSeoSitemapCheck({ url: "https://example.com" }, makeRunCtx());
    const data = result.data as { issues: string[] };
    expect(data.issues.some((i) => i.includes("Very few"))).toBe(true);
  });

  it("returns graceful error on network failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await runSeoSitemapCheck({ url: "https://example.com" }, makeRunCtx());
    expect(result.error).toMatch(/ECONNREFUSED/);
  });
});
