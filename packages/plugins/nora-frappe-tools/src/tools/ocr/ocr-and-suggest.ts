import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  file_url: z.string().min(1),
  document_type: z.string().optional(),
  prompt: z.string().optional(),
  suggestion_timeout_s: z.number().int().positive().max(180).optional(),
  poll_interval_s: z.number().positive().optional(),
  validate_hallucination: z.boolean().optional(),
  use_hybrid: z.boolean().optional(),
});

interface AccountSuggestion {
  item_description?: string;
  suggested_account?: string;
  suggested_cost_center?: string;
  vat_rate?: number;
  confidence_score?: number;
  reasoning?: string;
}

interface OcrAndSuggestResponse {
  success: boolean;
  document_scan?: string;
  document_type?: string;
  extracted_data?: Record<string, unknown>;
  validation?: { is_valid?: boolean; warnings?: string[]; confidence_score?: number };
  pages_processed?: number;
  pages_skipped?: number;
  mode?: string;
  processing_time_s?: number;
  suggestion_status?: string;
  suggestions_count?: number;
  suggestions?: AccountSuggestion[];
  total_elapsed_s?: number;
  error?: string;
}

export const noraOcrAndSuggest: RegisteredToolEntry = {
  name: "noraOcrAndSuggest",
  declaration: {
    displayName: "OCR + Wait for Suggestions",
    description:
      "One-shot synchronous flow: trigger OCR on a file_url, then wait until accounting " +
      "suggestions are populated (or timeout). Returns the merged result: extracted_data " +
      "(invoice fields), validation (hallucination check), and suggestions (account/VAT/cost " +
      "center per line). Use this when the agent wants the FULL picture in one tool call. " +
      "Slower than noraOcrProcess (waits for async job, default 60s timeout) — for " +
      "fire-and-forget, prefer noraOcrProcess + noraDocumentScanGet later.",
    parametersSchema: {
      type: "object",
      properties: {
        file_url: { type: "string", description: "URL of the uploaded file (e.g. '/private/files/invoice.pdf')." },
        document_type: { type: "string", description: "e.g. 'invoice', 'receipt'. Influences the prompt." },
        prompt: { type: "string", description: "Optional custom prompt." },
        suggestion_timeout_s: { type: "number", description: "Max seconds to wait for accounting suggestions (default 60, max 180)." },
        poll_interval_s: { type: "number", description: "Polling interval in seconds (default 2)." },
        validate_hallucination: { type: "boolean", description: "Default true. Run anti-hallucination checks." },
        use_hybrid: { type: "boolean", description: "Force hybrid mode for native PDFs." },
      },
      required: ["file_url"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    // Bump the HTTP timeout to suggestion_timeout_s + 30s safety margin.
    const safetyMargin = 30_000;
    const httpTimeout = ((input.suggestion_timeout_s ?? 60) * 1000) + safetyMargin;
    const cfgWithTimeout = { ...config, timeoutMs: httpTimeout };

    const res = await frappeFetch<OcrAndSuggestResponse>(
      cfgWithTimeout,
      "nora.api.ocr.ocr_and_wait_suggestions",
      input as unknown as Record<string, unknown>,
    );

    if (!res.success) {
      return { error: res.error || "OCR + suggest flow failed" };
    }
    const sugCount = res.suggestions_count ?? 0;
    const status = res.suggestion_status ?? "—";
    const validationLine = res.validation
      ? ` Validation: ${res.validation.is_valid ? "OK" : "WARN"} (confidence ${(res.validation.confidence_score ?? 0).toFixed(2)}).`
      : "";
    return {
      content:
        `OCR + suggestions: Document Scan ${res.document_scan ?? "—"} (${res.document_type ?? "?"}). ` +
        `${res.pages_processed ?? "?"} page(s) en ${res.processing_time_s?.toFixed(1) ?? "?"}s (mode ${res.mode ?? "?"}). ` +
        `Suggestions: ${sugCount} (status ${status}).${validationLine} ` +
        `Total elapsed: ${res.total_elapsed_s?.toFixed(1) ?? "?"}s.`,
      data: res,
    };
  },
};
