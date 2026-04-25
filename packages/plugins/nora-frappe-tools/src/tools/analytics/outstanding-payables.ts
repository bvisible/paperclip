import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  supplier: z.string().optional(),
});

interface APResponse {
  success?: boolean;
  data?: {
    total_outstanding?: number;
    invoice_count?: number;
    by_supplier?: Array<{ supplier: string; outstanding: number; count: number }>;
    aging_buckets?: { "0-30"?: number; "30-60"?: number; "60-90"?: number; "90+"?: number };
  };
  total_outstanding?: number;
  error?: string;
}

export const frappeOutstandingPayables: RegisteredToolEntry = {
  name: "frappeOutstandingPayables",
  declaration: {
    displayName: "Outstanding Payables (AP)",
    description:
      "Aged accounts payable: total to pay, per-supplier breakdown, " +
      "and 0-30 / 30-60 / 60-90 / 90+ aging buckets. Use for cash planning, " +
      "vendor payment runs, month-end closing.",
    parametersSchema: {
      type: "object",
      properties: {
        supplier: {
          type: "string",
          description: "Optional: scope to a single supplier name.",
        },
      },
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const body: Record<string, unknown> = {};
    if (input.supplier) body.supplier = input.supplier;

    const res = await frappeFetch<APResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.frappe_outstanding_payables",
      body,
    );

    let parsed: APResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as APResponse;
      } catch {
        return { error: `Could not parse frappe_outstanding_payables response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "Payables failed" };

    const data = parsed.data ?? parsed;
    const total = (data as { total_outstanding?: number }).total_outstanding ?? 0;
    const count = (data as { invoice_count?: number }).invoice_count ?? 0;
    const buckets = (data as { aging_buckets?: Record<string, number> }).aging_buckets ?? {};
    const bucketStr = Object.entries(buckets)
      .map(([k, v]) => `${k}: ${(v as number).toFixed(0)} CHF`)
      .join(", ");

    return {
      content:
        `Encours fournisseurs: ${total.toFixed(2)} CHF sur ${count} facture(s). ` +
        (bucketStr ? `Aging: ${bucketStr}.` : ""),
      data,
    };
  },
};
