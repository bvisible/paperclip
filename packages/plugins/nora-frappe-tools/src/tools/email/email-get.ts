import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  uid: z.string().min(1),
  account: z.string().optional(),
  folder: z.string().optional(),
  mark_read: z.boolean().optional(),
});

interface InboxEmailResponse {
  success?: boolean;
  subject?: string;
  from_email?: string;
  attachments?: unknown[];
  error?: string;
}

export const noraEmailGet: RegisteredToolEntry = {
  name: "noraEmailGet",
  declaration: {
    displayName: "Get Inbox Email",
    description:
      "LECTURE de la boîte de réception : récupère le contenu COMPLET d'un " +
      "email REÇU (corps texte/HTML, destinataires, pièces jointes) par son uid " +
      "obtenu via noraEmailList. Ne marque PAS l'email comme lu par défaut " +
      "(mark_read=false) — une relève ne doit pas toucher l'état de la boîte.",
    parametersSchema: {
      type: "object",
      properties: {
        uid: { type: "string", description: "UID de l'email (depuis noraEmailList)." },
        account: {
          type: "string",
          description: "Nom du compte Webmail (optionnel — compte par défaut sinon).",
        },
        folder: { type: "string", description: "Dossier de la boîte (défaut INBOX)." },
        mark_read: {
          type: "boolean",
          description: "Marquer l'email comme lu (défaut false). Laisser false pour une relève.",
        },
      },
      required: ["uid"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const body: Record<string, unknown> = { uid: input.uid };
    if (input.account) body.account = input.account;
    if (input.folder) body.folder = input.folder;
    if (input.mark_read !== undefined) body.mark_read = input.mark_read;

    const res = await frappeFetch<InboxEmailResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.get_inbox_email",
      body,
    );

    let parsed: InboxEmailResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as InboxEmailResponse;
      } catch {
        return { error: `Could not parse get_inbox_email response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.error) return { error: parsed.error };

    const nAtt = parsed.attachments?.length ?? 0;
    return {
      content:
        `Email « ${parsed.subject ?? "(sans sujet)"} » de ${parsed.from_email ?? "?"} ` +
        `— ${nAtt} pièce(s) jointe(s).`,
      data: parsed,
    };
  },
};
