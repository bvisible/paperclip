//// Neocompany Modification — tests for seoRobotsCheck (mocked fetch)
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSeoRobotsCheck } from "./robots-check.js";
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

describe("runSeoRobotsCheck", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("errors out without a url param", async () => {
    const result = await runSeoRobotsCheck({ url: "" }, makeRunCtx());
    expect(result.error).toMatch(/required/);
  });

  it("rejects an invalid url with a clear error", async () => {
    const result = await runSeoRobotsCheck({ url: "not a url" }, makeRunCtx());
    expect(result.error).toMatch(/Invalid URL/);
  });

  it("reports absent robots.txt when the fetch returns non-2xx", async () => {
    mockFetchOnce("", { ok: false, status: 404 });
    const result = await runSeoRobotsCheck(
      { url: "https://example.com/page" },
      makeRunCtx(),
    );
    expect(result.error).toBeUndefined();
    const data = result.data as { exists: boolean; status: number };
    expect(data.exists).toBe(false);
    expect(data.status).toBe(404);
  });

  it("flags AI bots as BLOCKED when robots.txt disallows them", async () => {
    const robots = [
      "User-agent: GPTBot",
      "Disallow: /",
      "",
      "User-agent: ClaudeBot",
      "Disallow: /",
      "",
      "User-agent: *",
      "Allow: /",
      "Sitemap: https://example.com/sitemap.xml",
    ].join("\n");
    mockFetchOnce(robots);

    const result = await runSeoRobotsCheck({ url: "https://example.com" }, makeRunCtx());
    const data = result.data as {
      exists: boolean;
      sitemapUrls: string[];
      aiBotsStatus: Record<string, string>;
      issues: string[];
    };
    expect(data.exists).toBe(true);
    expect(data.aiBotsStatus.GPTBot).toBe("BLOCKED");
    expect(data.aiBotsStatus.ClaudeBot).toBe("BLOCKED");
    expect(data.aiBotsStatus.GoogleBot).toBe("not mentioned (allowed by default)");
    expect(data.sitemapUrls).toEqual(["https://example.com/sitemap.xml"]);
    expect(data.issues.some((i) => i.includes("GPTBot blocked"))).toBe(true);
    expect(data.issues.some((i) => i.includes("ClaudeBot blocked"))).toBe(true);
  });

  it("reports no issues when robots.txt is empty (everything allowed by default)", async () => {
    mockFetchOnce("Sitemap: https://example.com/sitemap.xml\n");
    const result = await runSeoRobotsCheck({ url: "https://example.com" }, makeRunCtx());
    const data = result.data as { issues: string[]; sitemapUrls: string[] };
    expect(data.issues).toHaveLength(0);
    expect(data.sitemapUrls).toEqual(["https://example.com/sitemap.xml"]);
  });

  it("flags 'no sitemap declared' as an issue", async () => {
    mockFetchOnce("User-agent: *\nAllow: /\n");
    const result = await runSeoRobotsCheck({ url: "https://example.com" }, makeRunCtx());
    const data = result.data as { issues: string[] };
    expect(data.issues.some((i) => i.includes("No sitemap"))).toBe(true);
  });

  it("uses only the origin from the input URL (strips path + query)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "",
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    await runSeoRobotsCheck(
      { url: "https://example.com/deep/path?x=1" },
      makeRunCtx(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/robots.txt",
      expect.any(Object),
    );
  });

  it("falls back to Claude-Web when ClaudeBot is not mentioned", async () => {
    const robots = "User-agent: Claude-Web\nDisallow: /\n";
    mockFetchOnce(robots);
    const result = await runSeoRobotsCheck({ url: "https://example.com" }, makeRunCtx());
    const data = result.data as { aiBotsStatus: Record<string, string> };
    expect(data.aiBotsStatus.ClaudeBot).toBe("BLOCKED");
  });

  it("returns a graceful error when the fetch throws", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const result = await runSeoRobotsCheck({ url: "https://example.com" }, makeRunCtx());
    expect(result.error).toMatch(/network down/);
  });
});
