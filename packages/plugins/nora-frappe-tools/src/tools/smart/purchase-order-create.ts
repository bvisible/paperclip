import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const ItemSchema = z.object({
  item_code: z.string().min(1),
  qty: z.number().positive(),
  rate: z.number().optional(),
});

const InputSchema = z.object({
  supplier: z.string().min(1),
  items: z.array(ItemSchema).min(1),
  required_by: z.string().optional(),
  company: z.string().optional(),
});

interface POResponse {
  success?: boolean;
  data?: {
    name?: string;
    supplier?: string;
    grand_total?: number;
  };
  name?: string;
  error?: string;
}

export const frappePurchaseOrderCreate: RegisteredToolEntry = {
  name: "frappePurchaseOrderCreate",
  declaration: {
    displayName: "Create Purchase Order",
    description:
      "Create a Purchase Order with smart supplier + item resolution. " +
      "Use for procurement requests. After delivery, transform into " +
      "Purchase Receipt or Purchase Invoice via frappeTransformDocument.",
    parametersSchema: {
      type: "object",
      properties: {
        supplier: { type: "string", description: "Supplier name (partial match accepted)." },
        items: {
          type: "array",
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
        required_by: { type: "string", description: "ISO date for required-by." },
        company: { type: "string", description: "Override the user's default company." },
      },
      required: ["supplier", "items"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const body: Record<string, unknown> = {
      supplier: input.supplier,
      items: input.items,
    };
    if (input.required_by) body.required_by = input.required_by;
    if (input.company) body.company = input.company;

    const res = await frappeFetch<POResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.frappe_purchase_order_create",
      body,
    );

    let parsed: POResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as POResponse;
      } catch {
        return { error: `Could not parse frappe_purchase_order_create response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "PO creation failed" };

    const data = parsed.data ?? parsed;
    const name = (data as { name?: string }).name;
    const total = (data as { grand_total?: number }).grand_total ?? 0;

    return {
      content: `Commande achat ${name ?? "?"} créée pour ${input.supplier} — ${total.toFixed(2)} CHF.`,
      data,
    };
  },
};
