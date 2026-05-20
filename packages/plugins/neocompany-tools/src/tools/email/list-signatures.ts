//// Neocompany Modification — emailListSignatures.
////
//// Lets an agent enumerate the company's email signatures so it can pick
//// one explicitly via `emailSendMessage`'s `signatureId` param. Without
//// this tool the agent only sees its default signature (resolved
//// server-side); with it the agent can choose a more contextual one
//// (e.g. a "vacation" signature, a "promo" footer, etc.) per send.
//// End Neocompany Modification

import type { PluginContext, ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import { EMAIL_SIGNATURE_ENTITY_TYPE, type EmailSignatureData } from "../../email/types.js";

export interface EmailListSignaturesParams {
  /** Substring match on the signature name (case-insensitive). */
  search?: string;
}

interface ListedSignature {
  id: string;
  name: string;
  isDefault: boolean;
}

export async function runEmailListSignatures(
  ctx: PluginContext,
  params: EmailListSignaturesParams,
  runCtx: ToolRunContext,
): Promise<ToolResult> {
  const records = await ctx.entities.list({
    entityType: EMAIL_SIGNATURE_ENTITY_TYPE,
    scopeKind: "company",
    scopeId: runCtx.companyId,
    limit: 100,
  });
  let signatures: ListedSignature[] = records.map((r) => {
    const d = (r.data ?? {}) as Partial<EmailSignatureData>;
    return {
      id: r.externalId ?? r.id,
      name: d.name ?? "Untitled",
      isDefault: Boolean(d.isDefault),
    };
  });
  const term = (params.search ?? "").trim().toLowerCase();
  if (term) signatures = signatures.filter((s) => s.name.toLowerCase().includes(term));
  // Default first, then alphabetical — matches what an agent would naturally pick.
  signatures.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return {
    content:
      signatures.length === 0
        ? "No email signatures configured for this company."
        : `Available signatures (${signatures.length}):\n` +
          signatures
            .map((s) => `- id=${s.id} | ${s.name}${s.isDefault ? " (default)" : ""}`)
            .join("\n"),
    data: { signatures } as unknown as Record<string, unknown>,
  };
}

export const emailListSignaturesDeclaration = {
  displayName: "List email signatures",
  description:
    "List the email signatures available for this company. Use the returned `id` as the `signatureId` param of `emailSendMessage` to apply a specific signature to a send. Without an explicit pick the agent's default (or the company default) signature is applied automatically.",
  parametersSchema: {
    type: "object",
    properties: {
      search: { type: "string", description: "Optional substring filter on the signature name." },
    },
  } as const,
};
