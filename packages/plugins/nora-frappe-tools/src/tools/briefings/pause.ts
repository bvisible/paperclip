// NORA #27 Phase R-V12.4 — briefings tools (Neoffice patch).
import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({ briefing_id: z.number().int().positive() });

const idSchema = {
  type: "object" as const,
  properties: {
    briefing_id: { type: "integer" as const, minimum: 1 },
  },
  required: ["briefing_id"],
};

export const noraPauseBriefing: RegisteredToolEntry = {
  name: "noraPauseBriefing",
  declaration: {
    displayName: "Pause a scheduled briefing",
    description:
      "Disable a briefing — it stops firing until resumed. Get briefing_id via noraListBriefings.",
    parametersSchema: idSchema,
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);
    const res = await frappeFetch<{ ok?: boolean }>(
      config,
      "nora.api.v2.briefings.pause",
      input as unknown as Record<string, unknown>,
    );
    return { content: `Briefing #${input.briefing_id} mis en pause.`, data: res };
  },
};

export const noraResumeBriefing: RegisteredToolEntry = {
  name: "noraResumeBriefing",
  declaration: {
    displayName: "Resume a paused briefing",
    description: "Re-enable a paused briefing.",
    parametersSchema: idSchema,
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);
    const res = await frappeFetch<{ ok?: boolean }>(
      config,
      "nora.api.v2.briefings.resume",
      input as unknown as Record<string, unknown>,
    );
    return { content: `Briefing #${input.briefing_id} réactivé.`, data: res };
  },
};
