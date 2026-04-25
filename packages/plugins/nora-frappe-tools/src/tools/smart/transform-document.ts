import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  source_doctype: z.string().min(1),
  source_name: z.string().optional(),
  target_doctype: z.string().optional(),
});

interface TransformResponse {
  success?: boolean;
  data?: {
    name?: string;
    available_targets?: string[];
    source_doctype?: string;
    source_name?: string;
    target_doctype?: string;
  };
  name?: string;
  available_targets?: string[];
  error?: string;
}

export const frappeTransformDocument: RegisteredToolEntry = {
  name: "frappeTransformDocument",
  declaration: {
    displayName: "Transform Document",
    description:
      "Transform a document into another via standard ERPNext mappers — " +
      "handles the full sales/buying chain (Quotation → SO → DN → SI, " +
      "PO → PR → PI, SI/PI → Payment Entry, etc.). Smart filters check " +
      "eligibility (e.g. won't transform an already-fully-billed order). " +
      "Two modes: pass only source_doctype to discover available targets; " +
      "pass source_doctype + source_name + target_doctype to execute.",
    parametersSchema: {
      type: "object",
      properties: {
        source_doctype: {
          type: "string",
          description:
            "Source DocType. e.g. 'Quotation', 'Sales Order', 'Sales Invoice'.",
        },
        source_name: {
          type: "string",
          description: "Name of the source document (required for execute mode).",
        },
        target_doctype: {
          type: "string",
          description:
            "Target DocType. Omit to discover available transforms for the source.",
        },
      },
      required: ["source_doctype"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const body: Record<string, unknown> = { source_doctype: input.source_doctype };
    if (input.source_name) body.source_name = input.source_name;
    if (input.target_doctype) body.target_doctype = input.target_doctype;

    const res = await frappeFetch<TransformResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.frappe_transform_document",
      body,
    );

    let parsed: TransformResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as TransformResponse;
      } catch {
        return { error: `Could not parse frappe_transform_document response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "Transform failed" };

    const data = parsed.data ?? parsed;
    // Discovery mode
    const targets = (data as { available_targets?: string[] }).available_targets;
    if (targets && !input.target_doctype) {
      return {
        content: `Cibles disponibles depuis ${input.source_doctype}: ${targets.join(", ")}.`,
        data,
      };
    }
    // Execute mode
    const newName = (data as { name?: string }).name;
    return {
      content:
        `${input.target_doctype ?? "Cible"} ${newName ?? "?"} créé(e) depuis ` +
        `${input.source_doctype} ${input.source_name}.`,
      data,
    };
  },
};
