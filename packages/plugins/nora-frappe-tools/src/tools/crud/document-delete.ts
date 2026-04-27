import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  doctype: z.string().min(1),
  name: z.string().min(1),
});

export const frappeDocumentDelete: RegisteredToolEntry = {
  name: "frappeDocumentDelete",
  declaration: {
    displayName: "Delete Document",
    description:
      "Permanently delete a Neoffice document. ONLY for drafts (docstatus=0) — submitted docs " +
      "must be cancelled first via frappeDocumentCancel. IRREVERSIBLE — always require user " +
      "approval via noraWorkItemRequestApproval before calling.",
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

    const res = await frappeFetch<Record<string, unknown> | string>(
      config,
      "nora.api.frappe_tools_whitelist.delete_document",
      { doctype: input.doctype, name: input.name },
    );

    let parsed: Record<string, unknown>;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as Record<string, unknown>;
      } catch {
        return { error: `Could not parse delete_document response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) {
      return { error: (parsed.error as string) || "Delete failed" };
    }
    return {
      content: `${input.doctype} ${input.name} supprimé définitivement.`,
      data: parsed,
    };
  },
};
