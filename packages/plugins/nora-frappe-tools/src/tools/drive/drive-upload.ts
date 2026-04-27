import { z } from "zod";
import { frappeFetchMultipart } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  file_name: z.string().min(1),
  content_base64: z.string().min(1),
  mime_type: z.string().optional(),
  parent_folder: z.string().optional(),
  is_private: z.boolean().optional(),
});

interface UploadResponse {
  name?: string;
  file_url?: string;
  file_name?: string;
  is_private?: number;
  attached_to_doctype?: string;
  attached_to_name?: string;
}

export const noraDriveUpload: RegisteredToolEntry = {
  name: "noraDriveUpload",
  declaration: {
    displayName: "Upload to Drive",
    description:
      "Upload a file to Neoffice Drive (with optional parent folder). Pre-configures the " +
      "upload to land in Drive (vs attached-to-doctype like frappeFileUpload). For attaching " +
      "a file directly to a Sales Invoice / Customer / etc., use frappeFileUpload instead.",
    parametersSchema: {
      type: "object",
      properties: {
        file_name: { type: "string", description: "Filename incl. extension." },
        content_base64: { type: "string", description: "File content base64-encoded." },
        mime_type: { type: "string", description: "MIME type (e.g. 'application/pdf')." },
        parent_folder: { type: "string", description: "Optional Drive Folder docname (defaults to root)." },
        is_private: { type: "boolean", description: "Default true. Set false for public links." },
      },
      required: ["file_name", "content_base64"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const fields: Record<string, string> = {
      is_private: input.is_private === false ? "0" : "1",
      // Drive uses "folder" form field at upload time
      folder: input.parent_folder || "Home",
    };

    let res: UploadResponse;
    try {
      res = await frappeFetchMultipart<UploadResponse>(
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
      return { error: `Drive upload failed: ${(err as Error).message}` };
    }

    return {
      content: `Fichier ${res.file_name ?? input.file_name} uploadé dans Drive (folder: ${input.parent_folder || "Home"}).`,
      data: res,
    };
  },
};
