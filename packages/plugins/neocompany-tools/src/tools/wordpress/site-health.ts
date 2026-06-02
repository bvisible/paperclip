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

//// Neocompany Modification — single per-request timeout, well under the
//// host's ~30s executeTool RPC cap. The old code fetched the heavy /wp-json
//// root (15s) THEN types (10s) THEN counts SEQUENTIALLY — up to ~35s total,
//// which blew the RPC budget and surfaced to the agent as a 502. Everything
//// is now fetched in parallel with a short per-request timeout, so the whole
//// tool finishes in ~one fetch's time, and a slow endpoint degrades to a
//// partial report instead of failing the whole call.
const WP_FETCH_TIMEOUT_MS = 8000;

async function safeJson(url: string, auth: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(WP_FETCH_TIMEOUT_MS),
    });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function safeFetchCount(
  base: string,
  endpoint: string,
  auth: string,
): Promise<number> {
  try {
    const res = await fetch(`${base}/wp-json/wp/v2/${endpoint}?per_page=1`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(WP_FETCH_TIMEOUT_MS),
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

  // Fetch everything in parallel (root info, post types, and the three counts)
  // so total wall-clock stays ~one request, never the sum.
  const [siteData, typesData, totalPosts, totalPages, totalMedia] = await Promise.all([
    safeJson(`${base}/wp-json`, auth),
    safeJson(`${base}/wp-json/wp/v2/types`, auth),
    safeFetchCount(base, "posts", auth),
    safeFetchCount(base, "pages", auth),
    safeFetchCount(base, "media", auth),
  ]);

  const postTypes = Object.keys(typesData).filter(
    (t) => !t.startsWith("wp_") && !t.startsWith("nav_") && t !== "attachment",
  );

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
