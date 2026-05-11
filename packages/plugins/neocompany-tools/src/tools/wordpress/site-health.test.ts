//// Neocompany Modification — tests for wpSiteHealth (multiple endpoints, x-wp-total header)
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWpSiteHealth } from "./site-health.js";
import { makeRunCtx } from "../../__tests__/test-helpers.js";

const WP_CONFIG = {
  siteUrl: "https://wp.example.com",
  username: "neo",
  appPassword: "pwd",
};

const originalFetch = globalThis.fetch;

interface MockResponse {
  ok?: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
  headers?: Record<string, string>;
}

function makeMockResponse(r: MockResponse): Response {
  return {
    ok: r.ok ?? true,
    status: r.status ?? 200,
    json: r.json ?? (async () => ({})),
    text: r.text ?? (async () => ""),
    headers: { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null },
  } as unknown as Response;
}

describe("runWpSiteHealth", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns clear error when /wp-json is unreachable", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await runWpSiteHealth({}, WP_CONFIG, makeRunCtx());
    expect(result.error).toMatch(/Unable to reach/);
  });

  it("aggregates site metadata + counts + post types", async () => {
    const routes: Record<string, MockResponse> = {
      "https://wp.example.com/wp-json": {
        json: async () => ({ name: "NeoBlog", description: "Posts about AI" }),
      },
      "https://wp.example.com/wp-json/wp/v2/types": {
        json: async () => ({
          post: { name: "post" },
          page: { name: "page" },
          attachment: { name: "attachment" }, // filtered out
          wp_block: { name: "wp_block" },     // filtered out (starts with wp_)
          product: { name: "product" },       // custom — kept
        }),
      },
      "https://wp.example.com/wp-json/wp/v2/posts?per_page=1": {
        headers: { "x-wp-total": "42" },
      },
      "https://wp.example.com/wp-json/wp/v2/pages?per_page=1": {
        headers: { "x-wp-total": "8" },
      },
      "https://wp.example.com/wp-json/wp/v2/media?per_page=1": {
        headers: { "x-wp-total": "120" },
      },
    };

    globalThis.fetch = vi.fn(async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as { toString: () => string }).toString();
      const mock = routes[url];
      if (!mock) throw new Error(`unmocked URL: ${url}`);
      return makeMockResponse(mock);
    }) as unknown as typeof fetch;

    const result = await runWpSiteHealth({}, WP_CONFIG, makeRunCtx());

    expect(result.error).toBeUndefined();
    const data = result.data as {
      siteName: string;
      description: string;
      totalPosts: number;
      totalPages: number;
      totalMedia: number;
      postTypes: string[];
    };
    expect(data.siteName).toBe("NeoBlog");
    expect(data.description).toBe("Posts about AI");
    expect(data.totalPosts).toBe(42);
    expect(data.totalPages).toBe(8);
    expect(data.totalMedia).toBe(120);
    expect(data.postTypes.sort()).toEqual(["page", "post", "product"]);
  });

  it("counts default to 0 when x-wp-total header is missing", async () => {
    const routes: Record<string, MockResponse> = {
      "https://wp.example.com/wp-json": { json: async () => ({ name: "X" }) },
      "https://wp.example.com/wp-json/wp/v2/types": { json: async () => ({ post: {} }) },
      "https://wp.example.com/wp-json/wp/v2/posts?per_page=1": { headers: {} },
      "https://wp.example.com/wp-json/wp/v2/pages?per_page=1": { headers: {} },
      "https://wp.example.com/wp-json/wp/v2/media?per_page=1": { headers: {} },
    };
    globalThis.fetch = vi.fn(async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as { toString: () => string }).toString();
      return makeMockResponse(routes[url] ?? {});
    }) as unknown as typeof fetch;

    const result = await runWpSiteHealth({}, WP_CONFIG, makeRunCtx());
    const data = result.data as { totalPosts: number; totalPages: number; totalMedia: number };
    expect(data.totalPosts).toBe(0);
    expect(data.totalPages).toBe(0);
    expect(data.totalMedia).toBe(0);
  });

  it("trailing slash on siteUrl is normalised", async () => {
    const fetchMock = vi.fn(async () => makeMockResponse({ json: async () => ({}), headers: {} })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    await runWpSiteHealth({}, { ...WP_CONFIG, siteUrl: "https://wp.example.com///" }, makeRunCtx());
    const firstCallUrl = (fetchMock as unknown as { mock: { calls: Array<[string, unknown]> } }).mock.calls[0][0];
    expect(firstCallUrl).toBe("https://wp.example.com/wp-json");
  });

  it("filters out wp_/nav_/attachment post types", async () => {
    const routes: Record<string, MockResponse> = {
      "https://wp.example.com/wp-json": { json: async () => ({}) },
      "https://wp.example.com/wp-json/wp/v2/types": {
        json: async () => ({
          post: {},
          page: {},
          attachment: {},
          wp_block: {},
          wp_navigation: {},
          nav_menu_item: {},
          custom: {},
        }),
      },
      "https://wp.example.com/wp-json/wp/v2/posts?per_page=1": { headers: {} },
      "https://wp.example.com/wp-json/wp/v2/pages?per_page=1": { headers: {} },
      "https://wp.example.com/wp-json/wp/v2/media?per_page=1": { headers: {} },
    };
    globalThis.fetch = vi.fn(async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as { toString: () => string }).toString();
      return makeMockResponse(routes[url] ?? {});
    }) as unknown as typeof fetch;

    const result = await runWpSiteHealth({}, WP_CONFIG, makeRunCtx());
    const data = result.data as { postTypes: string[] };
    expect(data.postTypes.sort()).toEqual(["custom", "page", "post"]);
  });
});
