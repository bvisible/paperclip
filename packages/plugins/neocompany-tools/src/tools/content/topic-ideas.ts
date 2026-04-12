/**
 * contentTopicIdeas — suggest blog/article topic ideas based on the real
 * Google Search Console keyword data for a site.
 *
 * Ported from the legacy Postiz `content.topic-ideas.tool.ts`. Reuses the
 * shared GSC adapter for auth + API calls.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import {
  gscSearchAnalyticsQuery,
  defaultDateRange,
  GscApiError,
  type GscConfig,
} from "../../adapters/gsc.js";

export interface ContentTopicIdeasParams {
  siteUrl: string;
  count?: number;
}

interface TopicIdea {
  keyword: string;
  impressions: number;
  position: number;
  suggestedTopic: string;
  angle: string;
}

function classifyAngle(position: number, ctr: number): string {
  if (position > 20) return "New content needed — not ranking yet";
  if (position > 10) return "Optimize existing content to reach page 1";
  if (ctr < 0.03) return "Improve title/meta to boost CTR";
  return "Expand and deepen existing content";
}

export async function runContentTopicIdeas(
  params: ContentTopicIdeasParams,
  config: GscConfig,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  if (!params.siteUrl) return { error: "`siteUrl` is required" };
  const count = Math.max(1, Math.min(params.count ?? 5, 30));
  const range = defaultDateRange(90);

  let rows;
  try {
    rows = await gscSearchAnalyticsQuery(config, {
      siteUrl: params.siteUrl,
      startDate: range.startDate,
      endDate: range.endDate,
      dimensions: ["query"],
      rowLimit: 200,
    });
  } catch (err) {
    if (err instanceof GscApiError) return { error: err.message };
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const ideas: TopicIdea[] = rows
    .filter((row) => (row.impressions ?? 0) >= 5)
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
    .slice(0, count * 3)
    .map((row) => {
      const keyword = row.keys?.[0] ?? "";
      const position = Math.round((row.position ?? 0) * 10) / 10;
      const ctr = row.ctr ?? 0;
      return {
        keyword,
        impressions: row.impressions ?? 0,
        position,
        suggestedTopic: `Article about "${keyword}"`,
        angle: classifyAngle(position, ctr),
      };
    })
    .slice(0, count);

  const summary =
    ideas.length > 0
      ? `Content topic ideas for ${params.siteUrl} (last 90 days):\n` +
        ideas
          .map(
            (i, n) =>
              `${n + 1}. "${i.keyword}" — ${i.impressions} impr, pos ${i.position} → ${i.angle}`,
          )
          .join("\n")
      : `No content opportunities found for ${params.siteUrl}`;

  return {
    content: summary,
    data: { siteUrl: params.siteUrl, range, ideas },
  };
}

export const contentTopicIdeasDeclaration = {
  displayName: "Content topic ideas",
  description:
    "Suggest blog or article topic ideas based on real Google Search Console keyword data over the last 90 days. Each idea includes the source keyword, impression volume, current ranking position, and a suggested editorial angle (new content, optimise existing, boost CTR, or expand).",
  parametersSchema: {
    type: "object",
    properties: {
      siteUrl: { type: "string", description: "The verified GSC property URL." },
      count: {
        type: "number",
        description: "Number of topic ideas to return (default 5, max 30).",
        default: 5,
      },
    },
    required: ["siteUrl"],
  } as const,
};
