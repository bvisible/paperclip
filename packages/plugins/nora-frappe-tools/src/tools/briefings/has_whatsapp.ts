// NORA #27 Phase R-V12.4 — briefings tools (Neoffice patch).
// Source-of-truth lives in bvisible/neoffice-devops/scripts/
// nora-briefings-tools-patch/. apply.sh re-installs into the
// nora-frappe-tools plugin tree on each update_paperclip.sh run.
import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({});

interface HasWhatsappResponse {
  ok?: boolean;
  has_whatsapp?: boolean;
  phone?: string | null;
}

export const noraUserHasWhatsapp: RegisteredToolEntry = {
  name: "noraUserHasWhatsapp",
  declaration: {
    displayName: "Check if user has WhatsApp configured",
    description:
      "Returns whether the current user has a WhatsApp phone number " +
      "configured in NORA User Settings, so main can decide whether to " +
      "propose WhatsApp as a delivery channel for scheduled briefings. " +
      "Call BEFORE proposing channel options to the user.",
    parametersSchema: {
      type: "object",
      properties: {},
    },
  },
  async run(_params, _runCtx, access) {
    const config = await access.getFrappeConfig(_runCtx.companyId);
    const res = await frappeFetch<HasWhatsappResponse>(
      config,
      "nora.api.v2.briefings.has_whatsapp",
      {},
    );
    return {
      content: res?.has_whatsapp
        ? `User has WhatsApp configured (phone: ${res.phone ?? "?"})`
        : "User does not have WhatsApp configured — only propose Raven or Email.",
      data: res,
    };
  },
};
