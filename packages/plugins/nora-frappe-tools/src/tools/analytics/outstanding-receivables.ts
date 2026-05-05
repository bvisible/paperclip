import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  customer: z.string().optional(),
});

interface ARResponse {
  success?: boolean;
  data?: {
    total_outstanding?: number;
    invoice_count?: number;
    by_customer?: Array<{ customer: string; outstanding: number; count: number }>;
    aging_buckets?: { "0-30"?: number; "30-60"?: number; "60-90"?: number; "90+"?: number };
  };
  total_outstanding?: number;
  error?: string;
}

export const frappeOutstandingReceivables: RegisteredToolEntry = {
  name: "frappeOutstandingReceivables",
  declaration: {
    displayName: "Outstanding Receivables (AR)",
    description:
      "Aged accounts receivable: total outstanding, per-customer breakdown, " +
      "and 0-30 / 30-60 / 60-90 / 90+ aging buckets. Use for dunning runs, " +
      "month-end review, cash flow questions.",
    parametersSchema: {
      type: "object",
      properties: {
        customer: {
          type: "string",
          description: "Optional: scope to a single customer name.",
        },
      },
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const body: Record<string, unknown> = {};
    if (input.customer) body.customer = input.customer;

    const res = await frappeFetch<ARResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.frappe_outstanding_receivables",
      body,
    );

    let parsed: ARResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as ARResponse;
      } catch {
        return { error: `Could not parse frappe_outstanding_receivables response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "Receivables failed" };

    const data = parsed.data ?? parsed;
    const total = (data as { total_outstanding?: number }).total_outstanding ?? 0;
    const count = (data as { invoice_count?: number }).invoice_count ?? 0;
    const buckets = (data as { aging_buckets?: Record<string, number> }).aging_buckets ?? {};
    const bucketStr = Object.entries(buckets)
      .map(([k, v]) => `${k}: ${(v as number).toFixed(0)} CHF`)
      .join(", ");

    return {
      content:
        `Encours clients: ${total.toFixed(2)} CHF sur ${count} facture(s). ` +
        (bucketStr ? `Aging: ${bucketStr}.` : ""),
      data,
    };
  },
};
