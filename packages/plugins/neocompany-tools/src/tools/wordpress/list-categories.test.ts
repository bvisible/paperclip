//// Neocompany Modification — tests for wpListCategories (REST mock)
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWpListCategories } from "./list-categories.js";
import { makeRunCtx } from "../../__tests__/test-helpers.js";

const WP_CONFIG = {
  siteUrl: "https://wp.example.com",
  username: "neo",
  appPassword: "stub-password",
};

const originalFetch = globalThis.fetch;

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 500);
  globalThis.fetch = vi.fn(async () => ({
    ok,
    status,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

describe("runWpListCategories", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("lists categories by default", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([
        { id: 1, name: "News", slug: "news", count: 12 },
        { id: 2, name: "Reviews", slug: "reviews", count: 5 },
      ]),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const result = await runWpListCategories({}, WP_CONFIG, makeRunCtx());

    expect(result.error).toBeUndefined();
    const data = result.data as { type: string; items: Array<{ id: number; name: string }> };
    expect(data.type).toBe("categories");
    expect(data.items).toHaveLength(2);
    expect(data.items[0].name).toBe("News");
    // Hit the categories endpoint with per_page=100.
    const calledUrl = (fetchMock as unknown as { mock: { calls: Array<[string, unknown]> } }).mock.calls[0][0];
    expect(calledUrl).toContain("/wp-json/wp/v2/categories");
    expect(calledUrl).toContain("per_page=100");
  });

  it("switches to tags endpoint when type=tags", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{ id: 10, name: "ai", slug: "ai", count: 3 }]),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const result = await runWpListCategories({ type: "tags" }, WP_CONFIG, makeRunCtx());
    expect(result.error).toBeUndefined();
    const data = result.data as { type: string };
    expect(data.type).toBe("tags");
    const calledUrl = (fetchMock as unknown as { mock: { calls: Array<[string, unknown]> } }).mock.calls[0][0];
    expect(calledUrl).toContain("/wp-json/wp/v2/tags");
  });

  it("uses Basic auth (username + appPassword)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "[]",
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await runWpListCategories({}, WP_CONFIG, makeRunCtx());
    const init = (fetchMock as unknown as { mock: { calls: Array<[string, { headers: Record<string, string> }]> } }).mock.calls[0][1];
    expect(init.headers.Authorization).toMatch(/^Basic /);
    const decoded = Buffer.from(init.headers.Authorization.slice("Basic ".length), "base64").toString();
    expect(decoded).toBe("neo:stub-password");
  });

  it("normalises a friendly summary with count + singular/plural", async () => {
    mockFetchOnce([
      { id: 1, name: "Solo", slug: "solo", count: 1 },
      { id: 2, name: "Many", slug: "many", count: 7 },
    ]);
    const result = await runWpListCategories({}, WP_CONFIG, makeRunCtx());
    expect(result.content).toMatch(/Solo \(1 post\)/);
    expect(result.content).toMatch(/Many \(7 posts\)/);
  });

  it("handles empty list with explicit message", async () => {
    mockFetchOnce([]);
    const result = await runWpListCategories({}, WP_CONFIG, makeRunCtx());
    const data = result.data as { items: unknown[] };
    expect(data.items).toEqual([]);
    expect(result.content).toMatch(/no categories/);
  });

  it("returns a WordPress-shaped error on HTTP failure", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ code: "rest_unauthorized", message: "Invalid credentials" }),
    })) as unknown as typeof fetch;

    const result = await runWpListCategories({}, WP_CONFIG, makeRunCtx());
    expect(result.error).toMatch(/401/);
    expect(result.error).toMatch(/Invalid credentials/);
  });

  it("returns a graceful error on network failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ETIMEDOUT");
    }) as unknown as typeof fetch;
    const result = await runWpListCategories({}, WP_CONFIG, makeRunCtx());
    expect(result.error).toMatch(/ETIMEDOUT/);
  });

  it("tolerates rows with missing fields (defaults to '' / 0)", async () => {
    mockFetchOnce([{ id: 99 }]);
    const result = await runWpListCategories({}, WP_CONFIG, makeRunCtx());
    const data = result.data as { items: Array<{ id: number; name: string; count: number }> };
    expect(data.items[0]).toEqual({ id: 99, name: "", slug: "", count: 0 });
  });
});
