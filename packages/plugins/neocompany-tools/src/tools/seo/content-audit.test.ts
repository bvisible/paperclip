//// Neocompany Modification — tests for seoContentAudit (HTML parser)
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSeoContentAudit } from "./content-audit.js";
import { makeRunCtx } from "../../__tests__/test-helpers.js";

const originalFetch = globalThis.fetch;

function mockHtml(html: string, init: { ok?: boolean; status?: number } = {}) {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 500);
  globalThis.fetch = vi.fn(async () => ({
    ok,
    status,
    text: async () => html,
  })) as unknown as typeof fetch;
}

const HEALTHY_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NeoService — AI agent orchestration platform</title>
  <meta name="description" content="NeoService gives small businesses an autonomous AI workforce that handles marketing, support and operations end-to-end without supervision.">
  <link rel="canonical" href="https://neoservice.ai/">
  <script type="application/ld+json">{"@type":"Organization","name":"NeoService"}</script>
</head>
<body>
  <h1>Welcome to NeoService</h1>
  <h2>What we do</h2>
  <p>${"word ".repeat(450)}</p>
  <img src="/a.png" alt="A descriptive alt">
  <img src="/b.png" alt="Another alt">
  <a href="/about">About</a>
  <a href="https://external.com">Ext</a>
</body>
</html>`;

describe("runSeoContentAudit", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requires a url", async () => {
    const result = await runSeoContentAudit({ url: "" }, makeRunCtx());
    expect(result.error).toMatch(/required/);
  });

  it("returns clear error on HTTP failure", async () => {
    mockHtml("", { ok: false, status: 503 });
    const result = await runSeoContentAudit({ url: "https://neoservice.ai" }, makeRunCtx());
    expect(result.error).toMatch(/503/);
  });

  it("flags missing title / meta description / H1", async () => {
    mockHtml("<html><body><p>Tiny</p></body></html>");
    const result = await runSeoContentAudit({ url: "https://example.com" }, makeRunCtx());
    const data = result.data as { issues: string[]; recommendations: string[] };
    expect(data.issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/title/i),
        expect.stringMatching(/description/i),
        expect.stringMatching(/H1/i),
      ]),
    );
    expect(data.recommendations.length).toBeGreaterThan(0);
  });

  it("parses a healthy page with zero major issues", async () => {
    mockHtml(HEALTHY_HTML);
    const result = await runSeoContentAudit({ url: "https://neoservice.ai" }, makeRunCtx());
    expect(result.error).toBeUndefined();
    const data = result.data as {
      title: string;
      descriptionLength: number;
      h1Count: number;
      hasCanonical: boolean;
      hasViewport: boolean;
      schemaTypes: string[];
      imagesMissingAlt: number;
      issues: string[];
    };
    expect(data.title).toBe("NeoService — AI agent orchestration platform");
    expect(data.h1Count).toBe(1);
    expect(data.hasCanonical).toBe(true);
    expect(data.hasViewport).toBe(true);
    expect(data.schemaTypes).toContain("Organization");
    expect(data.imagesMissingAlt).toBe(0);
    expect(data.issues.length).toBe(0);
  });

  it("flags multiple H1s", async () => {
    mockHtml(`<html><head><title>${"x".repeat(50)}</title></head><body><h1>A</h1><h1>B</h1></body></html>`);
    const result = await runSeoContentAudit({ url: "https://example.com" }, makeRunCtx());
    const data = result.data as { h1Count: number; issues: string[] };
    expect(data.h1Count).toBe(2);
    expect(data.issues.some((i) => i.match(/Multiple H1/i))).toBe(true);
  });

  it("flags images without alt text", async () => {
    mockHtml(`<html><body><img src="/x.png"><img src="/y.png" alt="y"></body></html>`);
    const result = await runSeoContentAudit({ url: "https://example.com" }, makeRunCtx());
    const data = result.data as { imagesTotal: number; imagesMissingAlt: number; issues: string[] };
    expect(data.imagesTotal).toBe(2);
    expect(data.imagesMissingAlt).toBe(1);
    expect(data.issues.some((i) => i.includes("missing alt"))).toBe(true);
  });

  it("counts internal vs external links by host", async () => {
    mockHtml(`<html><body>
      <a href="/internal">i1</a>
      <a href="https://example.com/path">i2</a>
      <a href="https://other.com">e1</a>
      <a href="https://yet-another.com">e2</a>
    </body></html>`);
    const result = await runSeoContentAudit({ url: "https://example.com" }, makeRunCtx());
    const data = result.data as { internalLinks: number; externalLinks: number };
    expect(data.internalLinks).toBe(2);
    expect(data.externalLinks).toBe(2);
  });

  it("rejects invalid URL with clear error", async () => {
    mockHtml("<html></html>");
    const result = await runSeoContentAudit({ url: "not-a-url" }, makeRunCtx());
    expect(result.error).toMatch(/Invalid URL/);
  });

  it("flags low word count (<300)", async () => {
    mockHtml(`<html><head><title>${"x".repeat(50)}</title></head><body><h1>H</h1><p>Just a few words here.</p></body></html>`);
    const result = await runSeoContentAudit({ url: "https://example.com" }, makeRunCtx());
    const data = result.data as { wordCount: number; issues: string[] };
    expect(data.wordCount).toBeLessThan(300);
    expect(data.issues.some((i) => i.includes("Low content"))).toBe(true);
  });
});
