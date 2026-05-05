import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  doctype: z.string().min(1),
  name: z.string().min(1),
});

interface WorkflowStatusResponse {
  success?: boolean;
  data?: {
    current_state?: string;
    workflow_name?: string;
    available_transitions?: Array<{ action: string; next_state: string }>;
  };
  error?: string;
}

export const frappeWorkflowStatus: RegisteredToolEntry = {
  name: "frappeWorkflowStatus",
  declaration: {
    displayName: "Get Workflow Status",
    description:
      "Get a document's current workflow state plus the actions allowed " +
      "next. Use before frappeWorkflowAction to verify the action is " +
      "available, or to show the user what they can do next.",
    parametersSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "DocType name." },
        name: { type: "string", description: "Document name." },
      },
      required: ["doctype", "name"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const res = await frappeFetch<WorkflowStatusResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.workflow_status",
      input as unknown as Record<string, unknown>,
    );

    let parsed: WorkflowStatusResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as WorkflowStatusResponse;
      } catch {
        return { error: `Could not parse workflow_status response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "Workflow status failed" };

    const data = parsed.data ?? parsed;
    const state = (data as { current_state?: string }).current_state ?? "?";
    const transitions = (data as { available_transitions?: Array<{ action: string }> })
      .available_transitions ?? [];
    const actions = transitions.map((t) => t.action).join(", ") || "aucune";
    return {
      content: `${input.doctype} ${input.name} — état: ${state}. Actions: ${actions}.`,
      data,
    };
  },
};
