//// Neoffice Modification: dedupe-delegation-issue-loop-test
//// Why: NORA Sprint P (2026-05-20) — source-level proof that the
////      duplicate-delegation guard is present and correctly shaped in the
////      POST /companies/:id/issues handler.
////
////      An orchestration loop on osiris created 107 strictly-identical
////      "[delegate from main] Exécute frappeDocumentList(doctype='Account'…)"
////      issues in ~14h, saturating the 2-vCPU host (136 timed_out +
////      79 failed runs / 24h). The guard makes a 2nd identical OPEN
////      delegation resolve to the existing issue instead of spawning a
////      duplicate, so a re-delegation loop can no longer snowball.
////
////      Source-level (not embedded-postgres integration) so it runs
////      deterministically on every host — same approach as the Sprint L
////      wiki-frontier-isolation tests.
//// Date: 2026-05-20
//// Refs: NORA Sprint P incident osiris [[NORA/36-llm-wiki-poc/14-memory-reset-sprint-p]]
//// End Neoffice Modification: dedupe-delegation-issue-loop-test
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const issuesRoutePath = join(here, "..", "routes", "issues.ts");
const issuesRouteSource = readFileSync(issuesRoutePath, "utf-8");

describe("dedupe-delegation-issue-loop guard (source-level)", () => {
  it("the POST /issues handler carries the dedupe guard block", () => {
    expect(issuesRouteSource).toContain(
      "//// Neoffice Modification: dedupe-delegation-issue-loop",
    );
    expect(issuesRouteSource).toContain(
      "//// End Neoffice Modification: dedupe-delegation-issue-loop",
    );
  });

  it("the guard only triggers when the new issue has an agent assignee", () => {
    // Without an assigneeAgentId there is no delegation loop to break,
    // and unassigned tasks may legitimately repeat — the guard must skip them.
    expect(issuesRouteSource).toMatch(
      /if \(req\.body\.assigneeAgentId && dedupeTitle\.length > 0\)/,
    );
  });

  it("the guard matches an EXISTING OPEN issue by company + title + assignee", () => {
    // The lookup must scope to the same company, exact title, same assignee,
    // and only OPEN statuses (todo/in_progress/blocked) — a done/cancelled
    // issue with the same title is not a live duplicate.
    expect(issuesRouteSource).toContain("eq(issues.companyId, companyId)");
    expect(issuesRouteSource).toContain("eq(issues.title, req.body.title)");
    expect(issuesRouteSource).toContain(
      "eq(issues.assigneeAgentId, req.body.assigneeAgentId)",
    );
    expect(issuesRouteSource).toMatch(
      /inArray\(\s*issues\.status,\s*\["todo",\s*"in_progress",\s*"blocked"\]\s*\)/,
    );
  });

  it("on a duplicate it returns the existing issue with HTTP 200 (not a new 201)", () => {
    // The dedupe path resolves the existing issue and returns it with 200,
    // distinct from the normal create path which responds 201.
    // Trailing "\n" pins the match to the guard markers, not the
    // "-imports" variant which shares the same prefix.
    const guardStart = issuesRouteSource.indexOf(
      "//// Neoffice Modification: dedupe-delegation-issue-loop\n",
    );
    const guardEnd = issuesRouteSource.indexOf(
      "//// End Neoffice Modification: dedupe-delegation-issue-loop\n",
    );
    expect(guardStart).toBeGreaterThan(-1);
    expect(guardEnd).toBeGreaterThan(guardStart);
    const guardBlock = issuesRouteSource.slice(guardStart, guardEnd);
    expect(guardBlock).toContain("svc.getById(existingOpen[0].id)");
    expect(guardBlock).toContain("res.status(200).json(existing)");
    expect(guardBlock).toContain("return;");
  });

  it("the guard runs BEFORE svc.create so no duplicate row is ever inserted", () => {
    const guardEnd = issuesRouteSource.indexOf(
      "//// End Neoffice Modification: dedupe-delegation-issue-loop",
    );
    const createCall = issuesRouteSource.indexOf("const issue = await svc.create(companyId");
    expect(guardEnd).toBeGreaterThan(-1);
    expect(createCall).toBeGreaterThan(guardEnd);
  });
});
