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
  max_tokens: z.number().int().positive().optional(),
  notify_agent: z.boolean().optional(),
});

interface OcrResponse {
  success?: boolean;
  document_scan?: string;
  extracted_data?: Record<string, unknown>;
  pages_processed?: number;
  duration_s?: number;
  mode?: string;
  error?: string;
}

export const noraOcrProcess: RegisteredToolEntry = {
  name: "noraOcrProcess",
  declaration: {
    displayName: "OCR a Document",
    description:
      "Trigger NORA's unified OCR pipeline on a PDF or image already uploaded to Neoffice. " +
      "Returns structured extracted data (invoice header, line items, totals) and creates a " +
      "Document Scan record. Use after frappeFileUpload or noraDriveUpload to extract data " +
      "from the uploaded file. Hybrid mode (native PDF text + LLM) is auto-selected for " +
      "digitally-created PDFs (~54x faster).",
    parametersSchema: {
      type: "object",
      properties: {
        file_url: { type: "string", description: "URL of the uploaded file (e.g. '/private/files/invoice.pdf')." },
        prompt: { type: "string", description: "Optional custom prompt; defaults to invoice extraction." },
        document_type: { type: "string", description: "e.g. 'invoice', 'receipt', 'contract'. Influences the prompt." },
        create_document_scan: { type: "boolean", description: "Default true. Set false for ad-hoc OCR without DB record." },
        use_two_pass: { type: "boolean", description: "Triage thumbnails first, extract important pages only." },
        use_hybrid: { type: "boolean", description: "Native PDF text + single LLM call. Best for digital PDFs." },
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
    return {
      content:
        `OCR terminé : ${res.pages_processed ?? "?"} page(s) en ${res.duration_s?.toFixed(1) ?? "?"}s ` +
        `(mode ${res.mode ?? "?"}). Document Scan: ${res.document_scan ?? "—"}.`,
      data: res,
    };
  },
};
