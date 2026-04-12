/**
 * seoQuickWins — find keywords ranked 4-20 with high impressions but low CTR.
 *
 * These are the "quick wins" of SEO: content already on page 2 that could
 * be optimised to reach page 1 with minimal additional effort.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import {
  gscSearchAnalyticsQuery,
  defaultDateRange,
  GscApiError,
  type GscConfig,
} from "../../adapters/gsc.js";

export interface SeoQuickWinsParams {
  siteUrl: string;
  minImpressions?: number;
  maxPosition?: number;
}

export async function runSeoQuickWins(
  params: SeoQuickWinsParams,
  config: GscConfig,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  if (!params.siteUrl) return { error: "`siteUrl` is required" };

  const range = defaultDateRange(30);
  const minImpressions = params.minImpressions ?? 10;
  const maxPosition = params.maxPosition ?? 20;

  let rows;
  try {
    rows = await gscSearchAnalyticsQuery(config, {
      siteUrl: params.siteUrl,
      startDate: range.startDate,
      endDate: range.endDate,
      dimensions: ["query"],
      rowLimit: 500,
    });
  } catch (err) {
    if (err instanceof GscApiError) return { error: err.message };
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const opportunities = rows
    .filter(
      (row) =>
        (row.position ?? 0) >= 4 &&
        (row.position ?? 0) <= maxPosition &&
        (row.impressions ?? 0) >= minImpressions,
    )
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
    .slice(0, 15)
    .map((row) => {
      const impressions = row.impressions ?? 0;
      const estClicksIfTop3 = Math.round(impressions * 0.15);
      return {
        query: row.keys?.[0] ?? "",
        clicks: row.clicks ?? 0,
        impressions,
        ctr: Math.round((row.ctr ?? 0) * 10000) / 100,
        position: Math.round((row.position ?? 0) * 10) / 10,
        potential: `+${estClicksIfTop3} clicks/month if top 3`,
      };
    });

  const summary =
    opportunities.length > 0
      ? `SEO quick wins for ${params.siteUrl} (position ${4}-${maxPosition}, ≥${minImpressions} impressions, last 30 days):\n` +
        opportunities
          .map(
            (o, i) =>
              `${i + 1}. "${o.query}" — pos ${o.position}, ${o.impressions} impr, ${o.clicks} clicks (${o.ctr}% CTR) → ${o.potential}`,
          )
          .join("\n")
      : `No SEO quick wins found for ${params.siteUrl} with the current thresholds`;

  return {
    content: summary,
    data: { siteUrl: params.siteUrl, range, opportunities },
  };
}

export const seoQuickWinsDeclaration = {
  displayName: "SEO quick wins",
  description:
    "Identify SEO quick wins: keywords already ranking in positions 4-20 (typically page 2) with enough impressions to be worth optimising. Lists the top 15 by impression volume, with an estimated click uplift if each could reach the top 3.",
  parametersSchema: {
    type: "object",
    properties: {
      siteUrl: { type: "string", description: "The verified GSC property URL." },
      minImpressions: {
        type: "number",
        description: "Minimum impressions for a keyword to be considered (default 10).",
        default: 10,
      },
      maxPosition: {
        type: "number",
        description: "Maximum position to include (default 20 = bottom of page 2).",
        default: 20,
      },
    },
    required: ["siteUrl"],
  } as const,
};
