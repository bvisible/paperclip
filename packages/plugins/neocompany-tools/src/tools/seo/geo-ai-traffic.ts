/**
 * geoAITraffic — analyse GA4 sessionSource for AI search engine referrals.
 *
 * Filters the GA4 sessionSource report to highlight traffic coming from
 * generative search engines (ChatGPT, Perplexity, Gemini, Claude, Copilot,
 * You, Phind) and returns the absolute and relative shares.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import { ga4RunReport, Ga4ApiError, type Ga4Config } from "../../adapters/ga4.js";

export interface GeoAITrafficParams {
  startDate?: string;
  endDate?: string;
}

interface AIReferral {
  source: string;
  sessions: number;
  users: number;
}

const AI_SOURCES = [
  "chatgpt.com",
  "chat.openai.com",
  "perplexity.ai",
  "gemini.google.com",
  "claude.ai",
  "bard.google.com",
  "copilot.microsoft.com",
  "you.com",
  "phind.com",
];

function toInt(v: string | undefined): number {
  return parseInt(v ?? "0", 10) || 0;
}

export async function runGeoAITraffic(
  params: GeoAITrafficParams,
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
      dimensions: [{ name: "sessionSource" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      limit: 500,
    });
  } catch (err) {
    if (err instanceof Ga4ApiError) return { error: err.message };
    return { error: err instanceof Error ? err.message : String(err) };
  }

  let totalSessions = 0;
  const aiReferrals: AIReferral[] = [];

  for (const row of report.rows) {
    const source = row.dimensionValues?.[0]?.value ?? "";
    const sessions = toInt(row.metricValues?.[0]?.value);
    const users = toInt(row.metricValues?.[1]?.value);
    totalSessions += sessions;
    if (AI_SOURCES.some((ai) => source.includes(ai))) {
      aiReferrals.push({ source, sessions, users });
    }
  }

  aiReferrals.sort((a, b) => b.sessions - a.sessions);

  const totalAISessions = aiReferrals.reduce((s, r) => s + r.sessions, 0);
  const aiPercentage =
    totalSessions > 0 ? Math.round((totalAISessions / totalSessions) * 10000) / 100 : 0;

  const summary =
    `AI search referrals (${startDate} → ${endDate}):\n` +
    `- Total sessions: ${totalSessions.toLocaleString()}\n` +
    `- AI sessions: ${totalAISessions.toLocaleString()} (${aiPercentage}%)\n` +
    (aiReferrals.length > 0
      ? `- Breakdown:\n` +
        aiReferrals
          .map((r) => `  * ${r.source} — ${r.sessions} sessions, ${r.users} users`)
          .join("\n")
      : `- No AI referrals detected in this window`);

  return {
    content: summary,
    data: {
      range: { startDate, endDate },
      totalSessions,
      totalAISessions,
      aiPercentage,
      aiReferrals,
    },
  };
}

export const geoAITrafficDeclaration = {
  displayName: "AI search engine traffic",
  description:
    "Analyse Google Analytics 4 session sources for traffic coming from generative AI engines (ChatGPT, Perplexity, Gemini, Claude, Copilot, You, Phind). Returns the total session count, the AI subset with sources broken down, and the AI share as a percentage of total traffic.",
  parametersSchema: {
    type: "object",
    properties: {
      startDate: {
        type: "string",
        description: "Start date — ISO YYYY-MM-DD or relative (default 30daysAgo).",
        default: "30daysAgo",
      },
      endDate: {
        type: "string",
        description: "End date — ISO YYYY-MM-DD or relative (default today).",
        default: "today",
      },
    },
  } as const,
};
