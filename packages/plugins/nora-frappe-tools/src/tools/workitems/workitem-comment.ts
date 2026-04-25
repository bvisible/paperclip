import { z } from "zod";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  work_item_id: z.string().uuid(),
  body: z.string().min(1),
});

export const noraWorkItemComment: RegisteredToolEntry = {
  name: "noraWorkItemComment",
  declaration: {
    displayName: "Comment on Work Item",
    description:
      "Add a comment to a work item. Use to log progress (intermediate " +
      "steps, discovered facts, blockers) so the user can follow what's " +
      "happening from Quick Chat without the agent having to re-explain.",
    parametersSchema: {
      type: "object",
      properties: {
        work_item_id: { type: "string" },
        body: { type: "string", description: "Comment text. Markdown allowed." },
      },
      required: ["work_item_id", "body"],
    },
  },
  async run(params, runCtx, ctx) {
    const input = InputSchema.parse(params);
    const comment = await ctx.pluginCtx.issues.createComment(
      input.work_item_id,
      input.body,
      runCtx.companyId,
      { authorAgentId: runCtx.agentId },
    );
    return {
      content: `Commentaire ajouté au work item.`,
      data: { id: comment.id, issueId: comment.issueId, createdAt: comment.createdAt },
    };
  },
};
