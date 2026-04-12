/**
 * seoPageSpeed — Google PageSpeed Insights audit for any URL.
 *
 * Ported from the legacy Postiz `seo.pagespeed.tool.ts`. No OAuth required.
 * The Google PSI API has a public free tier; supplying an API key via the
 * optional `apiKey` config lifts the rate limit but is not mandatory.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";

export interface SeoPageSpeedParams {
  url: string;
  strategy?: "mobile" | "desktop";
}

export interface PageSpeedConfig {
  /** Optional Google PSI API key (raises the rate limit). */
  apiKey?: string;
}

export async function runSeoPageSpeed(
  params: SeoPageSpeedParams,
  config: PageSpeedConfig,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  if (!params.url) return { error: "`url` is required" };
  const strategy = params.strategy ?? "mobile";
  const keyParam = config.apiKey ? `&key=${encodeURIComponent(config.apiKey)}` : "";

  const url =
    `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?` +
    `url=${encodeURIComponent(params.url)}&strategy=${strategy}` +
    "&category=performance&category=seo&category=accessibility&category=best-practices" +
    keyParam;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(180000) });
  } catch (err) {
    return { error: `PageSpeed request failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!res.ok) {
    return { error: `PageSpeed API error ${res.status}` };
  }

  const data = (await res.json()) as {
    lighthouseResult?: {
      categories?: Record<string, { score?: number | null }>;
      audits?: Record<string, { title?: string; score?: number | null; displayValue?: string; details?: { overallSavingsMs?: number } }>;
    };
  };
  const categories = data.lighthouseResult?.categories ?? {};
  const audits = data.lighthouseResult?.audits ?? {};

  const perf = Math.round((categories.performance?.score ?? 0) * 100);
  const seo = Math.round((categories.seo?.score ?? 0) * 100);
  const a11y = Math.round((categories.accessibility?.score ?? 0) * 100);
  const bp = Math.round((categories["best-practices"]?.score ?? 0) * 100);
  const lcp = audits["largest-contentful-paint"]?.displayValue ?? "N/A";
  const cls = audits["cumulative-layout-shift"]?.displayValue ?? "N/A";
  const inp = audits["interaction-to-next-paint"]?.displayValue ?? audits["max-potential-fid"]?.displayValue ?? "N/A";

  const opportunityKeys = [
    "render-blocking-resources",
    "unused-css-rules",
    "unused-javascript",
    "offscreen-images",
    "unminified-css",
    "unminified-javascript",
    "modern-image-formats",
    "uses-optimized-images",
    "uses-text-compression",
    "server-response-time",
  ];
  const recommendations: string[] = [];
  for (const k of opportunityKeys) {
    const a = audits[k];
    if (!a || a.score === null || a.score === undefined || !a.title || a.score >= 1) continue;
    const savings = a.details?.overallSavingsMs
      ? ` (save ${Math.round(a.details.overallSavingsMs)}ms)`
      : "";
    recommendations.push(`${a.title}${savings}`);
  }

  const summary =
    `PageSpeed Insights for ${params.url} (${strategy}):\n` +
    `- Performance: ${perf}/100\n` +
    `- SEO: ${seo}/100\n` +
    `- Accessibility: ${a11y}/100\n` +
    `- Best Practices: ${bp}/100\n` +
    `- Core Web Vitals: LCP=${lcp}, CLS=${cls}, INP=${inp}\n` +
    (recommendations.length > 0
      ? `- Top recommendations:\n  * ${recommendations.slice(0, 5).join("\n  * ")}`
      : "- No major improvement opportunities");

  return {
    content: summary,
    data: {
      url: params.url,
      strategy,
      scores: { performance: perf, seo, accessibility: a11y, bestPractices: bp },
      coreWebVitals: { lcp, cls, inp },
      recommendations: recommendations.slice(0, 5),
    },
  };
}

export const seoPageSpeedDeclaration = {
  displayName: "Google PageSpeed Insights audit",
  description:
    "Run a Google PageSpeed Insights audit on any public URL. Returns Lighthouse scores (performance, SEO, accessibility, best practices), Core Web Vitals (LCP, CLS, INP), and the top 5 improvement opportunities. No Google connection required for small volumes.",
  parametersSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to audit, e.g. https://neoservice.ai" },
      strategy: {
        type: "string",
        enum: ["mobile", "desktop"],
        description: "Run the audit in mobile or desktop mode (default mobile).",
        default: "mobile",
      },
    },
    required: ["url"],
  } as const,
};
