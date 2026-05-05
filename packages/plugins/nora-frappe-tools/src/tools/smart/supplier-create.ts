import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";
import { frappeResultOrError } from "../types.js";

const InputSchema = z.object({
  supplier_name: z.string().min(1),
  supplier_group: z.string().optional(),
  supplier_type: z.enum(["Company", "Individual", "Partnership"]).optional(),
  tax_id: z.string().optional(),
  country: z.string().optional(),
});

interface FrappeResponse {
  success: boolean;
  name?: string;
  supplier_name?: string;
  supplier_group?: string;
  already_exists?: boolean;
  error?: string;
}

export const frappeSupplierCreate: RegisteredToolEntry = {
  name: "frappeSupplierCreate",
  declaration: {
    displayName: "Create Supplier",
    description:
      "Create a Neoffice Supplier with smart defaults. Idempotent on supplier_name.",
    parametersSchema: {
      type: "object",
      properties: {
        supplier_name: {
          type: "string",
          description: "Supplier display name.",
        },
        supplier_group: {
          type: "string",
          description: "Defaults to 'All Supplier Groups'.",
        },
        supplier_type: {
          type: "string",
          enum: ["Company", "Individual", "Partnership"],
          description: "Legal form. Defaults to 'Company'.",
        },
        tax_id: { type: "string" },
        country: { type: "string" },
      },
      required: ["supplier_name"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);
    const res = await frappeFetch<FrappeResponse>(
      config,
      "nora.api.frappe_tools_whitelist.frappe_supplier_create",
      input as unknown as Record<string, unknown>,
    );
    return frappeResultOrError(res, (d) =>
      d.already_exists
        ? `Fournisseur ${d.name} existe déjà (${d.supplier_name}).`
        : `Fournisseur ${d.name} créé (${d.supplier_name}).`,
    );
  },
};
