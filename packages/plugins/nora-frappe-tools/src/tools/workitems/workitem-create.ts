import { z } from "zod";
import type { RegisteredToolEntry } from "../types.js";

const PRIORITIES = ["critical", "high", "medium", "low"] as const;

const InputSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  priority: z.enum(PRIORITIES).optional(),
  /** Pin to another agent (e.g. main spawning a task for sales). */
  assigneeAgentId: z.string().uuid().optional(),
  /** Optional parent issue for sub-task hierarchy. */
  parentId: z.string().uuid().optional(),
});

export const noraWorkItemCreate: RegisteredToolEntry = {
  name: "noraWorkItemCreate",
  declaration: {
    displayName: "Create Work Item",
    description:
      "Open a tracked work item visible in Quick Chat. Use for any task " +
      "that benefits from being persisted: long operations the user may " +
      "want to follow, multi-step jobs, anything needing approval, or " +
      "delegations between agents. Returns a work item id you can " +
      "checkout, comment on, or complete later. By default the item is " +
      "assigned to the current agent — pass assigneeAgentId to delegate.",
    parametersSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title (max 200 chars)." },
        description: {
          type: "string",
          description: "Optional context, plan, or rationale.",
        },
        priority: {
          type: "string",
          enum: [...PRIORITIES],
          description: "Default: medium.",
        },
        assigneeAgentId: {
          type: "string",
          description:
            "UUID of the agent to assign. Default = current agent. Pass another agent's id to delegate.",
        },
        parentId: {
          type: "string",
          description: "Parent work item id, for sub-task hierarchy.",
        },
      },
      required: ["title"],
    },
  },
  async run(params, runCtx, ctx) {
    const input = InputSchema.parse(params);
    const issue = await ctx.pluginCtx.issues.create({
      companyId: runCtx.companyId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      assigneeAgentId: input.assigneeAgentId ?? runCtx.agentId,
      parentId: input.parentId,
    });

    return {
      content:
        `Work item ${issue.identifier ?? issue.id} créé (${issue.status}). ` +
        `Visible dans Quick Chat. Utilise noraWorkItemCheckout pour le ` +
        `prendre en charge ou noraWorkItemComment pour ajouter des notes.`,
      data: { id: issue.id, identifier: issue.identifier, status: issue.status, title: issue.title },
    };
  },
};
