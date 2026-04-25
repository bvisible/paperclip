import { z } from "zod";
import type { RegisteredToolEntry } from "../types.js";
import { notifyNoraWorkItemUpdate } from "./notify-nora.js";

const InputSchema = z.object({
  work_item_id: z.string().uuid(),
  reason: z.string().min(1),
});

export const noraWorkItemRequestApproval: RegisteredToolEntry = {
  name: "noraWorkItemRequestApproval",
  declaration: {
    displayName: "Request Approval on Work Item",
    description:
      "Move a work item to in_review and post the rationale as a comment, " +
      "so the user can approve or request changes from Quick Chat. Use " +
      "BEFORE executing any high-impact action: invoices above a threshold, " +
      "external email sending, large transfers, irreversible deletes. The " +
      "agent must wait for the user to approve (status returns to in_progress) " +
      "before continuing.",
    parametersSchema: {
      type: "object",
      properties: {
        work_item_id: { type: "string" },
        reason: {
          type: "string",
          description:
            "Why the user needs to approve. Be specific: amount, recipient, " +
            "what will happen on approval, what changes if rejected.",
        },
      },
      required: ["work_item_id", "reason"],
    },
  },
  async run(params, runCtx, ctx) {
    const input = InputSchema.parse(params);

    await ctx.pluginCtx.issues.createComment(
      input.work_item_id,
      `🛂 **Approval requested**\n\n${input.reason}`,
      runCtx.companyId,
      { authorAgentId: runCtx.agentId },
    );

    const updated = await ctx.pluginCtx.issues.update(
      input.work_item_id,
      { status: "in_review" },
      runCtx.companyId,
    );
    notifyNoraWorkItemUpdate(ctx, runCtx.companyId, updated.id, "approval_requested");

    return {
      content:
        `Approbation demandée pour ${updated.identifier ?? updated.id}. ` +
        `Le work item est en in_review — l'utilisateur doit l'approuver dans ` +
        `Quick Chat avant que tu poursuives.`,
      data: { id: updated.id, status: updated.status },
    };
  },
};
