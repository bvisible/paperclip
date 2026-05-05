// NORA #27 Phase R-V12.4 — briefings tools (Neoffice patch).
import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({ briefing_id: z.number().int().positive() });

export const noraDeleteBriefing: RegisteredToolEntry = {
  name: "noraDeleteBriefing",
  declaration: {
    displayName: "Delete a scheduled briefing",
    description:
      "Permanently delete a briefing. Confirm with the user before calling.",
    parametersSchema: {
      type: "object",
      properties: {
        briefing_id: { type: "integer", minimum: 1 },
      },
      required: ["briefing_id"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);
    const res = await frappeFetch<{ ok?: boolean }>(
      config,
      "nora.api.v2.briefings.delete",
      input as unknown as Record<string, unknown>,
    );
    return { content: `Briefing #${input.briefing_id} supprimé.`, data: res };
  },
};
