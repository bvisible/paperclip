import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  uid: z.string().min(1),
  attachment_id: z.string().optional(),
  account: z.string().optional(),
  folder: z.string().optional(),
});

interface AttachmentResponse {
  success?: boolean;
  filename?: string;
  file_url?: string;
  content_type?: string;
  size?: number;
  error?: string;
}

export const noraEmailDownloadAttachment: RegisteredToolEntry = {
  name: "noraEmailDownloadAttachment",
  declaration: {
    displayName: "Download Inbox Attachment",
    description:
      "LECTURE de la boîte de réception : télécharge une pièce jointe d'un " +
      "email REÇU et la sauve comme fichier Frappe. Retourne un file_url — " +
      "c'est l'entrée du pipeline OCR (passe ce file_url à noraOcrAndSuggest " +
      "pour traiter une facture fournisseur en pièce jointe).",
    parametersSchema: {
      type: "object",
      properties: {
        uid: { type: "string", description: "UID de l'email (depuis noraEmailList)." },
        attachment_id: {
          type: "string",
          description: "Identifiant de la pièce jointe (depuis noraEmailGet, défaut '0').",
        },
        account: {
          type: "string",
          description: "Nom du compte Webmail (optionnel — compte par défaut sinon).",
        },
        folder: { type: "string", description: "Dossier de la boîte (défaut INBOX)." },
      },
      required: ["uid"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const body: Record<string, unknown> = { uid: input.uid };
    if (input.attachment_id) body.attachment_id = input.attachment_id;
    if (input.account) body.account = input.account;
    if (input.folder) body.folder = input.folder;

    const res = await frappeFetch<AttachmentResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.download_inbox_attachment",
      body,
    );

    let parsed: AttachmentResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as AttachmentResponse;
      } catch {
        return { error: `Could not parse download_inbox_attachment response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.error) return { error: parsed.error };

    return {
      content:
        `Pièce jointe « ${parsed.filename ?? "?"} » téléchargée → ${parsed.file_url ?? "?"}. ` +
        `Passe ce file_url à noraOcrAndSuggest pour l'OCR.`,
      data: parsed,
    };
  },
};
