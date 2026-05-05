import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  doctype: z.string().min(1),
  name: z.string().min(1),
  fields: z.record(z.unknown()),
});

export const frappeDocumentUpdate: RegisteredToolEntry = {
  name: "frappeDocumentUpdate",
  declaration: {
    displayName: "Update Document",
    description:
      "Update fields on an existing Neoffice document. Pass only the fields you want to change. " +
      "Permissions enforced server-side. For child tables, prefer frappeTransformDocument or fetch + recreate.",
    parametersSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "Doctype name (e.g. 'Customer', 'Sales Invoice')." },
        name: { type: "string", description: "Docname (primary key)." },
        fields: {
          type: "object",
          description: "Object with field name → new value. Only changed fields.",
          additionalProperties: true,
        },
      },
      required: ["doctype", "name", "fields"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const res = await frappeFetch<Record<string, unknown> | string>(
      config,
      "nora.api.frappe_tools_whitelist.update_document",
      {
        doctype: input.doctype,
        name: input.name,
        data: JSON.stringify(input.fields),
      },
    );

    let parsed: Record<string, unknown>;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as Record<string, unknown>;
      } catch {
        return { error: `Could not parse update_document response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) {
      return { error: (parsed.error as string) || "Update failed" };
    }
    const changedFields = Object.keys(input.fields).join(", ");
    return {
      content: `${input.doctype} ${input.name} mis à jour (${changedFields}).`,
      data: parsed,
    };
  },
};
