/**
 * seoGa4TopPages — top pages by GA4 sessions over a date range.
 *
 * Ported from the legacy Postiz `seo.ga4.top-pages.tool.ts` on top of the
 * shared GA4 adapter.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import { ga4RunReport, Ga4ApiError, type Ga4Config } from "../../adapters/ga4.js";

export interface SeoGa4TopPagesParams {
  startDate?: string;
  endDate?: string;
  limit?: number;
}

function toInt(v: string | undefined): number {
  return parseInt(v ?? "0", 10) || 0;
}

export async function runSeoGa4TopPages(
  params: SeoGa4TopPagesParams,
  config: Ga4Config,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  const startDate = params.startDate ?? "30daysAgo";
  const endDate = params.endDate ?? "today";
  const limit = Math.max(1, Math.min(params.limit ?? 10, 100));

  let report;
  try {
    report = await ga4RunReport(config, {
      startDate,
      endDate,
      dimensions: [{ name: "pagePath" }],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "screenPageViews" },
      ],
      limit,
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    });
  } catch (err) {
    if (err instanceof Ga4ApiError) return { error: err.message };
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const pages = report.rows.map((row) => ({
    path: row.dimensionValues?.[0]?.value ?? "",
    sessions: toInt(row.metricValues?.[0]?.value),
    users: toInt(row.metricValues?.[1]?.value),
    pageViews: toInt(row.metricValues?.[2]?.value),
  }));

  const summary =
    pages.length > 0
      ? `GA4 top ${pages.length} pages (${startDate} → ${endDate}):\n` +
        pages
          .map(
            (p, i) =>
              `${i + 1}. ${p.path} — ${p.sessions} sessions, ${p.users} users, ${p.pageViews} views`,
          )
          .join("\n")
      : `No GA4 page data for property ${config.propertyId} between ${startDate} and ${endDate}`;

  return {
    content: summary,
    data: {
      propertyId: config.propertyId,
      range: { startDate, endDate },
      pages,
    },
  };
}

export const seoGa4TopPagesDeclaration = {
  displayName: "Google Analytics 4 — top pages",
  description:
    "Return the top pages of the configured GA4 property over a date range, ordered by sessions. Each row includes sessions, total users and screen page views.",
  parametersSchema: {
    type: "object",
    properties: {
      startDate: {
        type: "string",
        description: "Start date — ISO or relative (default 30daysAgo).",
        default: "30daysAgo",
      },
      endDate: {
        type: "string",
        description: "End date — ISO or relative (default today).",
        default: "today",
      },
      limit: {
        type: "number",
        description: "Maximum number of pages to return (default 10, max 100).",
        default: 10,
      },
    },
  } as const,
};
