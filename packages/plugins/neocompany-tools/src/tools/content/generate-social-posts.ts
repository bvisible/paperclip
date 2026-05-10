/**
 * contentGenerateSocialPosts — platform-specific formatting guidelines.
 *
 * Pure stateless lookup: returns character limits, hashtag counts and style
 * hints for each requested social platform. No external calls, no config.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";

export interface ContentGenerateSocialPostsParams {
  platforms?: string[];
}

const PLATFORM_CONFIGS: Record<string, { maxChars: number; hashtagCount: string; style: string }> = {
  x: { maxChars: 280, hashtagCount: "1-3", style: "punchy, direct, with a hook in the first line" },
  linkedin: { maxChars: 700, hashtagCount: "3-5", style: "professional, B2B, value-driven with a storytelling hook" },
  instagram: { maxChars: 2200, hashtagCount: "20-30", style: "engaging, visual-first, with emojis and a strong CTA" },
  facebook: { maxChars: 500, hashtagCount: "3-5", style: "conversational, community-focused, question or story format" },
  threads: { maxChars: 500, hashtagCount: "1-3", style: "casual, authentic, conversation-starter" },
  tiktok: { maxChars: 150, hashtagCount: "5-10", style: "trendy, Gen-Z friendly, use trending formats" },
  bluesky: { maxChars: 300, hashtagCount: "1-3", style: "conversational, tech-savvy, minimal hashtags" },
  mastodon: { maxChars: 500, hashtagCount: "3-5", style: "community-oriented, accessible, CW-aware" },
};

const DEFAULT = {
  maxChars: 500,
  hashtagCount: "3-5",
  style: "engaging and platform-appropriate",
};

export async function runContentGenerateSocialPosts(
  params: ContentGenerateSocialPostsParams,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  const platforms =
    Array.isArray(params.platforms) && params.platforms.length > 0
      ? params.platforms
      : ["x", "linkedin", "instagram"];

  const guidelines = platforms.map((platform) => {
    const cfg = PLATFORM_CONFIGS[platform.toLowerCase()] ?? DEFAULT;
    return { platform, ...cfg };
  });

  const summary =
    `Formatting guidelines for ${platforms.length} platform(s):\n` +
    guidelines
      .map((g) => `- ${g.platform}: ≤${g.maxChars} chars, ${g.hashtagCount} hashtags — ${g.style}`)
      .join("\n");

  return {
    content: summary,
    data: { guidelines },
  };
}

export const contentGenerateSocialPostsDeclaration = {
  displayName: "Social media formatting guidelines",
  description:
    "Return platform-specific formatting guidelines for adapting content to social networks. For each requested platform (x, linkedin, instagram, facebook, threads, tiktok, bluesky, mastodon) returns the character limit, typical hashtag count, and style hints. No external API calls — use before authoring posts for a new platform.",
  parametersSchema: {
    type: "object",
    properties: {
      platforms: {
        type: "array",
        items: { type: "string" },
        description: "List of target platforms (lowercase). Defaults to x + linkedin + instagram.",
      },
    },
  } as const,
};
