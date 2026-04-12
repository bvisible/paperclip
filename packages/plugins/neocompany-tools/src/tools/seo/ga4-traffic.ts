/**
 * seoGa4Traffic — site-wide traffic snapshot from Google Analytics 4.
 *
 * Returns sessions, users, page views, bounce rate and average session
 * duration over the requested date range. Ported from the legacy Postiz
 * `seo.ga4.traffic.tool.ts` on top of the shared GA4 adapter.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import { ga4RunReport, Ga4ApiError, type Ga4Config } from "../../adapters/ga4.js";

export interface SeoGa4TrafficParams {
  startDate?: string;
  endDate?: string;
}

function toInt(v: string | undefined): number {
  return parseInt(v ?? "0", 10) || 0;
}

function toFloat(v: string | undefined): number {
  return parseFloat(v ?? "0") || 0;
}

export async function runSeoGa4Traffic(
  params: SeoGa4TrafficParams,
  config: Ga4Config,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  const startDate = params.startDate ?? "30daysAgo";
  const endDate = params.endDate ?? "today";

  let report;
  try {
    report = await ga4RunReport(config, {
      startDate,
      endDate,
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "screenPageViews" },
        { name: "bounceRate" },
        { name: "averageSessionDuration" },
      ],
    });
  } catch (err) {
    if (err instanceof Ga4ApiError) return { error: err.message };
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const row = report.rows[0]?.metricValues ?? [];
  const sessions = toInt(row[0]?.value);
  const users = toInt(row[1]?.value);
  const pageViews = toInt(row[2]?.value);
  const bounceRate = toFloat(row[3]?.value);
  const avgSessionDuration = toFloat(row[4]?.value);

  const summary =
    `GA4 traffic for property ${config.propertyId} (${startDate} → ${endDate}):\n` +
    `- Sessions: ${sessions.toLocaleString()}\n` +
    `- Users: ${users.toLocaleString()}\n` +
    `- Page views: ${pageViews.toLocaleString()}\n` +
    `- Bounce rate: ${(bounceRate * 100).toFixed(1)}%\n` +
    `- Avg session duration: ${avgSessionDuration.toFixed(0)}s`;

  return {
    content: summary,
    data: {
      propertyId: config.propertyId,
      range: { startDate, endDate },
      sessions,
      users,
      pageViews,
      bounceRate,
      avgSessionDuration,
    },
  };
}

export const seoGa4TrafficDeclaration = {
  displayName: "Google Analytics 4 — traffic",
  description:
    "Get the site-wide traffic snapshot from Google Analytics 4 for a date range. Returns sessions, users, page views, bounce rate, and average session duration. Date strings accept ISO YYYY-MM-DD or relative shortcuts (e.g. 30daysAgo, yesterday, today).",
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
    },
  } as const,
};
