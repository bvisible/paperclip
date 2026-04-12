/**
 * Google Analytics 4 (Data API v1beta) adapter — minimal `runReport` helper
 * sharing the same OAuth refresh-token flow as the GSC adapter, but with a
 * different scope (analytics.readonly).
 *
 * Used by `seoGa4Traffic` + `seoGa4TopPages`. The plugin caller passes the
 * resolved propertyId so different tenants can target different GA4
 * properties from a single configured Google account.
 */

export interface Ga4Config {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Numeric GA4 property ID, e.g. "367221234". */
  propertyId: string;
}

export interface Ga4Metric {
  name: string;
}

export interface Ga4Dimension {
  name: string;
}

export interface Ga4OrderBy {
  metric?: { metricName: string };
  dimension?: { dimensionName: string };
  desc?: boolean;
}

export interface Ga4RunReportInput {
  startDate: string; // YYYY-MM-DD or "30daysAgo" / "today"
  endDate: string;
  metrics: Ga4Metric[];
  dimensions?: Ga4Dimension[];
  limit?: number;
  orderBys?: Ga4OrderBy[];
}

export interface Ga4RunReportRow {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
}

export interface Ga4RunReportResult {
  rows: Ga4RunReportRow[];
  rowCount: number;
}

export class Ga4ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  constructor(status: number, detail: string) {
    super(`GA4 API error ${status}: ${detail}`);
    this.name = "Ga4ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function refreshAccessToken(config: Pick<Ga4Config, "clientId" | "clientSecret" | "refreshToken">): Promise<string> {
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

export async function ga4RunReport(
  config: Ga4Config,
  input: Ga4RunReportInput,
): Promise<Ga4RunReportResult> {
  if (!config.propertyId) {
    throw new Ga4ApiError(0, "GA4 property ID is not configured");
  }
  const accessToken = await refreshAccessToken(config);

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${config.propertyId}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
        metrics: input.metrics,
        dimensions: input.dimensions,
        limit: input.limit,
        orderBys: input.orderBys,
      }),
    },
  );

  if (!res.ok) throw new Ga4ApiError(res.status, await res.text());

  const data = (await res.json()) as { rows?: Ga4RunReportRow[]; rowCount?: number };
  return {
    rows: data.rows ?? [],
    rowCount: data.rowCount ?? data.rows?.length ?? 0,
  };
}
