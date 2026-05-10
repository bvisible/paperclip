/**
 * seoTrendAnalysis — compare GSC keyword performance between two periods.
 *
 * Detects keywords that are growing, declining, or anomalous between a
 * "recent" window and a "previous" window of equal length. Reuses the
 * shared GSC adapter so it inherits OAuth refresh + URL handling.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import {
  gscSearchAnalyticsQuery,
  GscApiError,
  type GscConfig,
  type GscQueryRow,
} from "../../adapters/gsc.js";

export interface SeoTrendAnalysisParams {
  siteUrl: string;
  recentDays?: number;
  compareDays?: number;
}

interface TrendRow {
  query: string;
  currentClicks: number;
  previousClicks: number;
  changePercent: number;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function rowsByQuery(rows: GscQueryRow[]): Record<string, { clicks: number; impressions: number }> {
  const map: Record<string, { clicks: number; impressions: number }> = {};
  for (const row of rows) {
    const key = row.keys?.[0];
    if (!key) continue;
    map[key] = { clicks: row.clicks ?? 0, impressions: row.impressions ?? 0 };
  }
  return map;
}

export async function runSeoTrendAnalysis(
  params: SeoTrendAnalysisParams,
  config: GscConfig,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  if (!params.siteUrl) return { error: "`siteUrl` is required" };

  const recentDays = Math.max(1, params.recentDays ?? 30);
  const compareDays = Math.max(1, params.compareDays ?? 30);

  const recentEnd = isoDaysAgo(0);
  const recentStart = isoDaysAgo(recentDays);
  const previousEnd = recentStart;
  const previousStart = isoDaysAgo(recentDays + compareDays);

  let recentRows: GscQueryRow[];
  let previousRows: GscQueryRow[];
  try {
    [recentRows, previousRows] = await Promise.all([
      gscSearchAnalyticsQuery(config, {
        siteUrl: params.siteUrl,
        startDate: recentStart,
        endDate: recentEnd,
        dimensions: ["query"],
        rowLimit: 200,
      }),
      gscSearchAnalyticsQuery(config, {
        siteUrl: params.siteUrl,
        startDate: previousStart,
        endDate: previousEnd,
        dimensions: ["query"],
        rowLimit: 200,
      }),
    ]);
  } catch (err) {
    if (err instanceof GscApiError) return { error: err.message };
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const recent = rowsByQuery(recentRows);
  const previous = rowsByQuery(previousRows);
  const allQueries = new Set([...Object.keys(recent), ...Object.keys(previous)]);

  const trends: TrendRow[] = [];
  for (const q of allQueries) {
    const curr = recent[q]?.clicks ?? 0;
    const prev = previous[q]?.clicks ?? 0;
    if (curr + prev < 2) continue;
    const changePercent = prev > 0 ? ((curr - prev) / prev) * 100 : curr > 0 ? 100 : 0;
    trends.push({ query: q, currentClicks: curr, previousClicks: prev, changePercent });
  }

  const trendingUp = trends
    .filter((t) => t.changePercent > 20)
    .sort((a, b) => b.changePercent - a.changePercent)
    .slice(0, 10)
    .map((t) => ({
      query: t.query,
      currentClicks: t.currentClicks,
      previousClicks: t.previousClicks,
      change: `+${Math.round(t.changePercent)}%`,
    }));

  const trendingDown = trends
    .filter((t) => t.changePercent < -20)
    .sort((a, b) => a.changePercent - b.changePercent)
    .slice(0, 10)
    .map((t) => ({
      query: t.query,
      currentClicks: t.currentClicks,
      previousClicks: t.previousClicks,
      change: `${Math.round(t.changePercent)}%`,
    }));

  const totalCurrent = Object.values(recent).reduce((s, v) => s + v.clicks, 0);
  const totalPrevious = Object.values(previous).reduce((s, v) => s + v.clicks, 0);
  const overallChange =
    totalPrevious > 0 ? Math.round(((totalCurrent - totalPrevious) / totalPrevious) * 100) : 0;

  const summary =
    `GSC trend analysis for ${params.siteUrl}\n` +
    `  Recent window:   ${recentStart} → ${recentEnd}\n` +
    `  Previous window: ${previousStart} → ${previousEnd}\n` +
    `- Overall traffic: ${overallChange >= 0 ? "+" : ""}${overallChange}% (${totalCurrent} vs ${totalPrevious} clicks)\n` +
    `- Growing keywords: ${trendingUp.length}\n` +
    (trendingUp.length > 0
      ? trendingUp.map((t) => `    ↑ "${t.query}" ${t.change} (${t.previousClicks} → ${t.currentClicks})`).join("\n") + "\n"
      : "") +
    `- Declining keywords: ${trendingDown.length}` +
    (trendingDown.length > 0
      ? "\n" + trendingDown.map((t) => `    ↓ "${t.query}" ${t.change} (${t.previousClicks} → ${t.currentClicks})`).join("\n")
      : "");

  return {
    content: summary,
    data: {
      siteUrl: params.siteUrl,
      windows: { recentStart, recentEnd, previousStart, previousEnd },
      overallChangePercent: overallChange,
      totalCurrent,
      totalPrevious,
      trendingUp,
      trendingDown,
    },
  };
}

export const seoTrendAnalysisDeclaration = {
  displayName: "SEO trend analysis",
  description:
    "Compare Google Search Console performance between two equal-length windows and surface keywords that grew >20% (`trendingUp`) or declined >20% (`trendingDown`). Returns the overall traffic delta and the top 10 movers in each direction.",
  parametersSchema: {
    type: "object",
    properties: {
      siteUrl: { type: "string", description: "The verified GSC property URL." },
      recentDays: {
        type: "number",
        description: "Length of the recent window in days (default 30).",
        default: 30,
      },
      compareDays: {
        type: "number",
        description: "Length of the comparison window in days (default 30).",
        default: 30,
      },
    },
    required: ["siteUrl"],
  } as const,
};
