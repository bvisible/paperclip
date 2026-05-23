import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  account: z.string().optional(),
  folder: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
  not_nora_seen: z.boolean().optional(),
});

interface InboxListResponse {
  success?: boolean;
  account?: string;
  folder?: string;
  filter?: string;
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
      "sujet, expéditeur, date, présence de pièces jointes, et le flag nora_seen " +
      "(traité par NORA). Pour une relève récurrente, passe not_nora_seen=true : " +
      "tu n'obtiens QUE les emails que NORA n'a pas encore traités — indépendant " +
      "du \\Seen humain (l'utilisateur peut avoir déjà lu un email dans son " +
      "client mail sans que NORA l'ait considéré). Appelle ensuite noraEmailGet " +
      "pour lire un email en entier, puis noraEmailMarkNoraSeen quand tu en as " +
      "fini avec lui.",
    parametersSchema: {
      type: "object",
      properties: {
        account: {
          type: "string",
          description: "Nom du compte Webmail (optionnel — compte par défaut sinon).",
        },
        folder: { type: "string", description: "Dossier de la boîte (défaut INBOX)." },
        limit: { type: "number", description: "Nombre max d'emails (défaut 20, max 100)." },
        not_nora_seen: {
          type: "boolean",
          description:
            "Si true, ne liste QUE les emails que NORA n'a pas encore marqués traités " +
            "(flag IMAP $NoraSeen, indépendant du \\Seen humain). À utiliser pour une " +
            "relève récurrente — ne re-traite pas les emails déjà vus par NORA.",
        },
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
    if (input.not_nora_seen) body.not_nora_seen = true;

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
    const filterTag = parsed.filter === "not_nora_seen" ? " (non traités par NORA)" : "";
    return {
      content: `${count} email(s) dans ${parsed.folder ?? "INBOX"}${filterTag} (compte ${parsed.account ?? "?"}).`,
      data: parsed,
    };
  },
};
