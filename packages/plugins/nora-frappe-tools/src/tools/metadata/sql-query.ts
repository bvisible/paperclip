import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  query: z.string().min(1),
});

interface FrappeSqlResponse {
  success?: boolean;
  rows?: Array<Record<string, unknown>>;
  columns?: string[];
  error?: string;
}

export const frappeSqlQuery: RegisteredToolEntry = {
  name: "frappeSqlQuery",
  declaration: {
    displayName: "Run SQL Query",
    description:
      "Execute a read-only SQL query against the Neoffice database. Prefer SUM/COUNT/GROUP BY aggregates over Python-side looping.",
    parametersSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "SELECT-only SQL query. Reads from the Neoffice DB. Aggregates (SUM, COUNT, GROUP BY) are supported and encouraged over client-side loops.",
        },
      },
      required: ["query"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const res = await frappeFetch<FrappeSqlResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.run_database_query",
      { query: input.query },
    );

    let parsed: FrappeSqlResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as FrappeSqlResponse;
      } catch {
        return { error: `Could not parse run_database_query response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "SQL failed" };
    const rows = parsed.rows ?? [];
    return {
      content: `${rows.length} ligne(s) retournées.`,
      data: { rows, columns: parsed.columns },
    };
  },
};
