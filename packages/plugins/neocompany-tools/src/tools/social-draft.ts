//// Neocompany Modification — socialDraftCreate tool.
////
//// Lets a specialist (social/community) agent create a social post DRAFT for
//// human approval, instead of publishing directly or — as observed — writing
//// a fabricated "dry-run" post in an issue comment. The draft lands as a
//// `social_post` entity in status `pending_review`, which surfaces in the
//// Approvals screen; a human approves it there and approval triggers the real
//// publish. Mirrors the UI-side `draftCreate` bridge action, but is callable
//// by an agent via POST /api/plugins/tools/execute (agent JWT).
//// End Neocompany Modification

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { ToolContextAccess } from "./index.js";
import {
  SOCIAL_POST_ENTITY_TYPE,
  type SocialPostData,
  type SocialProviderKey,
} from "../social/types.js";

const PROVIDERS = ["linkedin", "facebook", "instagram"] as const;

export const socialDraftCreateDeclaration = {
  displayName: "Create social draft (for approval)",
  description:
    "Create a DRAFT social media post (LinkedIn/Facebook/Instagram) queued for human approval — it appears in the Approvals screen and is published only after a human approves it. Use this whenever you are asked to post or publish on social: never publish directly, and never fabricate a published post. Provide the provider, the post text, and optionally an approved imageId. Returns the draft id.",
  parametersSchema: {
    type: "object",
    properties: {
      provider: {
        type: "string",
        enum: [...PROVIDERS],
        description: "The social network to draft for: linkedin, facebook, or instagram.",
      },
      text: {
        type: "string",
        description: "The full post caption/body to draft.",
      },
      imageId: {
        type: "string",
        description:
          "Optional externalId of an approved library image (generated_image entity) to attach.",
      },
      accountId: {
        type: "string",
        description:
          "Optional account id when several accounts of the same provider are connected. Omit to use the first connected account for the provider.",
      },
    },
    required: ["provider", "text"],
  } as const,
};

interface DraftParams {
  provider: string;
  text: string;
  imageId?: string;
  accountId?: string;
}

export async function runSocialDraftCreate(
  params: unknown,
  runCtx: ToolRunContext,
  ctxAccess: ToolContextAccess,
): Promise<ToolResult> {
  const p = (params ?? {}) as Partial<DraftParams>;
  const provider = (typeof p.provider === "string" ? p.provider.trim().toLowerCase() : "") as SocialProviderKey;
  const text = typeof p.text === "string" ? p.text.trim() : "";
  const imageId = typeof p.imageId === "string" && p.imageId.trim().length > 0 ? p.imageId.trim() : undefined;
  const explicitAccountId =
    typeof p.accountId === "string" && p.accountId.trim().length > 0 ? p.accountId.trim() : undefined;

  if (!PROVIDERS.includes(provider as (typeof PROVIDERS)[number])) {
    return { error: `\`provider\` must be one of: ${PROVIDERS.join(", ")}` };
  }
  if (!text) return { error: "`text` is required" };

  const ctx = ctxAccess.getPluginContext();
  const companyId = runCtx.companyId;

  // Resolve a connected account for this provider from the channel index.
  let accountId = explicitAccountId;
  if (!accountId) {
    try {
      const index = (await ctx.state.get({
        scopeKind: "company",
        scopeId: companyId,
        stateKey: `channel-index:${provider}`,
      })) as string[] | null;
      if (Array.isArray(index) && index.length > 0) {
        accountId = index[0];
      }
    } catch (err) {
      return {
        error: `Could not read connected ${provider} channels: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  if (!accountId) {
    return {
      error: `No ${provider} account is connected for this company. Tell the user the channel must be connected in Settings first; do not fabricate a post.`,
    };
  }

  const now = new Date().toISOString();
  const proposedAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const data: SocialPostData = {
    text,
    imageId,
    channel: { provider, channelKey: accountId },
    proposedAt,
    status: "pending_review",
    generatedByAgentId: runCtx.agentId,
    createdAt: now,
  };

  try {
    const slug = globalThis.crypto.randomUUID();
    await ctx.entities.upsert({
      entityType: SOCIAL_POST_ENTITY_TYPE,
      scopeKind: "company",
      scopeId: companyId,
      externalId: slug,
      title: text.slice(0, 80),
      status: "pending_review",
      data: data as unknown as Record<string, unknown>,
    });
    await ctx.activity.log({
      companyId,
      message: `Draft ${provider} post created for approval (${accountId})`,
      entityType: SOCIAL_POST_ENTITY_TYPE,
      entityId: slug,
    });
    return {
      content: `Draft ${provider} post created and queued for approval (id ${slug}). A human approves it in the Approvals screen; approval publishes it. Tell the user it's drafted and waiting for their approval — do NOT claim it is published.`,
      data: { postId: slug, provider, accountId, status: "pending_review" },
    };
  } catch (err) {
    return {
      error: `Failed to create the draft: ${err instanceof Error ? err.message : String(err)}.`,
    };
  }
}
