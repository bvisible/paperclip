//// Neocompany Modification — test for is_test company filter in GET /api/companies
//// This test file does not exist upstream. It pins the contract:
////   - client boards never see is_test=true companies (even if they pass ?includeTest=true)
////   - instance_admin must opt in with ?includeTest=true to see them
////   - default behaviour for everyone: exclude test companies
//// End Neocompany Modification

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { companyRoutes } from "../routes/companies.js";

const listMock = vi.fn();

vi.mock("../services/index.js", () => ({
  companyService: () => ({
    list: listMock,
    stats: vi.fn().mockResolvedValue({}),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    remove: vi.fn(),
  }),
  companyPortabilityService: () => ({
    exportBundle: vi.fn(),
    previewExport: vi.fn(),
    previewImport: vi.fn(),
    importBundle: vi.fn(),
  }),
  accessService: () => ({
    canUser: vi.fn(),
    ensureMembership: vi.fn(),
  }),
  budgetService: () => ({
    upsertPolicy: vi.fn(),
  }),
  agentService: () => ({
    getById: vi.fn(),
  }),
  feedbackService: () => ({
    listIssueVotesForUser: vi.fn(),
    listFeedbackTraces: vi.fn(),
    getFeedbackTraceById: vi.fn(),
    saveIssueVote: vi.fn(),
  }),
  logActivity: vi.fn(),
}));

type ActorOverride = {
  source?: string;
  isInstanceAdmin?: boolean;
  companyIds?: string[];
};

function appWithActor(actor: ActorOverride) {
  const app = express();
  app.use((req, _res, next) => {
    // Board actor — assertBoard() in routes/authz.ts requires actor.type === "board".
    (req as any).actor = {
      type: "board",
      userId: "user-1",
      source: actor.source ?? "session",
      isInstanceAdmin: actor.isInstanceAdmin ?? false,
      companyIds: actor.companyIds ?? [],
    };
    next();
  });
  app.use("/api/companies", companyRoutes({} as any));
  return app;
}

describe("GET /api/companies — is_test filter", () => {
  beforeEach(() => {
    listMock.mockReset();
    // Default mock: return whatever the service was asked for.
    listMock.mockImplementation(async (opts: { includeTest?: boolean } = {}) => {
      const all = [
        { id: "c-real", name: "Real Co", issuePrefix: "REA", isTest: false, status: "active" },
        { id: "c-test", name: "__TEST_E2E__", issuePrefix: "TST", isTest: true, status: "active" },
      ];
      return opts.includeTest ? all : all.filter((c) => !c.isTest);
    });
  });

  it("includes test companies by default for instance admins", async () => {
    const res = await request(appWithActor({ isInstanceAdmin: true })).get("/api/companies");
    expect(res.status).toBe(200);
    // Admins always see test companies — they need them on the regular
    // /:companyPrefix/* routes to actually use them as workspaces.
    expect(listMock).toHaveBeenCalledWith({ includeTest: true });
    const ids = res.body.map((c: { id: string }) => c.id);
    expect(ids).toContain("c-real");
    expect(ids).toContain("c-test");
  });

  it("?includeTest=true is accepted for back-compat (admins already see all)", async () => {
    const res = await request(appWithActor({ isInstanceAdmin: true })).get(
      "/api/companies?includeTest=true",
    );
    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith({ includeTest: true });
    const ids = res.body.map((c: { id: string }) => c.id);
    expect(ids).toContain("c-real");
    expect(ids).toContain("c-test");
  });

  it("never returns test companies to non-admin users", async () => {
    const res = await request(
      appWithActor({ isInstanceAdmin: false, companyIds: ["c-real", "c-test"] }),
    ).get("/api/companies?includeTest=true");
    expect(res.status).toBe(200);
    // Service is called with includeTest=false because caller is not admin
    // — query param is ignored for non-admins.
    expect(listMock).toHaveBeenCalledWith({ includeTest: false });
    expect(res.body.map((c: { id: string }) => c.id)).toEqual(["c-real"]);
  });

  it("local_implicit (dev) callers see test companies by default", async () => {
    const res = await request(appWithActor({ source: "local_implicit" })).get("/api/companies");
    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith({ includeTest: true });
  });

  it("?includeTest=1 still flips on (no-op for admins, ignored for non-admins)", async () => {
    const res = await request(appWithActor({ isInstanceAdmin: true })).get(
      "/api/companies?includeTest=1",
    );
    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith({ includeTest: true });
  });
});
