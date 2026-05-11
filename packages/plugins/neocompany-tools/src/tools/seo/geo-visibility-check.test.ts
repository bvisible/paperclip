//// Neocompany Modification — tests for geoVisibilityCheck (GEO scoring)
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGeoVisibilityCheck } from "./geo-visibility-check.js";
import { makeRunCtx } from "../../__tests__/test-helpers.js";

const originalFetch = globalThis.fetch;

function mockRoutes(routes: Record<string, { html?: string; ok?: boolean; status?: number }>) {
  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as { toString: () => string }).toString();
    const r = routes[url];
    if (!r) throw new Error(`unmocked URL: ${url}`);
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      text: async () => r.html ?? "",
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("runGeoVisibilityCheck", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requires a url", async () => {
    const result = await runGeoVisibilityCheck({ url: "" }, makeRunCtx());
    expect(result.error).toMatch(/required/);
  });

  it("returns error on HTTP failure", async () => {
    mockRoutes({ "https://example.com": { ok: false, status: 500 } });
    const result = await runGeoVisibilityCheck({ url: "https://example.com" }, makeRunCtx());
    expect(result.error).toMatch(/500/);
  });

  it("scores poorly when content is missing GEO signals", async () => {
    mockRoutes({
      "https://example.com": { html: "<html><body><p>Hi</p></body></html>" },
      "https://example.com/robots.txt": { ok: false, status: 404 },
    });
    const result = await runGeoVisibilityCheck({ url: "https://example.com" }, makeRunCtx());
    expect(result.error).toBeUndefined();
    const data = result.data as { geoScore: number; recommendations: string[]; aiBotsAllowed: boolean };
    // robots.txt 404 is permissive → aiBotsAllowed=true (+15) — that's the only score contribution.
    expect(data.geoScore).toBe(15);
    expect(data.aiBotsAllowed).toBe(true);
    expect(data.recommendations.length).toBeGreaterThan(2);
  });

  it("CRITICAL flag when AI bots are blocked in robots.txt", async () => {
    const robots = "User-agent: GPTBot\nDisallow: /\n";
    mockRoutes({
      "https://example.com": { html: "<html><body></body></html>" },
      "https://example.com/robots.txt": { html: robots },
    });
    const result = await runGeoVisibilityCheck({ url: "https://example.com" }, makeRunCtx());
    const data = result.data as { aiBotsAllowed: boolean; recommendations: string[] };
    expect(data.aiBotsAllowed).toBe(false);
    expect(data.recommendations.some((r) => r.includes("CRITICAL"))).toBe(true);
  });

  it("rewards FAQ + HowTo schema, citations and statistics", async () => {
    const html = `<html><body>
      <script type="application/ld+json">{"@type":"FAQPage"}</script>
      <script type="application/ld+json">{"@type":"HowTo"}</script>
      <p>According to research, conversion went up 42% in 2026 — data from McKinsey.</p>
      <p>Study found that 78% of customers prefer AI support.</p>
      <p>The source: $1,200 average annual saving.</p>
      <p>This page has ${"word ".repeat(20)} as content.</p>
      <p>Short paragraph one is here.</p>
      <p>Short paragraph two follows.</p>
      <p>Short paragraph three closes it.</p>
      <p>Fourth concise paragraph.</p>
      <p>Fifth concise paragraph.</p>
    </body></html>`;
    mockRoutes({
      "https://example.com": { html },
      "https://example.com/robots.txt": { ok: false, status: 404 },
    });

    const result = await runGeoVisibilityCheck({ url: "https://example.com" }, makeRunCtx());
    const data = result.data as {
      geoScore: number;
      hasFAQSchema: boolean;
      hasHowToSchema: boolean;
      citations: number;
      statistics: number;
      shortParagraphs: number;
    };
    expect(data.hasFAQSchema).toBe(true);
    expect(data.hasHowToSchema).toBe(true);
    expect(data.citations).toBeGreaterThanOrEqual(3);
    expect(data.statistics).toBeGreaterThanOrEqual(3);
    expect(data.shortParagraphs).toBeGreaterThanOrEqual(5);
    expect(data.geoScore).toBeGreaterThanOrEqual(70);
  });

  it("verdict text reflects the score bracket", async () => {
    mockRoutes({
      "https://example.com": { html: "<html></html>" },
      "https://example.com/robots.txt": { ok: false, status: 404 },
    });
    const lowResult = await runGeoVisibilityCheck({ url: "https://example.com" }, makeRunCtx());
    expect((lowResult.data as { verdict: string }).verdict).toMatch(/Low/);
  });

  it("score is capped at 100", async () => {
    // Build a page that ticks every bucket multiple times.
    const html = `<html><body>
      <script type="application/ld+json">{"@type":"FAQPage"}</script>
      <script type="application/ld+json">{"@type":"HowTo"}</script>
      <script type="application/ld+json">{"@type":"Article"}</script>
      ${"<p>according to research the data from study found cited by source:</p>".repeat(10)}
      ${"<p>42% of $1,200 with 78% and 200 million paying 5 billion.</p>".repeat(10)}
      ${"<p>Short paragraph here. Quite small. Concise too.</p>".repeat(20)}
    </body></html>`;
    mockRoutes({
      "https://example.com": { html },
      "https://example.com/robots.txt": { ok: false, status: 404 },
    });
    const result = await runGeoVisibilityCheck({ url: "https://example.com" }, makeRunCtx());
    expect((result.data as { geoScore: number }).geoScore).toBeLessThanOrEqual(100);
  });
});
