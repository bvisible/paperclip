import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  doctype: z.string().min(1),
  fieldname: z.string().optional(),
});

interface FieldInfoResponse {
  success?: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export const frappeFieldInfo: RegisteredToolEntry = {
  name: "frappeFieldInfo",
  declaration: {
    displayName: "DocType Field Info",
    description:
      "Get the field schema for a DocType (all fields, or a specific one). " +
      "Use to discover field names + types before constructing filters or " +
      "writes — avoids guessing fieldnames.",
    parametersSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "DocType name." },
        fieldname: {
          type: "string",
          description: "Optional: limit to one field (returns full fielddef).",
        },
      },
      required: ["doctype"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const body: Record<string, unknown> = { doctype: input.doctype };
    if (input.fieldname) body.fieldname = input.fieldname;

    const res = await frappeFetch<FieldInfoResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.get_field_info",
      body,
    );

    let parsed: FieldInfoResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as FieldInfoResponse;
      } catch {
        return { error: `Could not parse get_field_info response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "Field info failed" };

    const data = parsed.data ?? parsed;
    return {
      content: input.fieldname
        ? `Champ ${input.fieldname} de ${input.doctype} récupéré.`
        : `Champs de ${input.doctype} récupérés.`,
      data,
    };
  },
};
