import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean().optional(),
  schedule_time: z.string().optional(),
  frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
  instruction: z.string().optional(),
  execution_mode: z.enum(["notify_only", "auto", "with_approval"]).optional(),
});

interface AutomationUpdateResponse {
  success?: boolean;
  data?: { name?: string };
  error?: string;
}

export const frappeAutomationUpdate: RegisteredToolEntry = {
  name: "frappeAutomationUpdate",
  declaration: {
    displayName: "Update Automation",
    description:
      "Update an existing automation by name. Pass only the fields you want " +
      "to change. Common: toggle enabled, change schedule_time or frequency.",
    parametersSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Automation name (NORA-AUTO-XXXX)." },
        enabled: { type: "boolean", description: "Enable/disable the automation." },
        schedule_time: { type: "string", description: "HH:MM (24h)." },
        frequency: { type: "string", enum: ["daily", "weekly", "monthly"] },
        instruction: { type: "string" },
        execution_mode: {
          type: "string",
          enum: ["notify_only", "auto", "with_approval"],
        },
      },
      required: ["name"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const res = await frappeFetch<AutomationUpdateResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.frappe_automation_update",
      input as unknown as Record<string, unknown>,
    );

    let parsed: AutomationUpdateResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as AutomationUpdateResponse;
      } catch {
        return { error: `Could not parse frappe_automation_update response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "Automation update failed" };

    const updated = Object.keys(input).filter((k) => k !== "name");
    return {
      content: `Automation ${input.name} mise à jour (${updated.join(", ")}).`,
      data: parsed.data ?? parsed,
    };
  },
};
