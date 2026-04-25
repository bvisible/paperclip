import { z } from "zod";
import type { RegisteredToolEntry } from "../types.js";
import { notifyNoraWorkItemUpdate } from "./notify-nora.js";

const InputSchema = z.object({
  work_item_id: z.string().uuid(),
});

export const noraWorkItemCheckout: RegisteredToolEntry = {
  name: "noraWorkItemCheckout",
  declaration: {
    displayName: "Checkout Work Item",
    description:
      "Claim a work item — moves it to in_progress and assigns it to " +
      "the current agent. Use this before starting actual work so the " +
      "user sees progress in Quick Chat. Two agents cannot work on the " +
      "same item simultaneously (atomic).",
    parametersSchema: {
      type: "object",
      properties: {
        work_item_id: {
          type: "string",
          description: "UUID of the work item to claim.",
        },
      },
      required: ["work_item_id"],
    },
  },
  async run(params, runCtx, ctx) {
    const input = InputSchema.parse(params);
    const updated = await ctx.pluginCtx.issues.update(
      input.work_item_id,
      {
        status: "in_progress",
        assigneeAgentId: runCtx.agentId,
      },
      runCtx.companyId,
    );
    notifyNoraWorkItemUpdate(ctx, runCtx.companyId, updated.id, "checked_out");
    return {
      content: `Work item ${updated.identifier ?? updated.id} pris en charge (in_progress).`,
      data: { id: updated.id, status: updated.status, assigneeAgentId: updated.assigneeAgentId },
    };
  },
};
