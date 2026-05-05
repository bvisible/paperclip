// NORA #27 Phase R-V12.4 — briefings tools (Neoffice patch).
import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({ briefing_id: z.number().int().positive() });

export const noraTestBriefing: RegisteredToolEntry = {
  name: "noraTestBriefing",
  declaration: {
    displayName: "Run a briefing now (test)",
    description:
      "Execute a briefing immediately, ignoring its schedule. Useful for the user " +
      "to verify their setup ('teste mon briefing matinal'). Does not update " +
      "last_run_at, so the next scheduled run still happens normally.",
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
    const res = await frappeFetch<{ ok?: boolean; channel?: string; delivered?: boolean }>(
      config,
      "nora.api.v2.briefings.test_run",
      input as unknown as Record<string, unknown>,
    );
    return {
      content: res?.delivered
        ? `Briefing #${input.briefing_id} testé avec succès (delivery=${res?.channel}).`
        : `Briefing #${input.briefing_id} test échoué.`,
      data: res,
    };
  },
};
