import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  doctype: z.string().min(1),
  name: z.string().min(1),
});

export const frappeDocumentGet: RegisteredToolEntry = {
  name: "frappeDocumentGet",
  declaration: {
    displayName: "Get Document",
    description:
      "Fetch a full Neoffice document by docname. Returns all fields incl. child tables.",
    parametersSchema: {
      type: "object",
      properties: {
        doctype: { type: "string" },
        name: { type: "string", description: "Docname (the primary key)." },
      },
      required: ["doctype", "name"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const res = await frappeFetch<Record<string, unknown> | string>(
      config,
      "nora.api.frappe_tools_whitelist.get_document",
      { doctype: input.doctype, name: input.name },
    );

    let parsed: Record<string, unknown>;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as Record<string, unknown>;
      } catch {
        return { error: `Could not parse get_document response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) {
      return { error: (parsed.error as string) || "Get failed" };
    }
    return {
      content: `${input.doctype} ${input.name} récupéré.`,
      data: parsed,
    };
  },
};
