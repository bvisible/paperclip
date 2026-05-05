import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const PERIODS = [
  "today",
  "this_week",
  "this_month",
  "this_quarter",
  "this_year",
  "last_month",
  "last_quarter",
  "last_year",
] as const;

const InputSchema = z.object({
  period: z.enum(PERIODS).optional(),
  customer: z.string().optional(),
});

interface TopCustomer {
  customer: string;
  total: number;
  count: number;
}

interface RevenueSummaryResponse {
  success?: boolean;
  data?: {
    period?: string;
    start_date?: string;
    end_date?: string;
    total_revenue?: number;
    invoice_count?: number;
    avg_invoice?: number;
    min_invoice?: number;
    max_invoice?: number;
    top_customers?: TopCustomer[];
  };
  // Flat fallback (older endpoint shapes)
  period?: string;
  total_revenue?: number;
  top_customers?: TopCustomer[];
  error?: string;
}

export const frappeRevenueSummary: RegisteredToolEntry = {
  name: "frappeRevenueSummary",
  declaration: {
    displayName: "Revenue Summary",
    description:
      "Aggregated revenue + top 5 customers for a period. Use this when " +
      "the user asks 'best customer', 'revenue this month', 'top sellers' " +
      "etc. — avoids composing SQL aggregates from scratch.",
    parametersSchema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          description:
            "Time window. Default 'this_month'. Accepts: today, this_week, " +
            "this_month, this_quarter, this_year, last_month, last_quarter, " +
            "last_year.",
          enum: [...PERIODS],
        },
        customer: {
          type: "string",
          description: "Optional: filter to a single customer name.",
        },
      },
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const body: Record<string, unknown> = {};
    if (input.period) body.period = input.period;
    if (input.customer) body.customer = input.customer;

    const res = await frappeFetch<RevenueSummaryResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.frappe_revenue_summary",
      body,
    );

    let parsed: RevenueSummaryResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as RevenueSummaryResponse;
      } catch {
        return { error: `Could not parse frappe_revenue_summary response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "Revenue summary failed" };

    const data = parsed.data ?? parsed;
    const period = (data as { period?: string }).period ?? input.period ?? "this_month";
    const total = (data as { total_revenue?: number }).total_revenue ?? 0;
    const count = (data as { invoice_count?: number }).invoice_count ?? 0;
    const top = (data as { top_customers?: TopCustomer[] }).top_customers ?? [];

    const topLine = top.length
      ? "Top: " + top
          .slice(0, 5)
          .map((c) => `${c.customer} (${c.total.toFixed(0)} CHF)`)
          .join(", ")
      : "Aucun client sur la période.";

    return {
      content:
        `Période ${period}: ${total.toFixed(2)} CHF de chiffre d'affaires ` +
        `sur ${count} facture(s). ${topLine}`,
      data,
    };
  },
};
