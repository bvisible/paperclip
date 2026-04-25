import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  type: z.string().min(1),
  instruction: z.string().min(1),
  schedule_time: z.string().min(1),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  execution_mode: z.enum(["notify_only", "auto", "with_approval"]).optional(),
});

interface AutomationCreateResponse {
  success?: boolean;
  data?: { name?: string };
  name?: string;
  error?: string;
}

export const frappeAutomationCreate: RegisteredToolEntry = {
  name: "frappeAutomationCreate",
  declaration: {
    displayName: "Create Automation",
    description:
      "Create a recurring automation (daily/weekly/monthly task). " +
      "Use for 'every morning at 8am, send me unpaid invoices', etc. " +
      "execution_mode: notify_only (default — just send notification), " +
      "auto (run task and notify result), with_approval (ask user " +
      "before running).",
    parametersSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description:
            "Automation type. e.g. 'recurring_task', 'morning_briefing', 'cash_check'.",
        },
        instruction: {
          type: "string",
          description: "Natural-language description of what the automation does.",
        },
        schedule_time: {
          type: "string",
          description: "HH:MM (24h), local time.",
        },
        frequency: {
          type: "string",
          enum: ["daily", "weekly", "monthly"],
        },
        execution_mode: {
          type: "string",
          enum: ["notify_only", "auto", "with_approval"],
          description: "Default: notify_only.",
        },
      },
      required: ["type", "instruction", "schedule_time", "frequency"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const res = await frappeFetch<AutomationCreateResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.frappe_automation_create",
      input as unknown as Record<string, unknown>,
    );

    let parsed: AutomationCreateResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as AutomationCreateResponse;
      } catch {
        return { error: `Could not parse frappe_automation_create response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "Automation creation failed" };

    const name = parsed.data?.name ?? parsed.name;
    return {
      content: `Automation ${name ?? "?"} créée: ${input.frequency} à ${input.schedule_time}.`,
      data: parsed.data ?? parsed,
    };
  },
};
