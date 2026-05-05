// NORA #27 Phase R-V12.4 — briefings tools (Neoffice patch).
import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

interface BriefingRow {
  id: number;
  briefing_title: string;
  schedule_time: string;
  schedule_days: string;
  delivery_channel: string;
  enabled: boolean;
  last_success_at?: string | null;
}

interface ListResponse {
  ok?: boolean;
  briefings?: BriefingRow[];
}

export const noraListBriefings: RegisteredToolEntry = {
  name: "noraListBriefings",
  declaration: {
    displayName: "List the user's scheduled briefings",
    description:
      "Returns the current user's scheduled NORA briefings. Use to answer " +
      "'quels briefings j'ai ?' or to fetch the briefing_id before pause/delete.",
    parametersSchema: {
      type: "object",
      properties: {},
    },
  },
  async run(_params, runCtx, access) {
    const config = await access.getFrappeConfig(runCtx.companyId);
    const res = await frappeFetch<ListResponse>(
      config,
      "nora.api.v2.briefings.list_mine",
      {},
    );
    const items = res?.briefings ?? [];
    if (items.length === 0) {
      return { content: "Aucun briefing programmé.", data: res };
    }
    const lines = items.map(
      (b) =>
        `#${b.id} — ${b.briefing_title} ${b.schedule_time} (${b.schedule_days}) via ${b.delivery_channel} ${b.enabled ? "✓" : "(off)"}`,
    );
    return { content: lines.join("\n"), data: res };
  },
};
