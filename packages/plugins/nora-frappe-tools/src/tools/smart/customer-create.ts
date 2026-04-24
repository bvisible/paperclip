import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";
import { frappeResultOrError } from "../types.js";

const InputSchema = z.object({
  customer_name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  customer_group: z.string().optional(),
  territory: z.string().optional(),
  customer_type: z.enum(["Company", "Individual", "Partnership"]).optional(),
  tax_id: z.string().optional(),
  address_line1: z.string().optional(),
  city: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().optional(),
});

interface FrappeResponse {
  success: boolean;
  name?: string;
  customer_name?: string;
  customer_group?: string;
  territory?: string;
  already_exists?: boolean;
  error?: string;
}

export const frappeCustomerCreate: RegisteredToolEntry = {
  name: "frappeCustomerCreate",
  declaration: {
    displayName: "Create Customer",
    description:
      "Create a Neoffice Customer with smart defaults. Idempotent: returns the existing customer if customer_name already exists. Attaches Contact (email/phone) and Address (line1/city) when provided.",
    parametersSchema: {
      type: "object",
      properties: {
        customer_name: {
          type: "string",
          description: "Display name of the customer (e.g. 'Daniel Moret' or 'Acme SA').",
        },
        email: {
          type: "string",
          format: "email",
          description: "Primary email. A Contact is created and linked.",
        },
        phone: { type: "string", description: "Primary phone number." },
        customer_group: {
          type: "string",
          description: "Customer Group name. Defaults to 'All Customer Groups'.",
        },
        territory: {
          type: "string",
          description: "Territory name. Defaults to 'All Territories'.",
        },
        customer_type: {
          type: "string",
          enum: ["Company", "Individual", "Partnership"],
          description: "Legal form. Defaults to 'Company'.",
        },
        tax_id: { type: "string", description: "VAT / tax identification number." },
        address_line1: {
          type: "string",
          description: "Street address; triggers Address creation when set.",
        },
        city: { type: "string" },
        postal_code: { type: "string" },
        country: {
          type: "string",
          description: "Country name. Defaults to Swiss Global Defaults.",
        },
      },
      required: ["customer_name"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);
    const res = await frappeFetch<FrappeResponse>(
      config,
      "nora.api.frappe_tools_whitelist.frappe_customer_create",
      input as unknown as Record<string, unknown>,
    );
    return frappeResultOrError(res, (d) =>
      d.already_exists
        ? `Client ${d.name} existe déjà (${d.customer_name}).`
        : `Client ${d.name} créé (${d.customer_name}).`,
    );
  },
};
