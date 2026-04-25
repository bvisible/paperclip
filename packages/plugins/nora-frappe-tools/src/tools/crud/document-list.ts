import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

// Hard cap at 50 to keep a list response well under the LLM context budget.
// 100+ rows of JSON typically blow the assistant turn (no reply emitted) — for
// counts/aggregates the agent should use frappeDocumentCount or frappeSqlQuery.
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

const InputSchema = z.object({
  doctype: z.string().min(1),
  filters: z.record(z.unknown()).optional(),
  fields: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(MAX_LIMIT).optional(),
  order_by: z.string().optional(),
});

interface FrappeListResponse {
  success?: boolean;
  // Frappe endpoint shape: {"success": true, "data": {"documents": [...], "count": N, ...}}.
  // Legacy flat shape (items/count at root) kept for backward compat.
  data?: {
    documents?: Array<Record<string, unknown>>;
    items?: Array<Record<string, unknown>>;
    count?: number;
  };
  items?: Array<Record<string, unknown>>;
  count?: number;
  error?: string;
}

export const frappeDocumentList: RegisteredToolEntry = {
  name: "frappeDocumentList",
  declaration: {
    displayName: "List Documents",
    description:
      "List Neoffice documents with filters + selected fields. One call replaces count+list+get chains — pass the fields you actually need.",
    parametersSchema: {
      type: "object",
      properties: {
        doctype: {
          type: "string",
          description: "DocType name, e.g. 'Customer', 'Sales Invoice'.",
        },
        filters: {
          type: "object",
          description:
            "Key-value filters. Supports Frappe operators as arrays, e.g. {\"status\": [\"!=\", \"Paid\"]}.",
          additionalProperties: true,
        },
        fields: {
          type: "array",
          description:
            "Fields to return. Default: ['name']. For summary reads, pass the columns you need.",
          items: { type: "string" },
        },
        limit: {
          type: "integer",
          description:
            "Max rows. Default 20, hard cap 50 to fit the LLM context. " +
            "For larger result sets use frappeDocumentCount or frappeSqlQuery " +
            "with COUNT/SUM/GROUP BY aggregates.",
          minimum: 1,
          maximum: MAX_LIMIT,
        },
        order_by: {
          type: "string",
          description: "SQL-like, e.g. 'creation desc'.",
        },
      },
      required: ["doctype"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const effectiveLimit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const body: Record<string, unknown> = {
      doctype: input.doctype,
      limit: effectiveLimit,
    };
    if (input.filters) body.filters = JSON.stringify(input.filters);
    if (input.fields) body.fields = JSON.stringify(input.fields);
    if (input.order_by) body.order_by = input.order_by;

    const res = await frappeFetch<FrappeListResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.list_documents",
      body,
    );

    let parsed: FrappeListResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as FrappeListResponse;
      } catch {
        return { error: `Could not parse list_documents response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "List failed" };
    const items =
      parsed.data?.documents ?? parsed.data?.items ?? parsed.items ?? [];
    const totalCount =
      (parsed.data as { total_count?: number } | undefined)?.total_count ??
      items.length;

    let content = `${items.length} ${input.doctype}(s) retournés.`;
    if (totalCount > items.length) {
      content +=
        ` (${totalCount} au total, limit=${effectiveLimit} appliquée — ` +
        `utilise frappeDocumentCount ou frappeSqlQuery pour des aggregates).`;
    }

    return {
      content,
      data: { items, count: items.length, total_count: totalCount },
    };
  },
};
