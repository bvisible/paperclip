import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({});

interface AutomationListResponse {
  success?: boolean;
  data?: {
    automations?: Array<{
      name: string;
      automation_type?: string;
      instruction?: string;
      schedule_time?: string;
      frequency?: string;
      enabled?: boolean;
    }>;
  };
  automations?: Array<unknown>;
  error?: string;
}

export const frappeAutomationList: RegisteredToolEntry = {
  name: "frappeAutomationList",
  declaration: {
    displayName: "List Automations",
    description:
      "List all recurring automations owned by the current user " +
      "(daily/weekly/monthly tasks, morning briefings, etc.). Returns " +
      "name, type, schedule, frequency, enabled flag.",
    parametersSchema: {
      type: "object",
      properties: {},
    },
  },
  async run(params, runCtx, access) {
    InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const res = await frappeFetch<AutomationListResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.frappe_automation_list",
      {},
    );

    let parsed: AutomationListResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as AutomationListResponse;
      } catch {
        return { error: `Could not parse frappe_automation_list response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "Automation list failed" };

    const data = parsed.data ?? parsed;
    const autos = (data as { automations?: unknown[] }).automations ?? [];
    return {
      content: `${autos.length} automation(s) actives.`,
      data: { automations: autos },
    };
  },
};
