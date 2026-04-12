/**
 * emailListMessages — list incoming_email entities for the current company.
 *
 * Reads from `ctx.entities` (no IMAP needed at call time): the IMAP poller
 * runs separately and persists messages as plugin entities.
 */

import type { PluginContext, ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { IncomingEmailData } from "../../email/types.js";

export interface EmailListMessagesParams {
  status?: "pending" | "processed" | "ignored" | "any";
  limit?: number;
  fromAddress?: string;
}

const ENTITY_INCOMING_EMAIL = "incoming_email";

export async function runEmailListMessages(
  ctx: PluginContext,
  params: EmailListMessagesParams,
  runCtx: ToolRunContext,
): Promise<ToolResult> {
  const limit = Math.max(1, Math.min(params.limit ?? 20, 100));
  const records = await ctx.entities.list({
    entityType: ENTITY_INCOMING_EMAIL,
    scopeKind: "company",
    scopeId: runCtx.companyId,
    limit,
  });

  const wantStatus = params.status && params.status !== "any" ? params.status : null;
  const wantFrom = params.fromAddress?.toLowerCase();

  const messages = records
    .map((r) => {
      const data = r.data as IncomingEmailData;
      return {
        id: r.id,
        accountId: data.accountId,
        from: data.fromAddress,
        fromName: data.fromName ?? "",
        to: data.toAddress,
        subject: data.subject,
        receivedAt: data.receivedAt,
        status: data.status,
        assignedAgentId: data.assignedAgentId ?? null,
      };
    })
    .filter((m) => (wantStatus ? m.status === wantStatus : true))
    .filter((m) => (wantFrom ? m.from.toLowerCase().includes(wantFrom) : true))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

  const summary =
    messages.length > 0
      ? `${messages.length} email${messages.length > 1 ? "s" : ""} for company ${runCtx.companyId}:\n` +
        messages
          .map(
            (m, i) =>
              `${i + 1}. [${m.status}] ${m.fromName ? `${m.fromName} <${m.from}>` : m.from} → ${m.subject} (${m.receivedAt.slice(0, 16)})`,
          )
          .join("\n")
      : "No incoming emails match the filter";

  return {
    content: summary,
    data: { count: messages.length, messages },
  };
}

export const emailListMessagesDeclaration = {
  displayName: "List incoming emails",
  description:
    "List incoming emails persisted by the IMAP poller for the current company. Supports filtering by processing status (pending / processed / ignored / any) and by sender address substring. Returns id, sender, recipient, subject, timestamp and processing status. Use `emailReadMessage` next to fetch the body of a specific message.",
  parametersSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["pending", "processed", "ignored", "any"],
        description: "Filter by processing status (default: any).",
        default: "any",
      },
      limit: {
        type: "number",
        description: "Maximum number of messages to return (default 20, max 100).",
        default: 20,
      },
      fromAddress: {
        type: "string",
        description: "Substring filter on the sender address (case-insensitive).",
      },
    },
  } as const,
};
