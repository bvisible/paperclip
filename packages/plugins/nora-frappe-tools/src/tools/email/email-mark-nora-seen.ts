import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  uid: z.string().min(1),
  account: z.string().optional(),
  folder: z.string().optional(),
  seen: z.boolean().optional(),
});

interface MarkNoraSeenResponse {
  success?: boolean;
  uid?: string | number;
  account?: string;
  nora_seen?: boolean;
  error?: string;
}

export const noraEmailMarkNoraSeen: RegisteredToolEntry = {
  name: "noraEmailMarkNoraSeen",
  declaration: {
    displayName: "Mark Inbox Email as Processed by NORA",
    description:
      "Marque (ou démarque) un email reçu avec le flag IMAP custom $NoraSeen — " +
      "« traité par NORA ». Ce flag est INDÉPENDANT du \\Seen humain : NORA " +
      "l'utilise pour savoir ce qu'elle a déjà traité, sans affecter le statut " +
      "« lu / non lu » de l'utilisateur dans son client mail. À appeler à la " +
      "FIN du traitement d'un email (après création du Document Scan, du devis, " +
      "ou après l'avoir classifié « autre — rien à faire »), pour qu'il " +
      "n'apparaisse plus dans la prochaine relève (noraEmailList avec " +
      "not_nora_seen=true).",
    parametersSchema: {
      type: "object",
      properties: {
        uid: { type: "string", description: "UID de l'email (depuis noraEmailList)." },
        account: {
          type: "string",
          description: "Nom du compte Webmail (optionnel — compte par défaut sinon).",
        },
        folder: { type: "string", description: "Dossier de la boîte (défaut INBOX)." },
        seen: {
          type: "boolean",
          description:
            "true (défaut) pour marquer l'email comme traité par NORA, false pour " +
            "le démarquer (cas rare — par exemple si NORA s'est trompée et veut " +
            "le retraiter à la prochaine relève).",
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
    if (input.seen !== undefined) body.seen = input.seen;

    const res = await frappeFetch<MarkNoraSeenResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.mark_inbox_email_nora_seen",
      body,
    );

    let parsed: MarkNoraSeenResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as MarkNoraSeenResponse;
      } catch {
        return { error: `Could not parse mark_inbox_email_nora_seen response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.error) return { error: parsed.error };

    const action = parsed.nora_seen ? "marqué comme traité" : "démarqué";
    return {
      content: `Email uid=${parsed.uid} ${action} par NORA ($NoraSeen).`,
      data: parsed,
    };
  },
};
