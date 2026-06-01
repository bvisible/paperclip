//// Neocompany Modification — delegateToSpecialist tool.
////
//// Lets the main coordinator (Nora) hand a task to the right specialist
//// reliably, without hand-crafting curl. It resolves the specialist agent by
//// role within the company and creates a Paperclip issue assigned to them
//// (status=todo, no comment) — the assignment wakes the specialist, who does
//// the work and posts the result on the issue. Encapsulating lookup + create
//// + assign here removes the fragility of prompting the LLM to call the raw
//// API (and keeps the company-scoped agent resolution server-trusted).
//// End Neocompany Modification

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { ToolContextAccess } from "./index.js";

/** Specialist roles that exist in a NeoCompany seed (besides `main`). */
const KNOWN_SPECIALIST_ROLES = [
  "seo",
  "social",
  "community",
  "writer",
  "support",
  "commercial",
  "brand",
  "designer",
] as const;

export const delegateToSpecialistDeclaration = {
  displayName: "Delegate to specialist",
  description:
    "Route a task to the right specialist agent of this company by creating a Paperclip issue assigned to them. The assignment wakes the specialist, who executes and posts the result on the issue. Use this whenever a request belongs to a specialist (SEO, social, community, writing, support, commercial, brand, design) rather than answering it yourself. Returns the created issue id and the specialist's name so you can acknowledge the routing to the user. Do NOT claim the work is done — it is in progress.",
  parametersSchema: {
    type: "object",
    properties: {
      specialist: {
        type: "string",
        enum: [...KNOWN_SPECIALIST_ROLES],
        description:
          "The specialist ROLE to route to: seo (Lyra), social (Nova), community (Maya), writer (Ella), support (Atlas/Melvin), commercial (Scout), brand (Iris), designer (Pixel).",
      },
      title: {
        type: "string",
        description: "Short imperative summary of the task (issue title).",
      },
      request: {
        type: "string",
        description:
          "The full task for the specialist: the user's request verbatim plus any context you have. The specialist only sees this — be complete.",
      },
    },
    required: ["specialist", "title", "request"],
  } as const,
};

interface DelegateParams {
  specialist: string;
  title: string;
  request: string;
}

export async function runDelegateToSpecialist(
  params: unknown,
  runCtx: ToolRunContext,
  ctxAccess: ToolContextAccess,
): Promise<ToolResult> {
  const p = (params ?? {}) as Partial<DelegateParams>;
  const specialist = typeof p.specialist === "string" ? p.specialist.trim().toLowerCase() : "";
  const title = typeof p.title === "string" ? p.title.trim() : "";
  const request = typeof p.request === "string" ? p.request.trim() : "";

  if (!specialist) return { error: "`specialist` (role) is required" };
  if (!title) return { error: "`title` is required" };
  if (!request) return { error: "`request` is required" };

  const ctx = ctxAccess.getPluginContext();
  const companyId = runCtx.companyId;

  // Resolve the specialist agent by role within THIS company. Roles are custom
  // NeoCompany values not in the SDK AgentRole union, so compare as strings;
  // fall back to a case-insensitive name match (e.g. "Nova").
  let agents: Array<{ id: string; name: string; role: string }>;
  try {
    agents = (await ctx.agents.list({ companyId })) as unknown as Array<{
      id: string;
      name: string;
      role: string;
    }>;
  } catch (err) {
    return {
      error: `Could not list company agents: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Guard: only the main coordinator (Nora) may delegate. `allowedRoles` in the
  // registry is not enforced by the host's checkAccess, so enforce it here. The
  // caller is in the list we just fetched — no extra API call.
  const caller = agents.find((a) => a.id === runCtx.agentId);
  if (caller && String(caller.role).toLowerCase() !== "main") {
    return {
      error:
        "Only the main coordinator can delegate to specialists. You are a specialist — do the work yourself and post the result on your issue.",
    };
  }

  const target =
    agents.find((a) => String(a.role).toLowerCase() === specialist) ??
    agents.find((a) => String(a.name).toLowerCase() === specialist);

  if (!target) {
    const available = agents
      .filter((a) => String(a.role).toLowerCase() !== "main")
      .map((a) => `${a.name} (${a.role})`)
      .join(", ");
    return {
      error: `No specialist with role "${specialist}" in this company. Available: ${available || "none"}. Tell the user honestly you can't route this.`,
    };
  }

  // Create the issue assigned to the specialist. status=todo (not backlog) so
  // the assignment wakeup fires; no comment is posted — the assignment is the
  // routing signal (see the comment-backstop / self-comment fixes).
  try {
    const issue = await ctx.issues.create({
      companyId,
      title,
      description: request,
      status: "todo",
      assigneeAgentId: target.id,
    });
    await ctx.activity.log({
      companyId,
      message: `Nora routed a task to ${target.name} (${target.role}) — issue ${issue.id}`,
      entityType: "issue",
      entityId: issue.id,
    });
    return {
      content: `Routed to ${target.name} (${target.role}). Issue ${issue.id} created and assigned; ${target.name} is now on it. Tell the user it has been handed to ${target.name} and is in progress.`,
      data: { issueId: issue.id, specialist: target.name, role: target.role },
    };
  } catch (err) {
    return {
      error: `Failed to create the delegation issue: ${err instanceof Error ? err.message : String(err)}. Tell the user routing failed and they can retry.`,
    };
  }
}
