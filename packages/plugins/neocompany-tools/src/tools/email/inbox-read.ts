/**
 * emailReadMessage — return the full body of a single incoming email entity.
 */

import type { PluginContext, ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { IncomingEmailData } from "../../email/types.js";

export interface EmailReadMessageParams {
  /** Plugin entity ID of the incoming_email. */
  id: string;
}

const ENTITY_INCOMING_EMAIL = "incoming_email";

export async function runEmailReadMessage(
  ctx: PluginContext,
  params: EmailReadMessageParams,
  runCtx: ToolRunContext,
): Promise<ToolResult> {
  if (!params.id) return { error: "`id` is required" };

  // No direct getById API yet — we list with a tight limit and pick the
  // matching record. Cheap enough for the volumes we expect.
  const candidates = await ctx.entities.list({
    entityType: ENTITY_INCOMING_EMAIL,
    scopeKind: "company",
    scopeId: runCtx.companyId,
    limit: 200,
  });
  const record = candidates.find((r) => r.id === params.id);
  if (!record) return { error: `incoming_email "${params.id}" not found in this company` };

  const data = record.data as unknown as IncomingEmailData;
  const body = data.bodyText ?? data.bodyHtml ?? "(empty body)";

  const summary =
    `From: ${data.fromName ? `${data.fromName} <${data.fromAddress}>` : data.fromAddress}\n` +
    `To: ${data.toAddress}\n` +
    `Subject: ${data.subject}\n` +
    `Date: ${data.receivedAt}\n` +
    `Status: ${data.status}\n` +
    `\n${body}`;

  return {
    content: summary,
    data: {
      id: record.id,
      accountId: data.accountId,
      from: data.fromAddress,
      fromName: data.fromName ?? null,
      to: data.toAddress,
      subject: data.subject,
      receivedAt: data.receivedAt,
      status: data.status,
      bodyText: data.bodyText ?? null,
      bodyHtml: data.bodyHtml ?? null,
    },
  };
}

export const emailReadMessageDeclaration = {
  displayName: "Read incoming email",
  description:
    "Return the full body of a single incoming email entity (text body if present, otherwise HTML). Use `emailListMessages` first to discover the entity ID, then call this with `id`.",
  parametersSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The plugin entity ID returned by emailListMessages.",
      },
    },
    required: ["id"],
  } as const,
};
