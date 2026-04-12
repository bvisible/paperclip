/**
 * seoContentAudit — on-page SEO audit for a given URL.
 *
 * Ported from the legacy Postiz `seo.content-audit.tool.ts`. Pure HTML
 * fetch + regex parsing, no secrets required.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";

export interface SeoContentAuditParams {
  url: string;
}

export async function runSeoContentAudit(
  params: SeoContentAuditParams,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  if (!params.url) return { error: "`url` is required" };

  let res: Response;
  try {
    res = await fetch(params.url, {
      headers: { "User-Agent": "NeoCompanyBot/1.0 (SEO audit)" },
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    return { error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) {
    return { error: `Failed to fetch ${params.url}: HTTP ${res.status}` };
  }

  const html = await res.text();
  const issues: string[] = [];
  const recommendations: string[] = [];

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "";
  const titleLength = title.length;
  if (!title) {
    issues.push("Missing <title> tag");
    recommendations.push("Add a descriptive title (50-60 chars)");
  } else if (titleLength < 30) {
    issues.push(`Title too short (${titleLength} chars)`);
    recommendations.push("Expand title to 50-60 characters");
  } else if (titleLength > 65) {
    issues.push(`Title too long (${titleLength} chars)`);
    recommendations.push("Shorten title to under 60 characters");
  }

  const descMatch =
    html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']/i) ??
    html.match(/<meta\s+content=["']([\s\S]*?)["']\s+name=["']description["']/i);
  const description = descMatch ? descMatch[1].trim() : "";
  const descriptionLength = description.length;
  if (!description) {
    issues.push("Missing meta description");
    recommendations.push("Add a compelling meta description (120-160 chars)");
  } else if (descriptionLength < 70) {
    issues.push(`Meta description too short (${descriptionLength} chars)`);
  } else if (descriptionLength > 165) {
    issues.push(`Meta description too long (${descriptionLength} chars)`);
  }

  const h1Matches = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) ?? [];
  const h1Count = h1Matches.length;
  const h1 = h1Matches[0]?.replace(/<[^>]*>/g, "").trim() ?? "";
  if (h1Count === 0) {
    issues.push("Missing H1 tag");
    recommendations.push("Add a single H1 heading");
  } else if (h1Count > 1) {
    issues.push(`Multiple H1 tags (${h1Count})`);
    recommendations.push("Use only one H1 per page");
  }

  const headings: string[] = [];
  for (const m of html.matchAll(/<(h[1-6])[^>]*>/gi)) headings.push(m[1].toUpperCase());
  const headingsStructure = headings.slice(0, 20).join(" → ") || "None";

  const textContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const wordCount = textContent.split(" ").filter((w) => w.length > 1).length;
  if (wordCount < 300) {
    issues.push(`Low content (${wordCount} words)`);
    recommendations.push("Aim for 800+ words for SEO");
  }

  const imgMatches = html.match(/<img[^>]*>/gi) ?? [];
  const imagesTotal = imgMatches.length;
  const imagesMissingAlt = imgMatches.filter((img) => !/alt=["'][^"']+["']/i.test(img)).length;
  if (imagesMissingAlt > 0) {
    issues.push(`${imagesMissingAlt} images missing alt text`);
    recommendations.push("Add descriptive alt text to all images");
  }

  let internalLinks = 0;
  let externalLinks = 0;
  let domain = "";
  try {
    domain = new URL(params.url).hostname;
  } catch {
    return { error: `Invalid URL: ${params.url}` };
  }
  const linkMatches = html.match(/<a\s+[^>]*href=["']([^"']*?)["'][^>]*>/gi) ?? [];
  for (const link of linkMatches) {
    const hrefMatch = link.match(/href=["']([^"']*?)["']/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1];
    if (href.startsWith("http") && !href.includes(domain)) externalLinks++;
    else if (href.startsWith("/") || href.includes(domain)) internalLinks++;
  }

  const hasCanonical = /<link[^>]*rel=["']canonical["'][^>]*>/i.test(html);
  if (!hasCanonical) {
    issues.push("Missing canonical URL");
    recommendations.push('Add <link rel="canonical"> to prevent duplicate content');
  }

  const hasViewport = /<meta[^>]*name=["']viewport["'][^>]*>/i.test(html);
  if (!hasViewport) {
    issues.push("Missing viewport meta tag");
    recommendations.push("Add viewport meta for mobile responsiveness");
  }

  const schemaMatches = html.match(/"@type"\s*:\s*"([^"]+)"/g) ?? [];
  const schemaTypes = schemaMatches
    .map((m) => m.match(/"([^"]+)"$/)?.[1] ?? "")
    .filter(Boolean);
  if (schemaTypes.length === 0) {
    recommendations.push("Add Schema.org structured data (Organization, FAQPage, etc.)");
  }

  const summary =
    `On-page SEO audit for ${params.url}:\n` +
    `- Title (${titleLength}): ${title || "(missing)"}\n` +
    `- Meta description (${descriptionLength}): ${description || "(missing)"}\n` +
    `- H1 (${h1Count}): ${h1 || "(missing)"}\n` +
    `- Headings: ${headingsStructure}\n` +
    `- Word count: ${wordCount}\n` +
    `- Images: ${imagesTotal} total, ${imagesMissingAlt} missing alt\n` +
    `- Links: ${internalLinks} internal / ${externalLinks} external\n` +
    `- Canonical: ${hasCanonical ? "yes" : "no"} · Viewport: ${hasViewport ? "yes" : "no"}\n` +
    `- Schema.org types: ${schemaTypes.length > 0 ? schemaTypes.join(", ") : "(none)"}\n` +
    (issues.length > 0 ? `- Issues:\n  * ${issues.join("\n  * ")}\n` : "") +
    (recommendations.length > 0 ? `- Recommendations:\n  * ${recommendations.join("\n  * ")}` : "- No recommendations");

  return {
    content: summary,
    data: {
      url: params.url,
      title,
      titleLength,
      description,
      descriptionLength,
      h1,
      h1Count,
      headingsStructure,
      wordCount,
      imagesTotal,
      imagesMissingAlt,
      internalLinks,
      externalLinks,
      hasCanonical,
      hasViewport,
      schemaTypes,
      issues,
      recommendations,
    },
  };
}

export const seoContentAuditDeclaration = {
  displayName: "On-page SEO audit",
  description:
    "Audit a URL for on-page SEO: title + meta description lengths, heading structure, content length, image alt tags, internal/external link counts, canonical + viewport meta, and Schema.org markup. Returns a flat list of issues and actionable recommendations.",
  parametersSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The page to audit, e.g. https://neoservice.ai/about" },
    },
    required: ["url"],
  } as const,
};
