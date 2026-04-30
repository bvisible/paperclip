import { z } from "zod";
import type { RegisteredToolEntry } from "../types.js";
import { notifyNoraWorkItemUpdate } from "./notify-nora.js";

// `result` is required — see declaration.parametersSchema. We also reject the
// trivial placeholders Qwen-class models tend to emit when they treat the tool
// as a status-flip rather than a reply delivery.
const TRIVIAL_RESULTS = new Set([
  "done",
  "completed",
  "ok",
  "finished",
  "true",
  "success",
]);
const InputSchema = z.object({
  work_item_id: z.string().uuid(),
  result: z
    .string()
    .min(1)
    .refine(
      (s) => !TRIVIAL_RESULTS.has(s.trim().toLowerCase()),
      "result must contain the actual user-facing answer (numbers, names, conclusions), not a placeholder like 'done' or 'completed'.",
    ),
});

export const noraWorkItemComplete: RegisteredToolEntry = {
  name: "noraWorkItemComplete",
  declaration: {
    displayName: "Complete Work Item",
    description:
      "Mark a work item as done AND deliver the final answer to the user. " +
      "ALWAYS pass the full user-facing answer in `result` — this string is " +
      "the comment the user will read. Never use a placeholder like 'done', " +
      "'completed', 'ok' or 'finished' — the user needs the actual content " +
      "(numbers, names, dates, conclusions). If the question was 'How many " +
      "customers?', `result` must be e.g. 'Il y a 192 clients dans Neoffice.', " +
      "not 'completed'.",
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
            "REQUIRED — the full user-facing answer with all relevant data " +
            "(counts, names, totals, dates, conclusions). This text is " +
            "posted as the final comment and shown to the user verbatim. " +
            "Do NOT pass 'done' / 'completed' / 'ok' as the value — write " +
            "the actual answer the user is waiting for.",
        },
      },
      required: ["work_item_id", "result"],
    },
  },
  async run(params, runCtx, ctx) {
    // Diag: log the raw params so we can see what the LLM is actually
    // passing as `result`. Strip later in Phase 5 cleanup.
    try {
      // eslint-disable-next-line no-console
      console.log(
        `[noraWorkItemComplete:diag] raw params keys=${Object.keys(params as object).join(",")} result_preview=${
          typeof (params as { result?: unknown }).result === "string"
            ? `"${((params as { result: string }).result).slice(0, 200)}"`
            : typeof (params as { result?: unknown }).result
        }`,
      );
    } catch {
      /* swallow */
    }
    const input = InputSchema.parse(params);

    await ctx.pluginCtx.issues.createComment(
      input.work_item_id,
      input.result,
      runCtx.companyId,
      { authorAgentId: runCtx.agentId },
    );

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
