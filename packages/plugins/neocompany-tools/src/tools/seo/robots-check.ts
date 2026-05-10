/**
 * seoRobotsCheck — parse a site's robots.txt and flag AI bot accessibility.
 *
 * Ported from the legacy Postiz `seo.robots-check.tool.ts`. Zero-config:
 * just a public HTTP GET on `<origin>/robots.txt`.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";

export interface SeoRobotsCheckParams {
  url: string;
}

function classifyBot(content: string, botName: string): string {
  const needle = `user-agent: ${botName.toLowerCase()}`;
  const index = content.toLowerCase().indexOf(needle);
  if (index === -1) return "not mentioned (allowed by default)";
  const after = content.substring(index);
  const nextAgent = after.indexOf("user-agent:", 1);
  const section = nextAgent > 0 ? after.substring(0, nextAgent) : after;
  if (section.includes("disallow: /")) return "BLOCKED";
  if (section.includes("allow: /")) return "allowed";
  return "partially restricted";
}

export async function runSeoRobotsCheck(
  params: SeoRobotsCheckParams,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  if (!params.url) return { error: "`url` is required" };

  let baseUrl: string;
  try {
    baseUrl = new URL(params.url).origin;
  } catch {
    return { error: `Invalid URL: ${params.url}` };
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/robots.txt`, { signal: AbortSignal.timeout(15000) });
  } catch (err) {
    return {
      error: `Failed to fetch robots.txt: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    return {
      content: `No robots.txt for ${baseUrl} (HTTP ${res.status}).`,
      data: { exists: false, status: res.status },
    };
  }

  const content = await res.text();
  const lines = content.split("\n");

  const sitemapUrls = lines
    .filter((l) => l.toLowerCase().startsWith("sitemap:"))
    .map((l) => l.split(":").slice(1).join(":").trim())
    .filter(Boolean);

  const blockedPaths = lines
    .filter((l) => l.toLowerCase().startsWith("disallow:") && l.trim().length > 10)
    .map((l) => l.split(":").slice(1).join(":").trim())
    .filter(Boolean)
    .slice(0, 10);

  const gptBot = classifyBot(content, "GPTBot");
  const claudeBot = (() => {
    const primary = classifyBot(content, "ClaudeBot");
    return primary === "not mentioned (allowed by default)" ? classifyBot(content, "Claude-Web") : primary;
  })();
  const aiBotsStatus = {
    GPTBot: gptBot,
    ClaudeBot: claudeBot,
    PerplexityBot: classifyBot(content, "PerplexityBot"),
    GoogleBot: classifyBot(content, "Googlebot"),
  };

  const issues: string[] = [];
  if (sitemapUrls.length === 0) issues.push("No sitemap URL declared in robots.txt");
  if (aiBotsStatus.GPTBot === "BLOCKED") issues.push("GPTBot blocked — content won't appear in ChatGPT");
  if (aiBotsStatus.ClaudeBot === "BLOCKED") issues.push("ClaudeBot blocked — content won't appear in Claude");
  if (aiBotsStatus.PerplexityBot === "BLOCKED") issues.push("PerplexityBot blocked — content won't appear in Perplexity");
  if (aiBotsStatus.GoogleBot === "BLOCKED") issues.push("Googlebot blocked — site won't be indexed");

  const summary =
    `robots.txt for ${baseUrl}:\n` +
    `- Sitemaps: ${sitemapUrls.length > 0 ? sitemapUrls.join(", ") : "(none declared)"}\n` +
    `- Disallowed paths: ${blockedPaths.length > 0 ? blockedPaths.join(", ") : "(none)"}\n` +
    `- AI bots: GPTBot=${aiBotsStatus.GPTBot}, ClaudeBot=${aiBotsStatus.ClaudeBot}, ` +
    `PerplexityBot=${aiBotsStatus.PerplexityBot}, Googlebot=${aiBotsStatus.GoogleBot}\n` +
    (issues.length > 0 ? `- Issues:\n  * ${issues.join("\n  * ")}` : "- No issues detected");

  return {
    content: summary,
    data: {
      exists: true,
      baseUrl,
      sitemapUrls,
      blockedPaths,
      aiBotsStatus,
      issues,
      contentPreview: content.substring(0, 500),
    },
  };
}

export const seoRobotsCheckDeclaration = {
  displayName: "Check robots.txt",
  description:
    "Fetch and parse the robots.txt of a website. Reports declared sitemaps, disallowed paths, and whether AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Googlebot) are allowed. Useful for GEO visibility audits.",
  parametersSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Any URL on the site (e.g. https://neoservice.ai). The origin will be used.",
      },
    },
    required: ["url"],
  } as const,
};
