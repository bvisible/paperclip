/**
 * geoVisibilityCheck — heuristic Generative Engine Optimization audit.
 *
 * Ported from the legacy Postiz `geo.visibility-check.tool.ts`. Pure HTML
 * + robots.txt fetch, no external APIs. Scores a page on its readiness
 * for AI search engines (ChatGPT, Perplexity, Google AI Overviews) based
 * on direct answers, short paragraphs, Schema.org markup, citations,
 * statistics, and AI bot accessibility.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";

export interface GeoVisibilityCheckParams {
  url: string;
}

function stripContentForText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, "\n")
    .replace(/\s+/g, " ");
}

export async function runGeoVisibilityCheck(
  params: GeoVisibilityCheckParams,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  if (!params.url) return { error: "`url` is required" };

  let res: Response;
  try {
    res = await fetch(params.url, {
      headers: { "User-Agent": "NeoCompanyBot/1.0 (GEO check)" },
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    return { error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) return { error: `Failed to fetch ${params.url}: HTTP ${res.status}` };

  const html = await res.text();
  const recommendations: string[] = [];
  let geoScore = 0;

  const textContent = stripContentForText(html);

  // 1. Direct answers — short sentences (5-40 words)
  const sentences = textContent.split(/[.!?]/).filter((s) => s.trim().length > 20);
  const shortAnswers = sentences.filter((s) => {
    const wordCount = s.trim().split(/\s+/).length;
    return wordCount >= 5 && wordCount <= 40;
  });
  const directAnswers = Math.min(shortAnswers.length, 50);
  if (directAnswers >= 10) geoScore += 20;
  else if (directAnswers >= 5) geoScore += 10;
  else recommendations.push("Add more concise answer paragraphs (≤40 words) — AI engines extract these 2.7× more often");

  // 2. Short paragraphs (≤3 sentences)
  const paragraphMatches = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) ?? [];
  const shortParagraphs = paragraphMatches.filter((p) => {
    const text = p.replace(/<[^>]*>/g, "").trim();
    return text.split(/[.!?]/).length <= 3 && text.length > 20;
  }).length;
  if (shortParagraphs >= 5) geoScore += 10;

  // 3. Schema.org structured data
  const schemaMatches = html.match(/"@type"\s*:\s*"([^"]+)"/g) ?? [];
  const schemaTypes = Array.from(
    new Set(schemaMatches.map((m) => m.match(/"([^"]+)"$/)?.[1] ?? "").filter(Boolean)),
  );
  const hasFAQSchema = schemaTypes.includes("FAQPage");
  const hasHowToSchema = schemaTypes.includes("HowTo");
  if (hasFAQSchema) geoScore += 15;
  else recommendations.push("Add FAQPage Schema.org — pages with FAQ schema are extracted 3.1× more by AI");
  if (hasHowToSchema) geoScore += 10;
  if (schemaTypes.length > 0) geoScore += 5;
  else recommendations.push("Add structured data (Organization, Article, FAQPage)");

  // 4. Citations and statistics
  const citationPatterns = /according to|research shows|study found|data from|source:|cited by/gi;
  const citations = (textContent.match(citationPatterns) ?? []).length;
  if (citations >= 3) geoScore += 15;
  else recommendations.push("Add citations and references to authoritative sources (+31% AI visibility)");

  const statsPatterns = /\d+%|\d+\.\d+%|\$[\d,]+|€[\d,]+|\d+ million|\d+ billion/gi;
  const statistics = (textContent.match(statsPatterns) ?? []).length;
  if (statistics >= 3) geoScore += 10;
  else recommendations.push("Include statistics and data points — AI engines prefer factual content");

  // 5. AI bot access via robots.txt
  let aiBotsAllowed = true;
  try {
    const origin = new URL(params.url).origin;
    const robotsRes = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(5000) });
    if (robotsRes.ok) {
      const robots = (await robotsRes.text()).toLowerCase();
      if (robots.includes("user-agent: gptbot") && robots.includes("disallow: /")) aiBotsAllowed = false;
      if (robots.includes("user-agent: claudebot") && robots.includes("disallow: /")) aiBotsAllowed = false;
    }
  } catch {
    // Treat unreachable robots.txt as permissive — many sites don't have one
  }
  if (aiBotsAllowed) geoScore += 15;
  else recommendations.push("CRITICAL: AI bots are blocked in robots.txt — your content is invisible to ChatGPT/Claude");

  geoScore = Math.min(geoScore, 100);

  let verdict: string;
  if (geoScore >= 70) {
    verdict = "Good GEO score! Focus on maintaining freshness (content <3 months gets 3× more AI citations)";
  } else if (geoScore >= 40) {
    verdict = "Moderate GEO score. Focus on adding FAQ schema and citations for quick improvement";
  } else {
    verdict = "Low GEO score. Major improvements needed for AI search visibility";
  }

  const summary =
    `GEO visibility for ${params.url}: ${geoScore}/100 — ${verdict}\n` +
    `- Direct answers (5-40 words): ${directAnswers}\n` +
    `- Short paragraphs: ${shortParagraphs}\n` +
    `- Schema.org types: ${schemaTypes.length > 0 ? schemaTypes.join(", ") : "(none)"}\n` +
    `- FAQPage schema: ${hasFAQSchema ? "yes" : "no"} · HowTo schema: ${hasHowToSchema ? "yes" : "no"}\n` +
    `- Citations detected: ${citations}\n` +
    `- Statistics detected: ${statistics}\n` +
    `- AI bots allowed: ${aiBotsAllowed ? "yes" : "BLOCKED"}\n` +
    (recommendations.length > 0 ? `- Recommendations:\n  * ${recommendations.join("\n  * ")}` : "- No critical recommendations");

  return {
    content: summary,
    data: {
      url: params.url,
      geoScore,
      verdict,
      directAnswers,
      shortParagraphs,
      schemaTypes,
      hasFAQSchema,
      hasHowToSchema,
      citations,
      statistics,
      aiBotsAllowed,
      recommendations,
    },
  };
}

export const geoVisibilityCheckDeclaration = {
  displayName: "GEO visibility check",
  description:
    "Audit a page for Generative Engine Optimization (GEO) — its readiness to appear in AI search results from ChatGPT, Perplexity and Google AI Overviews. Scores 0-100 based on direct answers (5-40 word sentences), short paragraphs, Schema.org markup (especially FAQPage + HowTo), inline citations, statistics, and whether AI crawlers are allowed in robots.txt. Returns a verdict, the breakdown, and actionable recommendations.",
  parametersSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The page to audit, e.g. https://neoservice.ai/about" },
    },
    required: ["url"],
  } as const,
};
