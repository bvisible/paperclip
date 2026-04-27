import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  doctype: z.string().min(1),
  name: z.string().min(1),
});

export const frappeDocumentCancel: RegisteredToolEntry = {
  name: "frappeDocumentCancel",
  declaration: {
    displayName: "Cancel Document",
    description:
      "Cancel a submitted document (Sales Invoice, Purchase Order, Journal Entry, etc.) " +
      "to move it from docstatus=1 (Submitted) to docstatus=2 (Cancelled). " +
      "Irreversible — typically used to amend or void a finalized doc. Use frappeWorkItemRequestApproval first.",
    parametersSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "Doctype name." },
        name: { type: "string", description: "Docname (primary key)." },
      },
      required: ["doctype", "name"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    // frappe.client.cancel is the native Frappe endpoint — no NORA whitelist wrapper needed.
    const res = await frappeFetch<Record<string, unknown> | string>(
      config,
      "frappe.client.cancel",
      { doctype: input.doctype, name: input.name },
    );

    let parsed: Record<string, unknown>;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as Record<string, unknown>;
      } catch {
        // frappe.client.cancel may return empty body on success — that's OK.
        return {
          content: `${input.doctype} ${input.name} annulé (docstatus=2).`,
          data: { doctype: input.doctype, name: input.name, status: "cancelled" },
        };
      }
    } else {
      parsed = res ?? {};
    }

    return {
      content: `${input.doctype} ${input.name} annulé (docstatus=2).`,
      data: parsed,
    };
  },
};
