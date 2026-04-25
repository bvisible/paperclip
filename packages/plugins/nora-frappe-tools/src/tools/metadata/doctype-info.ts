import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  doctype: z.string().min(1),
});

interface DoctypeInfoResponse {
  success?: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export const frappeDoctypeInfo: RegisteredToolEntry = {
  name: "frappeDoctypeInfo",
  declaration: {
    displayName: "DocType Metadata",
    description:
      "Inspect a Frappe DocType's structure: fields, naming, permissions, " +
      "child tables, links. Use when you need to know what fields exist on " +
      "a DocType before listing/filtering, or to discover related DocTypes.",
    parametersSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "DocType name (e.g. 'Sales Invoice')." },
      },
      required: ["doctype"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const res = await frappeFetch<DoctypeInfoResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.get_doctype_info",
      { doctype: input.doctype },
    );

    let parsed: DoctypeInfoResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as DoctypeInfoResponse;
      } catch {
        return { error: `Could not parse get_doctype_info response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "DocType info failed" };

    const data = parsed.data ?? parsed;
    return {
      content: `Métadonnées récupérées pour ${input.doctype}.`,
      data,
    };
  },
};
