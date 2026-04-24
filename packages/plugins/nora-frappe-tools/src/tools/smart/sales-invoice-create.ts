import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";
import { frappeResultOrError } from "../types.js";

const InvoiceItemSchema = z.object({
  item_code: z.string().min(1),
  qty: z.number().positive().default(1),
  rate: z.number().nonnegative().optional(),
  description: z.string().optional(),
});

const InputSchema = z.object({
  customer: z.string().min(1),
  items: z.array(InvoiceItemSchema).min(1),
  posting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  company: z.string().optional(),
  remarks: z.string().optional(),
  is_return: z.boolean().optional(),
});

interface FrappeResponse {
  success: boolean;
  name?: string;
  grand_total?: number;
  net_total?: number;
  customer?: string;
  error?: string;
}

export const frappeSalesInvoiceCreate: RegisteredToolEntry = {
  name: "frappeSalesInvoiceCreate",
  declaration: {
    displayName: "Create Sales Invoice",
    description:
      "Create a Draft Sales Invoice in Neoffice. Smart defaults for company, currency, tax template, item prices. Customer and items resolved by partial match.",
    parametersSchema: {
      type: "object",
      properties: {
        customer: {
          type: "string",
          description: "Customer name or partial match. The smart op resolves it.",
        },
        items: {
          type: "array",
          description: "At least one invoice line.",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              item_code: {
                type: "string",
                description: "Item code or partial name — resolved by Frappe.",
              },
              qty: { type: "number", description: "Quantity. Default 1.", default: 1 },
              rate: {
                type: "number",
                description: "Unit price. If omitted, Frappe uses the item's price list rate.",
              },
              description: {
                type: "string",
                description: "Override for the line description.",
              },
            },
            required: ["item_code"],
          },
        },
        posting_date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "YYYY-MM-DD. Defaults to today.",
        },
        due_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        company: { type: "string", description: "Defaults to the user's company." },
        remarks: { type: "string" },
        is_return: { type: "boolean", description: "Set to true for a credit note." },
      },
      required: ["customer", "items"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);
    const res = await frappeFetch<FrappeResponse>(
      config,
      "nora.api.frappe_tools_whitelist.frappe_sales_invoice_create",
      input as unknown as Record<string, unknown>,
    );
    return frappeResultOrError(
      res,
      (d) =>
        `Facture ${d.name} créée pour ${d.customer ?? input.customer} — ${
          d.grand_total ?? "?"
        } (net ${d.net_total ?? "?"}), statut Draft.`,
    );
  },
};
