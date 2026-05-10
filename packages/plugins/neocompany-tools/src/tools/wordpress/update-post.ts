/**
 * wpUpdatePost — update an existing WordPress post.
 *
 * Ported from the legacy Postiz `wp.update-post.tool.ts`.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import { wpFetch, WordPressFetchError, type WordPressConfig } from "../../adapters/wordpress.js";

export interface WpUpdatePostParams {
  postId: number;
  title?: string;
  content?: string;
  status?: "draft" | "publish" | "pending";
  categories?: number[];
  tags?: number[];
  featuredMediaId?: number;
}

interface WpUpdatePostResponse {
  id: number;
  link?: string;
  status?: string;
}

export async function runWpUpdatePost(
  params: WpUpdatePostParams,
  config: WordPressConfig,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  if (!params.postId) return { error: "`postId` is required" };

  const body: Record<string, unknown> = {};
  if (params.title !== undefined) body.title = params.title;
  if (params.content !== undefined) body.content = params.content;
  if (params.status !== undefined) body.status = params.status;
  if (params.categories && params.categories.length > 0) body.categories = params.categories;
  if (params.tags && params.tags.length > 0) body.tags = params.tags;
  if (params.featuredMediaId !== undefined) body.featured_media = params.featuredMediaId;

  if (Object.keys(body).length === 0) {
    return { error: "at least one field to update must be provided" };
  }

  let res: WpUpdatePostResponse;
  try {
    res = await wpFetch<WpUpdatePostResponse>(config, `/posts/${params.postId}`, {
      method: "POST",
      body,
    });
  } catch (err) {
    if (err instanceof WordPressFetchError) {
      return { error: `WordPress error ${err.status}: ${err.message}` };
    }
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const summary =
    `WordPress post #${res.id} updated` +
    (res.status ? ` (status: ${res.status})` : "") +
    (res.link ? `\n${res.link}` : "");

  return { content: summary, data: { id: res.id, link: res.link ?? "", status: res.status ?? "" } };
}

export const wpUpdatePostDeclaration = {
  displayName: "Update WordPress post",
  description:
    "Patch an existing WordPress post. At least one field (title, content, status, categories, tags, or featuredMediaId) must be supplied. Uses a POST to /wp/v2/posts/:id which WordPress accepts for partial updates.",
  parametersSchema: {
    type: "object",
    properties: {
      postId: { type: "number", description: "WordPress post ID to update." },
      title: { type: "string", description: "New title (optional)." },
      content: { type: "string", description: "New HTML body (optional)." },
      status: {
        type: "string",
        enum: ["draft", "publish", "pending"],
        description: "New publish status (optional).",
      },
      categories: {
        type: "array",
        items: { type: "number" },
        description: "Full list of category IDs to assign (replaces existing).",
      },
      tags: {
        type: "array",
        items: { type: "number" },
        description: "Full list of tag IDs to assign (replaces existing).",
      },
      featuredMediaId: {
        type: "number",
        description: "Featured media ID.",
      },
    },
    required: ["postId"],
  } as const,
};
