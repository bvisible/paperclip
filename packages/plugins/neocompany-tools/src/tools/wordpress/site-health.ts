/**
 * wpSiteHealth — quick health check of the connected WordPress site.
 *
 * Ported from the legacy Postiz `wp.site-health.tool.ts`. Needs access to
 * the bare `/wp-json` index (outside the `/wp/v2` namespace), so we build
 * the URLs manually instead of going through `wpFetch`.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { WordPressConfig } from "../../adapters/wordpress.js";

export interface WpSiteHealthParams {
  // empty — no parameters
}

function basicAuthHeader(username: string, appPassword: string): string {
  return "Basic " + Buffer.from(`${username}:${appPassword}`).toString("base64");
}

async function safeFetchCount(
  base: string,
  endpoint: string,
  auth: string,
): Promise<number> {
  try {
    const res = await fetch(`${base}/wp-json/wp/v2/${endpoint}?per_page=1`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return 0;
    return parseInt(res.headers.get("x-wp-total") ?? "0", 10) || 0;
  } catch {
    return 0;
  }
}

export async function runWpSiteHealth(
  _params: WpSiteHealthParams,
  config: WordPressConfig,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  const base = config.siteUrl.replace(/\/+$/, "");
  const auth = basicAuthHeader(config.username, config.appPassword);

  // Fetch site info from the /wp-json root (no namespace prefix)
  let siteData: Record<string, unknown> = {};
  try {
    const res = await fetch(`${base}/wp-json`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) siteData = (await res.json()) as Record<string, unknown>;
  } catch {
    return { error: `Unable to reach ${base}/wp-json` };
  }

  // Discover registered post types
  let typesData: Record<string, unknown> = {};
  try {
    const res = await fetch(`${base}/wp-json/wp/v2/types`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) typesData = (await res.json()) as Record<string, unknown>;
  } catch {
    // Non-fatal: keep empty set
  }
  const postTypes = Object.keys(typesData).filter(
    (t) => !t.startsWith("wp_") && !t.startsWith("nav_") && t !== "attachment",
  );

  const [totalPosts, totalPages, totalMedia] = await Promise.all([
    safeFetchCount(base, "posts", auth),
    safeFetchCount(base, "pages", auth),
    safeFetchCount(base, "media", auth),
  ]);

  const siteName = (siteData.name as string) ?? "";
  const description = (siteData.description as string) ?? "";

  const summary =
    `WordPress site health — ${siteName || base}\n` +
    (description ? `  ${description}\n` : "") +
    `- Site URL: ${base}\n` +
    `- Posts: ${totalPosts}\n` +
    `- Pages: ${totalPages}\n` +
    `- Media items: ${totalMedia}\n` +
    `- Custom post types: ${postTypes.length > 0 ? postTypes.join(", ") : "(none)"}`;

  return {
    content: summary,
    data: {
      siteUrl: base,
      siteName,
      description,
      totalPosts,
      totalPages,
      totalMedia,
      postTypes,
    },
  };
}

export const wpSiteHealthDeclaration = {
  displayName: "WordPress site health",
  description:
    "Report health and inventory of the connected WordPress site: name, description, total post count, total pages, total media items, and registered custom post types. Useful as a sanity check before posting.",
  parametersSchema: {
    type: "object",
    properties: {},
  } as const,
};
