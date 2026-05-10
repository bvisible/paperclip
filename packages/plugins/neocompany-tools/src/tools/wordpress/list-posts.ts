/**
 * wpListPosts — list posts from a WordPress site via the REST API.
 *
 * Ported from the legacy Postiz `wp.list-posts.tool.ts`, minus the NestJS
 * `WordPressService` wrapper — we now go through our standalone `wpFetch`
 * adapter.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import { wpFetch, WordPressFetchError, type WordPressConfig } from "../../adapters/wordpress.js";

export interface WpListPostsParams {
  status?: "publish" | "draft" | "pending" | "any";
  perPage?: number;
  search?: string;
}

interface WpPostRow {
  id: number;
  status?: string;
  date?: string;
  link?: string;
  title?: { rendered?: string };
  excerpt?: { rendered?: string };
}

function stripHtml(html: string | undefined): string {
  return (html ?? "").replace(/<[^>]*>/g, "").trim();
}

export async function runWpListPosts(
  params: WpListPostsParams,
  config: WordPressConfig,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  const perPage = params.perPage ?? 10;
  const status = params.status && params.status !== "any" ? params.status : "publish,draft,pending";
  const query: Record<string, string | number> = { per_page: perPage, status };
  if (params.search) query.search = params.search;

  let rows: WpPostRow[];
  try {
    rows = await wpFetch<WpPostRow[]>(config, "/posts", { query });
  } catch (err) {
    if (err instanceof WordPressFetchError) {
      return { error: `WordPress error ${err.status}: ${err.message}` };
    }
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const posts = rows.map((p) => ({
    id: p.id,
    title: stripHtml(p.title?.rendered),
    status: p.status ?? "",
    date: p.date ?? "",
    link: p.link ?? "",
    excerpt: stripHtml(p.excerpt?.rendered).slice(0, 160),
  }));

  const summary =
    `WordPress posts (${posts.length}${params.search ? ` matching "${params.search}"` : ""}):\n` +
    (posts.length === 0
      ? "(no posts)"
      : posts
          .map((p) => `- #${p.id} [${p.status}] ${p.title} — ${p.date.slice(0, 10)}`)
          .join("\n"));

  return { content: summary, data: { posts, total: posts.length } };
}

export const wpListPostsDeclaration = {
  displayName: "List WordPress posts",
  description:
    "List posts from the connected WordPress site. Returns id, title, status, date, link and a short excerpt. Supports status filter (publish/draft/pending/any) and a search term.",
  parametersSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["publish", "draft", "pending", "any"],
        description: "Filter by post status (default: any).",
        default: "any",
      },
      perPage: {
        type: "number",
        description: "Maximum number of posts to return (default 10, max 100).",
        default: 10,
      },
      search: {
        type: "string",
        description: "Optional search term — matches title + content.",
      },
    },
  } as const,
};
