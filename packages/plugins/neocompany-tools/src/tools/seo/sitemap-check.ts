/**
 * seoSitemapCheck — fetch a site's sitemap.xml and summarise its content.
 *
 * Ported from the legacy Postiz `seo.sitemap-check.tool.ts`. Zero-config HTTP
 * GET. Handles both regular sitemaps and sitemap indexes.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";

export interface SeoSitemapCheckParams {
  url: string;
}

export async function runSeoSitemapCheck(
  params: SeoSitemapCheckParams,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  if (!params.url) return { error: "`url` is required" };

  let sitemapUrl = params.url;
  if (!sitemapUrl.toLowerCase().includes("sitemap")) {
    try {
      sitemapUrl = `${new URL(params.url).origin}/sitemap.xml`;
    } catch {
      return { error: `Invalid URL: ${params.url}` };
    }
  }

  let res: Response;
  try {
    res = await fetch(sitemapUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "NeoCompanyBot/1.0" },
    });
  } catch (err) {
    return {
      error: `Failed to fetch sitemap: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    return {
      content: `Sitemap not found at ${sitemapUrl} (HTTP ${res.status}).`,
      data: { exists: false, sitemapUrl, status: res.status },
    };
  }

  const content = await res.text();
  const isSitemapIndex = content.includes("<sitemapindex");
  const locMatches = content.match(/<loc>(.*?)<\/loc>/gi) ?? [];
  const urlCount = locMatches.length;
  const sampleUrls = locMatches.slice(0, 5).map((m) => m.replace(/<\/?loc>/gi, ""));
  const lastmodMatches = content.match(/<lastmod>(.*?)<\/lastmod>/gi) ?? [];
  const dates = lastmodMatches.map((m) => m.replace(/<\/?lastmod>/gi, "")).sort().reverse();
  const lastModified = dates[0] ?? "Not specified";

  const issues: string[] = [];
  if (urlCount === 0) issues.push("Sitemap is empty (0 URLs)");
  else if (urlCount < 5 && !isSitemapIndex) issues.push(`Very few URLs in sitemap (${urlCount})`);

  const summary =
    `Sitemap for ${sitemapUrl}:\n` +
    `- Type: ${isSitemapIndex ? "sitemap index" : "sitemap"}\n` +
    `- URL count: ${urlCount}\n` +
    `- Last modified: ${lastModified}\n` +
    (sampleUrls.length > 0 ? `- Sample URLs:\n  * ${sampleUrls.join("\n  * ")}\n` : "") +
    (issues.length > 0 ? `- Issues:\n  * ${issues.join("\n  * ")}` : "- No issues detected");

  return {
    content: summary,
    data: { exists: true, sitemapUrl, urlCount, lastModified, sampleUrls, isSitemapIndex, issues },
  };
}

export const seoSitemapCheckDeclaration = {
  displayName: "Check sitemap.xml",
  description:
    "Fetch and summarise the sitemap.xml of a website. Supports sitemap indexes. Returns URL count, sample URLs, last modification date, and flags empty or tiny sitemaps.",
  parametersSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "A URL on the site, or a direct sitemap URL. If no '/sitemap' segment is present, defaults to <origin>/sitemap.xml.",
      },
    },
    required: ["url"],
  } as const,
};
