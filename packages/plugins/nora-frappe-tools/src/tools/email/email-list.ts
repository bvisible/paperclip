import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  account: z.string().optional(),
  folder: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

interface InboxListResponse {
  success?: boolean;
  account?: string;
  folder?: string;
  count?: number;
  emails?: unknown[];
  error?: string;
}

export const noraEmailList: RegisteredToolEntry = {
  name: "noraEmailList",
  declaration: {
    displayName: "List Inbox Emails",
    description:
      "LECTURE de la boîte de réception : liste les emails REÇUS d'un compte " +
      "Webmail (courrier entrant). Sert à relever et trier la boîte — ce n'est " +
      "PAS l'envoi d'email (voir frappeEmailDraft pour composer). Retourne uid, " +
      "sujet, expéditeur, date, présence de pièces jointes. Appelle ensuite " +
      "noraEmailGet pour lire un email en entier.",
    parametersSchema: {
      type: "object",
      properties: {
        account: {
          type: "string",
          description: "Nom du compte Webmail (optionnel — compte par défaut sinon).",
        },
        folder: { type: "string", description: "Dossier de la boîte (défaut INBOX)." },
        limit: { type: "number", description: "Nombre max d'emails (défaut 20, max 100)." },
      },
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const body: Record<string, unknown> = {};
    if (input.account) body.account = input.account;
    if (input.folder) body.folder = input.folder;
    if (input.limit) body.limit = input.limit;

    const res = await frappeFetch<InboxListResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.list_inbox_emails",
      body,
    );

    let parsed: InboxListResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as InboxListResponse;
      } catch {
        return { error: `Could not parse list_inbox_emails response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.error) return { error: parsed.error };

    const count = parsed.count ?? parsed.emails?.length ?? 0;
    return {
      content: `${count} email(s) dans ${parsed.folder ?? "INBOX"} (compte ${parsed.account ?? "?"}).`,
      data: parsed,
    };
  },
};
