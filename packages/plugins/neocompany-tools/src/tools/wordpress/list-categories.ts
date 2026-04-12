/**
 * wpListCategories — list categories or tags from a WordPress site.
 *
 * Ported from the legacy Postiz `wp.list-categories.tool.ts`.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import { wpFetch, WordPressFetchError, type WordPressConfig } from "../../adapters/wordpress.js";

export interface WpListCategoriesParams {
  type?: "categories" | "tags";
}

interface WpTaxonomyRow {
  id: number;
  name?: string;
  slug?: string;
  count?: number;
}

export async function runWpListCategories(
  params: WpListCategoriesParams,
  config: WordPressConfig,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  const type = params.type === "tags" ? "tags" : "categories";
  const endpoint = type === "tags" ? "/tags" : "/categories";

  let rows: WpTaxonomyRow[];
  try {
    rows = await wpFetch<WpTaxonomyRow[]>(config, endpoint, { query: { per_page: 100 } });
  } catch (err) {
    if (err instanceof WordPressFetchError) {
      return { error: `WordPress error ${err.status}: ${err.message}` };
    }
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const items = rows.map((row) => ({
    id: row.id,
    name: row.name ?? "",
    slug: row.slug ?? "",
    count: row.count ?? 0,
  }));

  const summary =
    `WordPress ${type} (${items.length}):\n` +
    (items.length === 0
      ? `(no ${type})`
      : items
          .slice(0, 30)
          .map((c) => `- #${c.id} ${c.name} (${c.count} post${c.count === 1 ? "" : "s"})`)
          .join("\n"));

  return { content: summary, data: { type, items } };
}

export const wpListCategoriesDeclaration = {
  displayName: "List WordPress categories or tags",
  description:
    "Return the list of categories (default) or tags for the connected WordPress site. Useful for discovering the right IDs before creating or updating a post.",
  parametersSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["categories", "tags"],
        description: "Which taxonomy to list (default: categories).",
        default: "categories",
      },
    },
  } as const,
};
