/**
 * Google Search Console adapter — thin wrapper around the Search Analytics
 * API that handles OAuth refresh-token flow and returns parsed rows.
 *
 * Shared by all GSC-backed tools (seoGscKeywords, seoGscTopPages,
 * seoQuickWins) so there's a single place to maintain auth + URL handling.
 */

export interface GscConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GscQueryInput {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions: Array<"query" | "page" | "country" | "device" | "searchAppearance">;
  rowLimit?: number;
}

export interface GscQueryRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

export class GscApiError extends Error {
  readonly status: number;
  readonly detail: string;
  constructor(status: number, detail: string) {
    super(`GSC API error ${status}: ${detail}`);
    this.name = "GscApiError";
    this.status = status;
    this.detail = detail;
  }
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
    throw new Error(`Google token refresh failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Google token refresh did not return an access_token");
  return json.access_token;
}

export async function gscSearchAnalyticsQuery(
  config: GscConfig,
  input: GscQueryInput,
): Promise<GscQueryRow[]> {
  const accessToken = await refreshAccessToken(config);
  const url =
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(input.siteUrl)}` +
    `/searchAnalytics/query`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDate: input.startDate,
      endDate: input.endDate,
      dimensions: input.dimensions,
      rowLimit: input.rowLimit ?? 100,
      type: "web",
    }),
  });

  if (!res.ok) throw new GscApiError(res.status, await res.text());

  const data = (await res.json()) as { rows?: GscQueryRow[] };
  return data.rows ?? [];
}

export function defaultDateRange(days = 7): { startDate: string; endDate: string } {
  const endDate = new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setDate(start.getDate() - days);
  const startDate = start.toISOString().slice(0, 10);
  return { startDate, endDate };
}
