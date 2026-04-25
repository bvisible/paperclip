import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  name: z.string().min(1),
});

interface AutomationDeleteResponse {
  success?: boolean;
  data?: { name?: string };
  error?: string;
}

export const frappeAutomationDelete: RegisteredToolEntry = {
  name: "frappeAutomationDelete",
  declaration: {
    displayName: "Delete Automation",
    description:
      "Permanently delete an automation by name. Confirm with the user " +
      "before calling — there's no undo.",
    parametersSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Automation name (NORA-AUTO-XXXX)." },
      },
      required: ["name"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const res = await frappeFetch<AutomationDeleteResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.frappe_automation_delete",
      input as unknown as Record<string, unknown>,
    );

    let parsed: AutomationDeleteResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as AutomationDeleteResponse;
      } catch {
        return { error: `Could not parse frappe_automation_delete response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "Automation delete failed" };

    return {
      content: `Automation ${input.name} supprimée.`,
      data: parsed.data ?? parsed,
    };
  },
};
