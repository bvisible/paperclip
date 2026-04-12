/**
 * seoGscTopPages — top URLs by organic clicks from Google Search Console.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import {
  gscSearchAnalyticsQuery,
  defaultDateRange,
  GscApiError,
  type GscConfig,
} from "../../adapters/gsc.js";

export interface SeoGscTopPagesParams {
  siteUrl: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export async function runSeoGscTopPages(
  params: SeoGscTopPagesParams,
  config: GscConfig,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  if (!params.siteUrl) return { error: "`siteUrl` is required" };

  const range =
    params.startDate && params.endDate
      ? { startDate: params.startDate, endDate: params.endDate }
      : defaultDateRange(30);
  const limit = params.limit ?? 10;

  let rows;
  try {
    rows = await gscSearchAnalyticsQuery(config, {
      siteUrl: params.siteUrl,
      startDate: range.startDate,
      endDate: range.endDate,
      dimensions: ["page"],
      rowLimit: limit,
    });
  } catch (err) {
    if (err instanceof GscApiError) return { error: err.message };
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const pages = rows.map((row) => ({
    url: row.keys?.[0] ?? "",
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: Math.round((row.ctr ?? 0) * 10000) / 100,
    position: Math.round((row.position ?? 0) * 10) / 10,
  }));

  const summary =
    pages.length > 0
      ? `Top ${pages.length} pages for ${params.siteUrl} (${range.startDate} → ${range.endDate}):\n` +
        pages
          .map(
            (p, i) =>
              `${i + 1}. ${p.url} — ${p.clicks} clicks, ${p.impressions} impr, CTR ${p.ctr}%, pos ${p.position}`,
          )
          .join("\n")
      : `No GSC page data for ${params.siteUrl} between ${range.startDate} and ${range.endDate}`;

  return { content: summary, data: { siteUrl: params.siteUrl, range, pages } };
}

export const seoGscTopPagesDeclaration = {
  displayName: "Google Search Console — top pages",
  description:
    "Return the best performing pages (by organic clicks) for a verified GSC property over a date range. Good for identifying which URLs carry your current traffic.",
  parametersSchema: {
    type: "object",
    properties: {
      siteUrl: { type: "string", description: "The verified GSC property URL." },
      startDate: { type: "string", description: "ISO date YYYY-MM-DD. Defaults to 30 days ago." },
      endDate: { type: "string", description: "ISO date YYYY-MM-DD. Defaults to today." },
      limit: {
        type: "number",
        description: "Maximum number of pages to return (default 10).",
        default: 10,
      },
    },
    required: ["siteUrl"],
  } as const,
};
