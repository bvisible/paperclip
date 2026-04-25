import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  doctype: z.string().min(1),
  name: z.string().min(1),
  action: z.string().min(1),
});

interface WorkflowActionResponse {
  success?: boolean;
  data?: { new_state?: string; comment?: string };
  error?: string;
}

export const frappeWorkflowAction: RegisteredToolEntry = {
  name: "frappeWorkflowAction",
  declaration: {
    displayName: "Apply Workflow Action",
    description:
      "Execute a workflow transition on a document — e.g. Submit, Approve, " +
      "Reject, Cancel. The action name must match an allowed transition for " +
      "the document's current state. Use frappeWorkflowStatus first if you " +
      "don't know the current state.",
    parametersSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "DocType (e.g. 'Sales Invoice')." },
        name: { type: "string", description: "Document name." },
        action: {
          type: "string",
          description: "Workflow action label (e.g. 'Approve', 'Submit').",
        },
      },
      required: ["doctype", "name", "action"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const res = await frappeFetch<WorkflowActionResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.workflow_action",
      input as unknown as Record<string, unknown>,
    );

    let parsed: WorkflowActionResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as WorkflowActionResponse;
      } catch {
        return { error: `Could not parse workflow_action response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "Workflow action failed" };

    const data = parsed.data ?? parsed;
    const newState = (data as { new_state?: string }).new_state;
    return {
      content: `Action ${input.action} appliquée sur ${input.doctype} ${input.name}${newState ? ` → ${newState}` : ""}.`,
      data,
    };
  },
};
