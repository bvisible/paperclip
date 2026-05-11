//// Neocompany Modification — tests for wpCreatePost (REST POST + validation)
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWpCreatePost } from "./create-post.js";
import { makeRunCtx } from "../../__tests__/test-helpers.js";

const WP_CONFIG = {
  siteUrl: "https://wp.example.com",
  username: "neo",
  appPassword: "pwd",
};

const originalFetch = globalThis.fetch;

describe("runWpCreatePost", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requires title and content", async () => {
    let result = await runWpCreatePost(
      { title: "", content: "body" },
      WP_CONFIG,
      makeRunCtx(),
    );
    expect(result.error).toMatch(/title/);

    result = await runWpCreatePost(
      { title: "Hello", content: "" },
      WP_CONFIG,
      makeRunCtx(),
    );
    expect(result.error).toMatch(/content/);
  });

  it("defaults to draft status and creates the post", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      text: async () =>
        JSON.stringify({
          id: 42,
          status: "draft",
          link: "https://wp.example.com/?p=42",
          title: { rendered: "Hello" },
        }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const result = await runWpCreatePost(
      { title: "Hello", content: "<p>Body</p>" },
      WP_CONFIG,
      makeRunCtx(),
    );

    expect(result.error).toBeUndefined();
    const data = result.data as { id: number; status: string; link: string };
    expect(data.id).toBe(42);
    expect(data.status).toBe("draft");
    expect(data.link).toBe("https://wp.example.com/?p=42");

    // Verify the body the adapter sent.
    const init = (fetchMock as unknown as { mock: { calls: Array<[string, { body: string; method: string }]> } }).mock.calls[0][1];
    expect(init.method).toBe("POST");
    const sentBody = JSON.parse(init.body);
    expect(sentBody).toEqual({
      title: "Hello",
      content: "<p>Body</p>",
      status: "draft",
    });
  });

  it("propagates optional categories/tags/featuredMediaId/excerpt", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ id: 7 }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await runWpCreatePost(
      {
        title: "T",
        content: "C",
        status: "publish",
        categories: [10, 20],
        tags: [33],
        featuredMediaId: 99,
        excerpt: "exc",
      },
      WP_CONFIG,
      makeRunCtx(),
    );

    const init = (fetchMock as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[0][1];
    const sent = JSON.parse(init.body);
    expect(sent).toEqual({
      title: "T",
      content: "C",
      status: "publish",
      categories: [10, 20],
      tags: [33],
      featured_media: 99,
      excerpt: "exc",
    });
  });

  it("omits empty optional fields from the body", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ id: 1 }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await runWpCreatePost(
      { title: "T", content: "C", categories: [], tags: [] },
      WP_CONFIG,
      makeRunCtx(),
    );
    const sent = JSON.parse(
      (fetchMock as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[0][1].body,
    );
    expect(sent.categories).toBeUndefined();
    expect(sent.tags).toBeUndefined();
  });

  it("WordPress error response is surfaced cleanly", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ code: "rest_forbidden", message: "Insufficient capabilities" }),
    })) as unknown as typeof fetch;

    const result = await runWpCreatePost(
      { title: "T", content: "C" },
      WP_CONFIG,
      makeRunCtx(),
    );
    expect(result.error).toMatch(/403/);
    expect(result.error).toMatch(/Insufficient/);
  });

  it("network failure returns an error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("DNS lookup failed");
    }) as unknown as typeof fetch;
    const result = await runWpCreatePost(
      { title: "T", content: "C" },
      WP_CONFIG,
      makeRunCtx(),
    );
    expect(result.error).toMatch(/DNS lookup failed/);
  });
});
