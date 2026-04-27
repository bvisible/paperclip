import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  period_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  company: z.string().optional(),
});

interface TaxFilingRow {
  rate_pct: number;
  revenue_ht: number;
  tax: number;
  invoice_count: number;
}

interface TaxFilingResponse {
  success: boolean;
  period_from?: string;
  period_to?: string;
  company?: string;
  totals_by_rate?: TaxFilingRow[];
  total_revenue_ht?: number;
  total_tax?: number;
  invoice_count?: number;
  error?: string;
}

export const noraTaxFiling: RegisteredToolEntry = {
  name: "noraTaxFiling",
  declaration: {
    displayName: "Tax Filing Summary",
    description:
      "Aggregate Sales Invoice tax for a period (Swiss MWST/TVA quarterly summary). " +
      "Returns revenue HT and tax amount per VAT rate (0%, 2.6%, 3.8%, 8.1%, etc.). " +
      "Use to prepare quarterly TVA déclaration: pass period_from/period_to as the quarter " +
      "boundaries. Read-only, safe to call without approval.",
    parametersSchema: {
      type: "object",
      properties: {
        period_from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Quarter start." },
        period_to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Quarter end." },
        company: { type: "string", description: "Default: user's company." },
      },
      required: ["period_from", "period_to"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const res = await frappeFetch<TaxFilingResponse>(
      config,
      "nora.api.frappe_tools_whitelist.nora_tax_filing",
      input as unknown as Record<string, unknown>,
    );

    if (!res.success) {
      return { error: res.error || "Tax filing aggregation failed" };
    }
    const totals = res.totals_by_rate || [];
    const summary = totals
      .map((r) => `  - ${r.rate_pct}% : HT ${r.revenue_ht.toFixed(2)} → TVA ${r.tax.toFixed(2)} (${r.invoice_count} factures)`)
      .join("\n");
    return {
      content:
        `TVA ${input.period_from} → ${input.period_to} :\n` +
        summary +
        `\n  TOTAL : HT ${res.total_revenue_ht?.toFixed(2)} CHF, TVA ${res.total_tax?.toFixed(2)} CHF, ${res.invoice_count} factures.`,
      data: res,
    };
  },
};
