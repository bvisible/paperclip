import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const MatchSchema = z.object({
  document_type: z.string().min(1),
  document_name: z.string().min(1),
  allocated_amount: z.number().positive(),
});

const InputSchema = z.object({
  bank_transaction: z.string().min(1),
  matches: z.array(MatchSchema).min(1),
});

interface BankReconResponse {
  success: boolean;
  bank_transaction?: string;
  unallocated_amount?: number;
  matches_added?: number;
  error?: string;
}

export const frappeBankReconciliation: RegisteredToolEntry = {
  name: "frappeBankReconciliation",
  declaration: {
    displayName: "Bank Reconciliation",
    description:
      "Match a Bank Transaction with one or more documents (Sales Invoice, Purchase Invoice, " +
      "Payment Entry, Journal Entry). Returns the updated unallocated_amount. " +
      "Use after bank statement import — call frappeDocumentList on Bank Transaction to find " +
      "transactions to reconcile, then this tool to match.",
    parametersSchema: {
      type: "object",
      properties: {
        bank_transaction: { type: "string", description: "Bank Transaction docname (primary key)." },
        matches: {
          type: "array",
          items: {
            type: "object",
            required: ["document_type", "document_name", "allocated_amount"],
            properties: {
              document_type: { type: "string", description: "e.g. 'Sales Invoice', 'Payment Entry'." },
              document_name: { type: "string", description: "Docname of the matched document." },
              allocated_amount: { type: "number", description: "Amount to allocate to this match." },
            },
          },
          description: "List of (document, amount) pairs to allocate.",
        },
      },
      required: ["bank_transaction", "matches"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const res = await frappeFetch<BankReconResponse>(
      config,
      "nora.api.frappe_tools_whitelist.frappe_bank_reconciliation",
      input as unknown as Record<string, unknown>,
    );

    if (!res.success) {
      return { error: res.error || "Bank reconciliation failed" };
    }
    return {
      content:
        `Bank Transaction ${res.bank_transaction} : ${res.matches_added} match(es) ajouté(s), ` +
        `solde non-alloué = ${res.unallocated_amount} CHF.`,
      data: res,
    };
  },
};
