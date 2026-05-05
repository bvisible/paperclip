import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const ItemSchema = z.object({
  item_code: z.string().min(1),
  qty: z.number().positive(),
  rate: z.number().optional(),
});

const InputSchema = z.object({
  customer: z.string().min(1),
  items: z.array(ItemSchema).min(1),
  valid_till: z.string().optional(),
  company: z.string().optional(),
});

interface QuotationResponse {
  success?: boolean;
  data?: {
    name?: string;
    customer?: string;
    grand_total?: number;
    valid_till?: string;
  };
  name?: string;
  error?: string;
}

export const frappeQuotationCreate: RegisteredToolEntry = {
  name: "frappeQuotationCreate",
  declaration: {
    displayName: "Create Quotation",
    description:
      "Create a sales Quotation (devis) with smart customer + item resolution. " +
      "Use when the user says 'fais un devis pour X' before they commit. " +
      "Once accepted, transform into Sales Order or Sales Invoice via " +
      "frappeTransformDocument.",
    parametersSchema: {
      type: "object",
      properties: {
        customer: { type: "string", description: "Customer name (partial match accepted)." },
        items: {
          type: "array",
          description: "Line items.",
          items: {
            type: "object",
            properties: {
              item_code: { type: "string" },
              qty: { type: "number" },
              rate: { type: "number" },
            },
            required: ["item_code", "qty"],
          },
        },
        valid_till: {
          type: "string",
          description: "ISO date for quotation validity. Default = +30 days.",
        },
        company: { type: "string", description: "Override the user's default company." },
      },
      required: ["customer", "items"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const body: Record<string, unknown> = {
      customer: input.customer,
      items: input.items,
    };
    if (input.valid_till) body.valid_till = input.valid_till;
    if (input.company) body.company = input.company;

    const res = await frappeFetch<QuotationResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.frappe_quotation_create",
      body,
    );

    let parsed: QuotationResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as QuotationResponse;
      } catch {
        return { error: `Could not parse frappe_quotation_create response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "Quotation creation failed" };

    const data = parsed.data ?? parsed;
    const name = (data as { name?: string }).name;
    const total = (data as { grand_total?: number }).grand_total ?? 0;

    return {
      content: `Devis ${name ?? "?"} créé pour ${input.customer} — ${total.toFixed(2)} CHF.`,
      data,
    };
  },
};
