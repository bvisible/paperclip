/**
 * seoGscKeywords — top Google Search Console queries for a property.
 *
 * Thin wrapper around the shared GSC adapter.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import {
  gscSearchAnalyticsQuery,
  defaultDateRange,
  GscApiError,
  type GscConfig,
} from "../../adapters/gsc.js";

// Re-export for backwards compatibility with the tools/index.ts barrel
export type { GscConfig } from "../../adapters/gsc.js";

export interface SeoGscKeywordsParams {
  siteUrl: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export async function runSeoGscKeywords(
  params: SeoGscKeywordsParams,
  config: GscConfig,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  if (!params.siteUrl) return { error: "`siteUrl` is required" };

  const range =
    params.startDate && params.endDate
      ? { startDate: params.startDate, endDate: params.endDate }
      : defaultDateRange(7);
  const limit = params.limit ?? 25;

  let rows;
  try {
    rows = await gscSearchAnalyticsQuery(config, {
      siteUrl: params.siteUrl,
      startDate: range.startDate,
      endDate: range.endDate,
      dimensions: ["query"],
      rowLimit: limit,
    });
  } catch (err) {
    if (err instanceof GscApiError) return { error: err.message };
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const keywords = rows.map((row) => ({
    query: row.keys?.[0] ?? "",
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }));

  const summary =
    keywords.length > 0
      ? `Top ${keywords.length} keywords for ${params.siteUrl} (${range.startDate} → ${range.endDate}):\n` +
        keywords
          .map(
            (k, i) =>
              `${i + 1}. "${k.query}" — ${k.clicks} clicks, ${k.impressions} impr, CTR ${(k.ctr * 100).toFixed(2)}%, pos ${k.position.toFixed(1)}`,
          )
          .join("\n")
      : `No GSC data for ${params.siteUrl} between ${range.startDate} and ${range.endDate}`;

  return {
    content: summary,
    data: { siteUrl: params.siteUrl, range, keywords },
  };
}

export const seoGscKeywordsDeclaration = {
  displayName: "Google Search Console — keywords",
  description:
    "Fetch the top search queries (keywords) for a verified Google Search Console property over a date range. Returns clicks, impressions, CTR and average position.",
  parametersSchema: {
    type: "object",
    properties: {
      siteUrl: {
        type: "string",
        description:
          "The verified GSC property URL (e.g. https://neoservice.ai/ or sc-domain:neoservice.ai).",
      },
      startDate: { type: "string", description: "ISO date YYYY-MM-DD. Defaults to 7 days ago." },
      endDate: { type: "string", description: "ISO date YYYY-MM-DD. Defaults to today." },
      limit: {
        type: "number",
        description: "Maximum number of keywords to return (default 25).",
        default: 25,
      },
    },
    required: ["siteUrl"],
  } as const,
};
