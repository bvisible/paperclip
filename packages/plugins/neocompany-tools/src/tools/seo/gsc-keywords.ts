/**
 * seoGscKeywords — fetch top keywords from Google Search Console.
 *
 * Ported from the legacy Postiz `seo.gsc.keywords.tool.ts`. Self-contained:
 * takes a Google OAuth refresh token from plugin secrets, refreshes it against
 * the Google token endpoint, and calls the Search Analytics API directly.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";

export interface SeoGscKeywordsParams {
  siteUrl: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export interface GscConfig {
  /** Google OAuth2 client ID (plain, not secret). */
  clientId: string;
  /** Resolved client secret value. */
  clientSecret: string;
  /** Resolved refresh token value. */
  refreshToken: string;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultDateRange(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 7);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

async function refreshAccessToken(config: GscConfig): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("Google token refresh did not return an access_token");
  }
  return json.access_token;
}

export async function runSeoGscKeywords(
  params: SeoGscKeywordsParams,
  config: GscConfig,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  if (!params.siteUrl) {
    return { error: "siteUrl is required" };
  }
  const range = params.startDate && params.endDate
    ? { startDate: params.startDate, endDate: params.endDate }
    : defaultDateRange();
  const limit = params.limit ?? 25;

  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(config);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(params.siteUrl)}/searchAnalytics/query`;
  const body = {
    startDate: range.startDate,
    endDate: range.endDate,
    dimensions: ["query"],
    rowLimit: limit,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    return { error: `GSC API error (${res.status}): ${text}` };
  }

  const data = (await res.json()) as {
    rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }>;
  };
  const rows = data.rows ?? [];
  const keywords = rows.map((row) => ({
    query: row.keys?.[0] ?? "",
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }));

  const summary = keywords.length > 0
    ? `Top ${keywords.length} keywords for ${params.siteUrl} (${range.startDate} → ${range.endDate}):\n` +
      keywords
        .map((k, i) => `${i + 1}. "${k.query}" — ${k.clicks} clicks, ${k.impressions} impr, CTR ${(k.ctr * 100).toFixed(2)}%, pos ${k.position.toFixed(1)}`)
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
        description: "The verified GSC property URL (e.g. https://neoservice.ai/ or sc-domain:neoservice.ai).",
      },
      startDate: {
        type: "string",
        description: "ISO date YYYY-MM-DD. Defaults to 7 days ago.",
      },
      endDate: {
        type: "string",
        description: "ISO date YYYY-MM-DD. Defaults to today.",
      },
      limit: {
        type: "number",
        description: "Maximum number of keywords to return (default 25, max 1000).",
        default: 25,
      },
    },
    required: ["siteUrl"],
  } as const,
};
