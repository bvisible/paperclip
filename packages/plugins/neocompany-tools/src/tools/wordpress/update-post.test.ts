//// Neocompany Modification — tests for wpUpdatePost (partial patch semantics)
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWpUpdatePost } from "./update-post.js";
import { makeRunCtx } from "../../__tests__/test-helpers.js";

const WP_CONFIG = {
  siteUrl: "https://wp.example.com",
  username: "neo",
  appPassword: "pwd",
};

const originalFetch = globalThis.fetch;

describe("runWpUpdatePost", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requires a postId", async () => {
    const result = await runWpUpdatePost({ postId: 0 }, WP_CONFIG, makeRunCtx());
    expect(result.error).toMatch(/postId/);
  });

  it("rejects when no field to update is supplied", async () => {
    const result = await runWpUpdatePost({ postId: 5 }, WP_CONFIG, makeRunCtx());
    expect(result.error).toMatch(/at least one field/);
  });

  it("POSTs to /posts/:id with only the provided fields", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 5, status: "publish", link: "https://wp.example.com/?p=5" }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await runWpUpdatePost(
      { postId: 5, title: "Updated", status: "publish" },
      WP_CONFIG,
      makeRunCtx(),
    );

    const [calledUrl, init] = (fetchMock as unknown as {
      mock: { calls: Array<[string, { body: string; method: string }]> };
    }).mock.calls[0];
    expect(calledUrl).toContain("/wp-json/wp/v2/posts/5");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body).toEqual({ title: "Updated", status: "publish" });
  });

  it("translates featuredMediaId to featured_media (WP field name)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 5 }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await runWpUpdatePost(
      { postId: 5, featuredMediaId: 88 },
      WP_CONFIG,
      makeRunCtx(),
    );
    const body = JSON.parse(
      (fetchMock as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[0][1].body,
    );
    expect(body).toEqual({ featured_media: 88 });
  });

  it("empty categories/tags arrays are NOT sent (would clear taxonomies)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 5 }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    // The implementation only includes categories/tags when length > 0,
    // so an empty array effectively means "don't touch". Combined with another
    // field so we don't hit the 'no fields' branch.
    await runWpUpdatePost(
      { postId: 5, title: "t", categories: [], tags: [] },
      WP_CONFIG,
      makeRunCtx(),
    );
    const body = JSON.parse(
      (fetchMock as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[0][1].body,
    );
    expect(body.categories).toBeUndefined();
    expect(body.tags).toBeUndefined();
  });

  it("surfaces WordPress API errors", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ message: "Post not found" }),
    })) as unknown as typeof fetch;

    const result = await runWpUpdatePost(
      { postId: 999, title: "T" },
      WP_CONFIG,
      makeRunCtx(),
    );
    expect(result.error).toMatch(/404/);
    expect(result.error).toMatch(/Post not found/);
  });

  it("network error returns graceful message", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const result = await runWpUpdatePost(
      { postId: 5, title: "T" },
      WP_CONFIG,
      makeRunCtx(),
    );
    expect(result.error).toMatch(/ECONNRESET/);
  });
});
