/**
 * wpCreatePost — create a new post on a WordPress site via the REST API.
 *
 * Ported from the legacy Postiz `wp.create-post.tool.ts`.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import { wpFetch, WordPressFetchError, type WordPressConfig } from "../../adapters/wordpress.js";

export interface WpCreatePostParams {
  title: string;
  content: string;
  status?: "draft" | "publish" | "pending";
  categories?: number[];
  tags?: number[];
  featuredMediaId?: number;
  excerpt?: string;
}

interface WpCreatePostResponse {
  id: number;
  link?: string;
  status?: string;
  title?: { rendered?: string };
}

export async function runWpCreatePost(
  params: WpCreatePostParams,
  config: WordPressConfig,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  if (!params.title) return { error: "`title` is required" };
  if (!params.content) return { error: "`content` is required" };

  const body: Record<string, unknown> = {
    title: params.title,
    content: params.content,
    status: params.status ?? "draft",
  };
  if (params.categories && params.categories.length > 0) body.categories = params.categories;
  if (params.tags && params.tags.length > 0) body.tags = params.tags;
  if (params.featuredMediaId) body.featured_media = params.featuredMediaId;
  if (params.excerpt) body.excerpt = params.excerpt;

  let res: WpCreatePostResponse;
  try {
    res = await wpFetch<WpCreatePostResponse>(config, "/posts", {
      method: "POST",
      body,
    });
  } catch (err) {
    if (err instanceof WordPressFetchError) {
      return { error: `WordPress error ${err.status}: ${err.message}` };
    }
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const link = res.link ?? "";
  const status = res.status ?? "";
  const summary =
    `WordPress post created: #${res.id} "${params.title}"` +
    (status ? ` (${status})` : "") +
    (link ? `\n${link}` : "");

  return { content: summary, data: { id: res.id, link, status } };
}

export const wpCreatePostDeclaration = {
  displayName: "Create WordPress post",
  description:
    "Create a new post on the connected WordPress site. Supports title, HTML content, draft/publish status, categories (IDs), tags (IDs), featured media ID, and a custom excerpt. Defaults to draft status for safety.",
  parametersSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Post title." },
      content: { type: "string", description: "Post body in HTML." },
      status: {
        type: "string",
        enum: ["draft", "publish", "pending"],
        description: "Publish status — defaults to draft.",
        default: "draft",
      },
      categories: {
        type: "array",
        items: { type: "number" },
        description: "Category IDs to attach.",
      },
      tags: {
        type: "array",
        items: { type: "number" },
        description: "Tag IDs to attach.",
      },
      featuredMediaId: {
        type: "number",
        description: "Featured image media ID (from wpUploadMedia once implemented).",
      },
      excerpt: { type: "string", description: "Custom excerpt." },
    },
    required: ["title", "content"],
  } as const,
};
