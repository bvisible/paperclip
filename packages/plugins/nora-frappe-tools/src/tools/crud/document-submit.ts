import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  doctype: z.string().min(1),
  name: z.string().min(1),
});

export const frappeDocumentSubmit: RegisteredToolEntry = {
  name: "frappeDocumentSubmit",
  declaration: {
    displayName: "Submit Document",
    description:
      "Submit a draft document (Sales Invoice, Purchase Order, Journal Entry, etc.) " +
      "to move it from docstatus=0 (Draft) to docstatus=1 (Submitted). " +
      "Locks the document — no further field edits without cancel+amend.",
    parametersSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "Doctype name (e.g. 'Sales Invoice')." },
        name: { type: "string", description: "Docname (primary key)." },
      },
      required: ["doctype", "name"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const res = await frappeFetch<Record<string, unknown> | string>(
      config,
      "nora.api.frappe_tools_whitelist.submit_document",
      { doctype: input.doctype, name: input.name },
    );

    let parsed: Record<string, unknown>;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as Record<string, unknown>;
      } catch {
        return { error: `Could not parse submit_document response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) {
      return { error: (parsed.error as string) || "Submit failed" };
    }
    return {
      content: `${input.doctype} ${input.name} soumis (docstatus=1).`,
      data: parsed,
    };
  },
};
