//// Neocompany Modification — unit tests for the delegateToSpecialist tool.
//// Proves the routing logic deterministically: role resolution, the
//// main-only guard, unknown-specialist handling, and the name fallback.
//// End Neocompany Modification

import { describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { runDelegateToSpecialist } from "../tools/delegate.js";
import { makeRunCtx, makeCtxAccess } from "./test-helpers.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const NORA = { id: "agent-nora", name: "Nora", role: "main" };
const NOVA = { id: "agent-nova", name: "Nova", role: "social" };
const SCOUT = { id: "agent-scout", name: "Scout", role: "commercial" };

/**
 * Build a ctx exposing the three namespaces delegate.ts touches:
 * agents.list, issues.create, activity.log. Returns spies for assertions.
 */
function makeDelegateCtx(agents = [NORA, NOVA, SCOUT]) {
  const createdIssues: Array<Record<string, unknown>> = [];
  const issuesCreate = vi.fn(async (input: Record<string, unknown>) => {
    const issue = { id: "issue-123", ...input };
    createdIssues.push(issue);
    return issue;
  });
  const activityLog = vi.fn(async () => undefined);
  const agentsList = vi.fn(async () => agents);

  const ctx = {
    agents: { list: agentsList },
    issues: { create: issuesCreate },
    activity: { log: activityLog },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as unknown as PluginContext;

  return { ctx, issuesCreate, activityLog, agentsList, createdIssues };
}

describe("delegateToSpecialist", () => {
  it("routes to the specialist matching the role and creates an assigned issue", async () => {
    const { ctx, issuesCreate, activityLog } = makeDelegateCtx();
    const ctxAccess = makeCtxAccess({ ctx });
    // Caller is Nora (the main coordinator).
    const runCtx = makeRunCtx({ companyId: COMPANY, agentId: NORA.id });

    const result = await runDelegateToSpecialist(
      { specialist: "social", title: "Post about launch", request: "Draft a LinkedIn post about our launch." },
      runCtx,
      ctxAccess,
    );

    expect("error" in result).toBe(false);
    expect(issuesCreate).toHaveBeenCalledTimes(1);
    const issueArg = issuesCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(issueArg.companyId).toBe(COMPANY);
    expect(issueArg.assigneeAgentId).toBe(NOVA.id);
    expect(issueArg.status).toBe("todo");
    expect(issueArg.title).toBe("Post about launch");
    expect(issueArg.description).toContain("LinkedIn post");
    // No comment is posted — the assignment is the routing signal.
    expect(activityLog).toHaveBeenCalledTimes(1);
    const data = (result as { data?: Record<string, unknown> }).data;
    expect(data?.specialist).toBe("Nova");
    expect(data?.role).toBe("social");
    expect(data?.issueId).toBe("issue-123");
  });

  it("blocks delegation when the caller is not the main coordinator", async () => {
    const { ctx, issuesCreate } = makeDelegateCtx();
    const ctxAccess = makeCtxAccess({ ctx });
    // Caller is Nova (a specialist), not main.
    const runCtx = makeRunCtx({ companyId: COMPANY, agentId: NOVA.id });

    const result = await runDelegateToSpecialist(
      { specialist: "commercial", title: "x", request: "y" },
      runCtx,
      ctxAccess,
    );

    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toContain("Only the main coordinator");
    expect(issuesCreate).not.toHaveBeenCalled();
  });

  it("returns an honest error (no issue) for an unknown specialist role", async () => {
    const { ctx, issuesCreate } = makeDelegateCtx();
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx({ companyId: COMPANY, agentId: NORA.id });

    const result = await runDelegateToSpecialist(
      { specialist: "seo", title: "Audit", request: "Run an SEO audit." },
      runCtx,
      ctxAccess,
    );

    expect("error" in result).toBe(true);
    const err = (result as { error: string }).error;
    expect(err).toContain("No specialist with role");
    // Lists the available specialists (excludes main) so the model can adapt.
    expect(err).toContain("Nova (social)");
    expect(err).toContain("Scout (commercial)");
    expect(issuesCreate).not.toHaveBeenCalled();
  });

  it("falls back to matching by agent name when the role does not match", async () => {
    const { ctx, issuesCreate } = makeDelegateCtx();
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx({ companyId: COMPANY, agentId: NORA.id });

    // "nova" is not a role, but it is an agent name.
    const result = await runDelegateToSpecialist(
      { specialist: "nova", title: "t", request: "r" },
      runCtx,
      ctxAccess,
    );

    expect("error" in result).toBe(false);
    const issueArg = issuesCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(issueArg.assigneeAgentId).toBe(NOVA.id);
  });

  it("validates required params", async () => {
    const { ctx } = makeDelegateCtx();
    const ctxAccess = makeCtxAccess({ ctx });
    const runCtx = makeRunCtx({ companyId: COMPANY, agentId: NORA.id });

    const r1 = await runDelegateToSpecialist({ title: "t", request: "r" }, runCtx, ctxAccess);
    expect((r1 as { error: string }).error).toContain("specialist");
    const r2 = await runDelegateToSpecialist({ specialist: "social", request: "r" }, runCtx, ctxAccess);
    expect((r2 as { error: string }).error).toContain("title");
    const r3 = await runDelegateToSpecialist({ specialist: "social", title: "t" }, runCtx, ctxAccess);
    expect((r3 as { error: string }).error).toContain("request");
  });
});
