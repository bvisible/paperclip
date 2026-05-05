import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const ReferenceSchema = z.object({
  reference_doctype: z.string().min(1),
  reference_name: z.string().min(1),
  allocated_amount: z.number().optional(),
});

const InputSchema = z.object({
  party_type: z.enum(["Customer", "Supplier"]),
  party: z.string().min(1),
  paid_amount: z.number().positive(),
  posting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  paid_from: z.string().optional(),
  paid_to: z.string().optional(),
  mode_of_payment: z.string().optional(),
  references: z.array(ReferenceSchema).optional(),
  company: z.string().optional(),
});

interface PaymentEntryResponse {
  success: boolean;
  name?: string;
  party?: string;
  paid_amount?: number;
  payment_type?: string;
  status?: string;
  error?: string;
}

export const frappePaymentEntryCreate: RegisteredToolEntry = {
  name: "frappePaymentEntryCreate",
  declaration: {
    displayName: "Create Payment Entry",
    description:
      "Create a draft Payment Entry (Receive from Customer or Pay to Supplier). " +
      "Smart defaults for paid_from/paid_to accounts and company. Optionally link to " +
      "one or more invoices via references[]. ALWAYS use noraWorkItemRequestApproval " +
      "first — moving money requires user confirmation regardless of amount.",
    parametersSchema: {
      type: "object",
      properties: {
        party_type: { type: "string", enum: ["Customer", "Supplier"] },
        party: { type: "string", description: "Party name (Customer or Supplier doc name)." },
        paid_amount: { type: "number", description: "Amount in company currency." },
        posting_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Default: today." },
        paid_from: { type: "string", description: "Account code (debit). Auto-resolved if omitted." },
        paid_to: { type: "string", description: "Account code (credit). Auto-resolved if omitted." },
        mode_of_payment: { type: "string", description: "e.g. 'Bank Transfer', 'Cash', 'TWINT'." },
        references: {
          type: "array",
          items: {
            type: "object",
            required: ["reference_doctype", "reference_name"],
            properties: {
              reference_doctype: { type: "string" },
              reference_name: { type: "string" },
              allocated_amount: { type: "number" },
            },
          },
          description: "Optional list of invoices/orders this payment settles.",
        },
        company: { type: "string" },
      },
      required: ["party_type", "party", "paid_amount"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const res = await frappeFetch<PaymentEntryResponse>(
      config,
      "nora.api.frappe_tools_whitelist.frappe_payment_entry_create",
      input as unknown as Record<string, unknown>,
    );

    if (!res.success) {
      return { error: res.error || "Payment Entry creation failed" };
    }
    return {
      content: `Payment Entry ${res.name} créé (${res.payment_type} ${res.paid_amount} → ${res.party}, statut ${res.status}).`,
      data: res,
    };
  },
};
