import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  name: z.string().min(1),
});

interface AccountSuggestion {
  item_description?: string;
  suggested_account?: string;
  suggested_cost_center?: string;
  suggested_project?: string;
  vat_rate?: number;
  confidence_score?: number;
  reasoning?: string;
}

interface DocumentScanResponse {
  success?: boolean;
  name?: string;
  generated_document_name?: string;
  document_type?: string;
  supplier_name?: string;
  date?: string | null;
  due_date?: string | null;
  document_reference_number?: string;
  total_amount?: number;
  currency?: string;
  vat_present?: boolean;
  vat_details?: Array<{ vat_rate: number; vat_amount: number }>;
  items?: Array<{ description: string; quantity: number; unit_price: number; total_price: number }>;
  qr_code?: Record<string, unknown>;
  supplier_matched?: number;
  zefix_uid?: string;
  suggestion_status?: string;
  suggestions_count?: number;
  suggestions?: AccountSuggestion[];
  error?: string;
}

export const noraDocumentScanGet: RegisteredToolEntry = {
  name: "noraDocumentScanGet",
  declaration: {
    displayName: "Get Document Scan",
    description:
      "Fetch a Document Scan (created by noraOcrProcess or upload UI) with its accounting " +
      "suggestions. Use to retrieve the enriched scan data + populated suggestions " +
      "(account, VAT rate, cost center) once the async accounting job has run. " +
      "Check `suggestion_status` field: 'Pending' = still processing, 'Complete' = ready, " +
      "'Failed' = error. If still Pending, call again after a few seconds.",
    parametersSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Document Scan docname (e.g. 'DSC-2026-XXX')." },
      },
      required: ["name"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const res = await frappeFetch<DocumentScanResponse>(
      config,
      "nora.api.ocr.get_document_scan_with_suggestions",
      { name: input.name },
    );

    if (res.success === false) {
      return { error: res.error || "Document Scan fetch failed" };
    }
    const sugCount = res.suggestions_count ?? 0;
    const status = res.suggestion_status ?? "—";
    return {
      content:
        `Document Scan ${res.name} (${res.document_type ?? "?"}) — ${res.supplier_name ?? "?"}, ` +
        `${res.total_amount ?? "?"} ${res.currency ?? ""}, ${(res.items?.length ?? 0)} ligne(s). ` +
        `Suggestions: ${sugCount} (status: ${status}).`,
      data: res,
    };
  },
};
