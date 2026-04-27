import { z } from "zod";
import { frappeFetchMultipart } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  file_name: z.string().min(1),
  content_base64: z.string().min(1),
  mime_type: z.string().optional(),
  attached_to_doctype: z.string().optional(),
  attached_to_name: z.string().optional(),
  fieldname: z.string().optional(),
  is_private: z.boolean().optional(),
  folder: z.string().optional(),
});

interface UploadFileResponse {
  name?: string;
  file_url?: string;
  file_name?: string;
  is_private?: number;
  attached_to_doctype?: string;
  attached_to_name?: string;
}

export const frappeFileUpload: RegisteredToolEntry = {
  name: "frappeFileUpload",
  declaration: {
    displayName: "Upload File",
    description:
      "Upload a binary file (PDF, image, scan) to Neoffice and optionally attach it to a document. " +
      "The agent passes the file content as base64 — useful for OCR scans, contract signatures, " +
      "or supporting docs to attach to a Sales Invoice / Purchase Receipt / etc. " +
      "Set attached_to_doctype + attached_to_name to link the file to an existing record.",
    parametersSchema: {
      type: "object",
      properties: {
        file_name: { type: "string", description: "Filename incl. extension (e.g. 'invoice_alltron.pdf')." },
        content_base64: { type: "string", description: "File content base64-encoded." },
        mime_type: { type: "string", description: "MIME type. Default 'application/octet-stream'." },
        attached_to_doctype: { type: "string", description: "Optional: doctype to attach the file to." },
        attached_to_name: { type: "string", description: "Optional: docname to attach the file to." },
        fieldname: { type: "string", description: "Optional: target attach field on the document." },
        is_private: { type: "boolean", description: "Default true. Set false for public files." },
        folder: { type: "string", description: "Optional: target folder (default Home/Attachments)." },
      },
      required: ["file_name", "content_base64"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const fields: Record<string, string> = {
      is_private: input.is_private === false ? "0" : "1",
    };
    if (input.attached_to_doctype) fields.doctype = input.attached_to_doctype;
    if (input.attached_to_name) fields.docname = input.attached_to_name;
    if (input.fieldname) fields.fieldname = input.fieldname;
    if (input.folder) fields.folder = input.folder;

    let res: UploadFileResponse;
    try {
      res = await frappeFetchMultipart<UploadFileResponse>(
        config,
        "upload_file",
        fields,
        {
          name: input.file_name,
          contentBase64: input.content_base64,
          mimeType: input.mime_type,
        },
      );
    } catch (err) {
      return { error: `File upload failed: ${(err as Error).message}` };
    }

    const target = input.attached_to_doctype && input.attached_to_name
      ? ` attaché à ${input.attached_to_doctype} ${input.attached_to_name}`
      : "";
    return {
      content: `Fichier ${res.file_name ?? input.file_name} uploadé${target}.`,
      data: res,
    };
  },
};
