import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  doctype: z.string().min(1),
  filters: z.record(z.unknown()).optional(),
});

interface FrappeCountResponse {
  success?: boolean;
  count?: number;
  error?: string;
}

export const frappeDocumentCount: RegisteredToolEntry = {
  name: "frappeDocumentCount",
  declaration: {
    displayName: "Count Documents",
    description:
      "Count Neoffice documents matching filters. Single call, returns an integer.",
    parametersSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "DocType name." },
        filters: {
          type: "object",
          description: "Key-value filters. Frappe operator syntax supported.",
          additionalProperties: true,
        },
      },
      required: ["doctype"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const body: Record<string, unknown> = { doctype: input.doctype };
    if (input.filters) body.filters = JSON.stringify(input.filters);

    const res = await frappeFetch<FrappeCountResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.count_documents",
      body,
    );

    let parsed: FrappeCountResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as FrappeCountResponse;
      } catch {
        return { error: `Could not parse count_documents response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "Count failed" };
    const count = parsed.count ?? 0;
    return {
      content: `${count} ${input.doctype}(s).`,
      data: { count },
    };
  },
};
