import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  query: z.string().min(1),
  account: z.string().optional(),
  folder: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

interface InboxSearchResponse {
  success?: boolean;
  account?: string;
  query?: string;
  count?: number;
  emails?: unknown[];
  error?: string;
}

export const noraEmailSearch: RegisteredToolEntry = {
  name: "noraEmailSearch",
  declaration: {
    displayName: "Search Inbox Emails",
    description:
      "LECTURE de la boîte de réception : cherche des emails REÇUS (recherche " +
      "dans le sujet, l'expéditeur et le corps) dans un compte Webmail. Pour " +
      "retrouver un courrier entrant précis. Retourne les emails correspondants " +
      "(uid, sujet, expéditeur, date).",
    parametersSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Termes de recherche (sujet / expéditeur / corps)." },
        account: {
          type: "string",
          description: "Nom du compte Webmail (optionnel — compte par défaut sinon).",
        },
        folder: { type: "string", description: "Dossier de la boîte (défaut INBOX)." },
        limit: { type: "number", description: "Nombre max d'emails (défaut 20, max 100)." },
      },
      required: ["query"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const body: Record<string, unknown> = { query: input.query };
    if (input.account) body.account = input.account;
    if (input.folder) body.folder = input.folder;
    if (input.limit) body.limit = input.limit;

    const res = await frappeFetch<InboxSearchResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.search_inbox_emails",
      body,
    );

    let parsed: InboxSearchResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as InboxSearchResponse;
      } catch {
        return { error: `Could not parse search_inbox_emails response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.error) return { error: parsed.error };

    const count = parsed.count ?? parsed.emails?.length ?? 0;
    return {
      content: `${count} email(s) trouvé(s) pour « ${parsed.query ?? input.query} ».`,
      data: parsed,
    };
  },
};
