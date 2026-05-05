import { z } from "zod";
import type { RegisteredToolEntry } from "../types.js";
import { notifyNoraWorkItemUpdate } from "./notify-nora.js";

const InputSchema = z.object({
  work_item_id: z.string().uuid(),
  result: z.string().optional(),
});

export const noraWorkItemComplete: RegisteredToolEntry = {
  name: "noraWorkItemComplete",
  declaration: {
    displayName: "Complete Work Item",
    description:
      "Mark a work item as done. Optionally attach a final result " +
      "comment summarizing the outcome (visible in Quick Chat history).",
    parametersSchema: {
      type: "object",
      properties: {
        work_item_id: {
          type: "string",
          description: "UUID of the work item to mark done.",
        },
        result: {
          type: "string",
          description:
            "Optional summary of what was done — gets posted as the " +
            "final comment so the user has the outcome in context.",
        },
      },
      required: ["work_item_id"],
    },
  },
  async run(params, runCtx, ctx) {
    const input = InputSchema.parse(params);

    if (input.result) {
      await ctx.pluginCtx.issues.createComment(
        input.work_item_id,
        input.result,
        runCtx.companyId,
        { authorAgentId: runCtx.agentId },
      );
    }

    const updated = await ctx.pluginCtx.issues.update(
      input.work_item_id,
      { status: "done" },
      runCtx.companyId,
    );
    notifyNoraWorkItemUpdate(ctx, runCtx.companyId, updated.id, "completed");
    return {
      content: `Work item ${updated.identifier ?? updated.id} terminé (done).`,
      data: { id: updated.id, status: updated.status },
    };
  },
};
