/**
 * seoCompetitorPageRank — compare domain authority via Open PageRank API.
 *
 * Ported from the legacy Postiz `seo.competitor-pagerank.tool.ts`. Uses the
 * free Open PageRank endpoint. An API key (via `openPageRankApiKeyRef`) lifts
 * the rate limit but isn't required — the API also answers anonymous calls.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";

export interface SeoCompetitorPageRankParams {
  domains: string[];
}

export interface OpenPageRankConfig {
  apiKey?: string;
}

interface OpenPageRankResponseEntry {
  domain?: string;
  page_rank_decimal?: number | string;
  rank?: number | string;
  status_code?: number;
  error?: string;
}

function normaliseDomain(input: string): string {
  // trim() FIRST so leading/trailing whitespace doesn't defeat the `^`
  // anchor of the protocol-strip regex.
  return input.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

export async function runSeoCompetitorPageRank(
  params: SeoCompetitorPageRankParams,
  config: OpenPageRankConfig,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  if (!Array.isArray(params.domains) || params.domains.length === 0) {
    return { error: "`domains` must be a non-empty array of domain names" };
  }

  const domains = params.domains.map(normaliseDomain).filter(Boolean);
  if (domains.length === 0) return { error: "no valid domains after normalisation" };

  const query = domains.map((d) => `domains[]=${encodeURIComponent(d)}`).join("&");
  const url = `https://openpagerank.com/api/v1.0/getPageRank?${query}`;
  const headers: Record<string, string> = {};
  if (config.apiKey) headers["API-OPR"] = config.apiKey;

  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  } catch (err) {
    return { error: `Open PageRank request failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!res.ok) {
    // Retry once without the API key (in case the key is invalid/rate-limited)
    if (config.apiKey) {
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      } catch (err) {
        return { error: `Open PageRank retry failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    if (!res.ok) return { error: `Open PageRank API error ${res.status}` };
  }

  const data = (await res.json()) as { response?: OpenPageRankResponseEntry[] };
  const rows = data.response ?? [];
  const comparison = rows.map((row) => ({
    domain: row.domain ?? "",
    pageRank: Number(row.page_rank_decimal ?? 0),
    rank: Number(row.rank ?? 0),
  }));

  comparison.sort((a, b) => b.pageRank - a.pageRank);

  const summary =
    `Open PageRank comparison:\n` +
    comparison
      .map((c, i) => `  ${i + 1}. ${c.domain} — PR ${c.pageRank.toFixed(2)} (global rank ${c.rank || "?"})`)
      .join("\n");

  return { content: summary, data: { comparison } };
}

export const seoCompetitorPageRankDeclaration = {
  displayName: "Competitor PageRank comparison",
  description:
    "Compare your site vs competitors using the free Open PageRank API. Returns decimal PageRank and a global rank for each domain. Pass 2+ domains for a direct comparison.",
  parametersSchema: {
    type: "object",
    properties: {
      domains: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        description: "Domains or URLs to compare. Protocols and paths are stripped automatically.",
      },
    },
    required: ["domains"],
  } as const,
};
