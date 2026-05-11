//// Neocompany Modification — tests for wpListPosts (REST mock + status mapping)
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWpListPosts } from "./list-posts.js";
import { makeRunCtx } from "../../__tests__/test-helpers.js";

const WP_CONFIG = {
  siteUrl: "https://wp.example.com",
  username: "neo",
  appPassword: "pwd",
};

const originalFetch = globalThis.fetch;

function mockFetchPosts(rows: unknown[]) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(rows),
  })) as unknown as typeof fetch;
}

describe("runWpListPosts", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns posts with stripped HTML in title + excerpt", async () => {
    mockFetchPosts([
      {
        id: 1,
        status: "publish",
        date: "2026-05-01T10:00:00",
        link: "https://wp.example.com/hello",
        title: { rendered: "<strong>Hello</strong> &amp; world" },
        excerpt: { rendered: "<p>This is the <em>excerpt</em>.</p>" },
      },
    ]);
    const result = await runWpListPosts({}, WP_CONFIG, makeRunCtx());
    const data = result.data as { posts: Array<{ title: string; excerpt: string }> };
    expect(data.posts[0].title).toBe("Hello &amp; world");
    expect(data.posts[0].excerpt).toBe("This is the excerpt.");
  });

  it("status=any maps to publish,draft,pending in the API query", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "[]",
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await runWpListPosts({ status: "any" }, WP_CONFIG, makeRunCtx());
    const url = (fetchMock as unknown as { mock: { calls: Array<[string, unknown]> } }).mock.calls[0][0];
    expect(url).toContain("status=publish%2Cdraft%2Cpending");
  });

  it("status=publish passes through verbatim", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "[]",
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await runWpListPosts({ status: "publish" }, WP_CONFIG, makeRunCtx());
    const url = (fetchMock as unknown as { mock: { calls: Array<[string, unknown]> } }).mock.calls[0][0];
    expect(url).toContain("status=publish");
    expect(url).not.toContain("draft");
  });

  it("default perPage = 10", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "[]",
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await runWpListPosts({}, WP_CONFIG, makeRunCtx());
    const url = (fetchMock as unknown as { mock: { calls: Array<[string, unknown]> } }).mock.calls[0][0];
    expect(url).toContain("per_page=10");
  });

  it("perPage override is forwarded", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "[]",
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await runWpListPosts({ perPage: 50 }, WP_CONFIG, makeRunCtx());
    const url = (fetchMock as unknown as { mock: { calls: Array<[string, unknown]> } }).mock.calls[0][0];
    expect(url).toContain("per_page=50");
  });

  it("search term lands in the query", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "[]",
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await runWpListPosts({ search: "react" }, WP_CONFIG, makeRunCtx());
    const url = (fetchMock as unknown as { mock: { calls: Array<[string, unknown]> } }).mock.calls[0][0];
    expect(url).toContain("search=react");
  });

  it("WordPress API error surfaces with status code", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ message: "Bad auth" }),
    })) as unknown as typeof fetch;
    const result = await runWpListPosts({}, WP_CONFIG, makeRunCtx());
    expect(result.error).toMatch(/401/);
    expect(result.error).toMatch(/Bad auth/);
  });

  it("truncates excerpt to 160 chars", async () => {
    const longExcerpt = "a".repeat(500);
    mockFetchPosts([{ id: 1, title: { rendered: "T" }, excerpt: { rendered: longExcerpt } }]);
    const result = await runWpListPosts({}, WP_CONFIG, makeRunCtx());
    const data = result.data as { posts: Array<{ excerpt: string }> };
    expect(data.posts[0].excerpt.length).toBe(160);
  });
});
