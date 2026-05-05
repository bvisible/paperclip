import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  query: z.string().min(1),
  doctypes: z.array(z.string()).optional(),
});

interface FrappeSearchResult {
  doctype: string;
  name?: string;
  value?: string;
  label?: string;
  description?: string;
  score?: number;
}

interface FrappeSearchResponse {
  success?: boolean;
  // Frappe endpoint shape: {"success": true, "data": {"results": [...]}}.
  // Legacy flat shape kept for backward compat.
  data?: { results?: FrappeSearchResult[] };
  results?: FrappeSearchResult[];
  error?: string;
}

export const frappeSearchGlobal: RegisteredToolEntry = {
  name: "frappeSearchGlobal",
  declaration: {
    displayName: "Global Search",
    description:
      "Full-text search across Neoffice documents. Use when the user refers to something by name without knowing the exact DocType.",
    parametersSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search query." },
        doctypes: {
          type: "array",
          description: "Restrict search to these DocTypes. Default: all indexed ones.",
          items: { type: "string" },
        },
      },
      required: ["query"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const body: Record<string, unknown> = { query: input.query };
    if (input.doctypes) body.doctypes = JSON.stringify(input.doctypes);

    const res = await frappeFetch<FrappeSearchResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.search_documents",
      body,
    );

    let parsed: FrappeSearchResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as FrappeSearchResponse;
      } catch {
        return { error: `Could not parse search_documents response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "Search failed" };
    const results = parsed.data?.results ?? parsed.results ?? [];
    return {
      content: `${results.length} résultat(s) pour '${input.query}'.`,
      data: { results },
    };
  },
};
