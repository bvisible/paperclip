import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  file_url: z.string().min(1),
  prompt: z.string().optional(),
  document_type: z.string().optional(),
  create_document_scan: z.boolean().optional(),
  use_two_pass: z.boolean().optional(),
  use_hybrid: z.boolean().optional(),
  validate_hallucination: z.boolean().optional(),
  max_tokens: z.number().int().positive().optional(),
  notify_agent: z.boolean().optional(),
});

interface ValidationPayload {
  is_valid?: boolean;
  warnings?: string[];
  confidence_score?: number;
}

interface OcrResponse {
  success?: boolean;
  data?: Record<string, unknown>;
  document_scan_name?: string;
  document_type?: string;
  validation?: ValidationPayload;
  validation_errors?: string[] | null;
  pages_processed?: number;
  pages_skipped?: number;
  total_pages?: number;
  processing_time?: number;
  model_used?: string;
  retry_count?: number;
  json_repair_applied?: boolean;
  hybrid_used?: boolean;
  two_pass_used?: boolean;
  page_splitting_used?: boolean;
  error?: string;
}

function _ocrMode(r: OcrResponse): string {
  if (r.hybrid_used) return "hybrid";
  if (r.two_pass_used) return "two_pass";
  if (r.page_splitting_used) return "page_split";
  return "single_pass";
}

export const noraOcrProcess: RegisteredToolEntry = {
  name: "noraOcrProcess",
  declaration: {
    displayName: "OCR a Document",
    description:
      "Trigger NORA's unified OCR pipeline on a PDF or image already uploaded to Neoffice. " +
      "Returns structured extracted data (invoice header, line items, totals, VAT, QR), " +
      "validation warnings + confidence score, and creates a Document Scan record. " +
      "Hybrid mode (native PDF text + LLM) is auto-selected for digital PDFs (~54x faster). " +
      "Accounting suggestions are populated ASYNCHRONOUSLY — call noraDocumentScanGet a few " +
      "seconds later, OR use noraOcrAndSuggest for a one-shot synchronous flow.",
    parametersSchema: {
      type: "object",
      properties: {
        file_url: { type: "string", description: "URL of the uploaded file (e.g. '/private/files/invoice.pdf')." },
        prompt: { type: "string", description: "Optional custom prompt; defaults to NORA's OCR prompt." },
        document_type: { type: "string", description: "e.g. 'invoice', 'receipt', 'contract'. Influences the prompt." },
        create_document_scan: { type: "boolean", description: "Default true. Set false for ad-hoc OCR with no DB record." },
        use_two_pass: { type: "boolean", description: "Triage thumbnails first, extract important pages only." },
        use_hybrid: { type: "boolean", description: "Native PDF text + single LLM call. Best for digital PDFs." },
        validate_hallucination: { type: "boolean", description: "Default false. Set true to also run anti-hallucination checks (filename ↔ supplier, items sum ↔ total)." },
        max_tokens: { type: "number", description: "Max LLM tokens per page (default 4096)." },
        notify_agent: { type: "boolean", description: "Default true. Push completion event to agent." },
      },
      required: ["file_url"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const res = await frappeFetch<OcrResponse>(
      config,
      "nora.api.ocr.ocr_process",
      input as unknown as Record<string, unknown>,
    );

    if (res.success === false) {
      return { error: res.error || "OCR processing failed" };
    }
    const mode = _ocrMode(res);
    const ds = res.document_scan_name ?? "—";
    const validationLine = res.validation
      ? ` Validation: ${res.validation.is_valid ? "OK" : "WARN"} (confidence ${(res.validation.confidence_score ?? 0).toFixed(2)}, ${(res.validation.warnings?.length ?? 0)} warning(s)).`
      : "";
    return {
      content:
        `OCR terminé : ${res.pages_processed ?? "?"}/${res.total_pages ?? "?"} page(s) en ${res.processing_time?.toFixed(1) ?? "?"}s ` +
        `(mode ${mode}). Document Scan: ${ds}.${validationLine} ` +
        `Suggestions accounting populées en async — appelle noraDocumentScanGet dans ~30s pour les voir.`,
      data: {
        success: true,
        document_scan: res.document_scan_name,
        document_type: res.document_type,
        extracted_data: res.data,
        validation: res.validation,
        validation_errors: res.validation_errors,
        mode,
        pages_processed: res.pages_processed,
        pages_skipped: res.pages_skipped,
        total_pages: res.total_pages,
        processing_time_s: res.processing_time,
        model_used: res.model_used,
        retry_count: res.retry_count,
      },
    };
  },
};
