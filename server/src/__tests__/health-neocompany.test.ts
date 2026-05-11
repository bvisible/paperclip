//// Neocompany Modification — fork-stats health endpoint test (Phase 5)
//// Pins the `neocompany` section appended to the /health full-details
//// payload: counts of activated plugins, agents, companies + the
//// degraded-flag that lights up when the seed-agents invariant breaks.
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Db } from "@paperclipai/db";
import { healthRoutes } from "../routes/health.js";

vi.mock("../dev-server-status.js", () => ({
  readPersistedDevServerStatus: vi.fn().mockReturnValue(undefined),
  toDevServerHealthStatus: vi.fn(),
}));

// Build a db mock that mimics drizzle's chainable select() returning
// pre-canned rows per "first table" hit. We resolve the chain when
// .then() is called (every drizzle terminal awaits resolves the chain).
function makeDb(rows: {
  plugins?: Array<{ pluginKey: string; status: string }>;
  agentsCount?: number;
  companies?: Array<{ id: string; isTest: boolean }>;
  agentsByCompany?: Array<{ companyId: string; count: number }>;
  instanceAdminCount?: number;
}) {
  // The order in which collectNeocompanyHealth invokes select() is:
  //   1. plugins (with where inArray)
  //   2. agents (count)
  //   3. companies (id, isTest)
  //   4. agents grouped by companyId (only when there ARE test companies)
  //
  // Each select() returns a chainable that ultimately resolves to the rows.
  // We track the call sequence and dispatch via the queried column shape.
  const planning: Array<unknown> = [];
  const plugins = rows.plugins ?? [];
  const agentsCount = rows.agentsCount ?? 0;
  const companies = rows.companies ?? [];
  const agentsByCompany = rows.agentsByCompany ?? [];
  const instanceAdminCount = rows.instanceAdminCount ?? 1;

  function chain(result: unknown) {
    const target: Record<string, unknown> = {};
    const handler = {
      get(_t: unknown, prop: string) {
        if (prop === "then") {
          return (resolve: (value: unknown) => unknown) => resolve(result);
        }
        return () => proxy;
      },
    };
    const proxy: Record<string, unknown> = new Proxy(target, handler);
    return proxy;
  }

  const select = vi.fn((shape?: Record<string, unknown>) => {
    planning.push(shape);
    // Detect by the column keys requested.
    const keys = shape ? Object.keys(shape).sort().join(",") : "";

    if (keys === "pluginKey,status") {
      return chain(plugins);
    }
    if (keys === "count") {
      // Could be agents count OR instanceUserRoles count for bootstrap.
      // The plugins.test.ts pattern uses the same mock for both — we
      // dispatch by call order: instanceUserRoles is called first (in
      // the bootstrap branch), then agents.
      // Simpler: return instanceAdminCount on first hit, agentsCount thereafter.
      const callIndex = (planning.length - 1);
      // First "count" query in authenticated mode is the instance_admin
      // role count for bootstrap status. Second is our agents.
      if (callIndex >= 1) {
        return chain([{ count: agentsCount }]);
      }
      return chain([{ count: instanceAdminCount }]);
    }
    if (keys === "id,isTest") {
      return chain(companies);
    }
    if (keys === "companyId,count") {
      return chain(agentsByCompany);
    }
    // Default: empty list
    return chain([]);
  });

  return {
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    select,
  } as unknown as Db;
}

function makeApp(db: Db) {
  const app = express();
  app.use((req, _res, next) => {
    (req as { actor?: { type: string; source: string } }).actor = {
      type: "board",
      source: "session",
    };
    next();
  });
  app.use(
    "/health",
    healthRoutes(db, {
      deploymentMode: "local_trusted",
      deploymentExposure: "private",
      authReady: true,
      companyDeletionEnabled: true,
    }),
  );
  return app;
}

describe("GET /health — neocompany fork stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports health=ok when both fork plugins are ready and test companies have agents", async () => {
    const db = makeDb({
      plugins: [
        { pluginKey: "neocompany-tools", status: "ready" },
        { pluginKey: "paperclip-chat", status: "ready" },
      ],
      agentsCount: 27,
      companies: [
        { id: "real-1", isTest: false },
        { id: "test-1", isTest: true },
      ],
      agentsByCompany: [{ companyId: "test-1", count: 9 }],
    });

    const res = await request(makeApp(db)).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.neocompany).toBeDefined();
    expect(res.body.neocompany.health).toBe("ok");
    expect(res.body.neocompany.warnings).toEqual([]);
    expect(res.body.neocompany.pluginsExpected).toBe(2);
    expect(res.body.neocompany.pluginsReady).toBe(2);
    expect(res.body.neocompany.agentsTotal).toBe(27);
    expect(res.body.neocompany.companiesTotal).toBe(2);
    expect(res.body.neocompany.testCompaniesTotal).toBe(1);
    expect(res.body.neocompany.testCompaniesMissingAgents).toBe(0);
  });

  it("reports degraded when a fork plugin is not ready", async () => {
    const db = makeDb({
      plugins: [
        { pluginKey: "neocompany-tools", status: "ready" },
        { pluginKey: "paperclip-chat", status: "installed" },
      ],
      agentsCount: 9,
      companies: [],
      agentsByCompany: [],
    });

    const res = await request(makeApp(db)).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.neocompany.health).toBe("degraded");
    expect(res.body.neocompany.pluginsReady).toBe(1);
    expect(res.body.neocompany.warnings).toContainEqual(
      expect.stringContaining("expected 2 fork plugins ready, got 1"),
    );
  });

  it("reports degraded with the seed-agents warning when test companies lack agents", async () => {
    const db = makeDb({
      plugins: [
        { pluginKey: "neocompany-tools", status: "ready" },
        { pluginKey: "paperclip-chat", status: "ready" },
      ],
      agentsCount: 9,
      companies: [
        { id: "real-1", isTest: false },
        { id: "test-1", isTest: true },
        { id: "test-2", isTest: true },
        { id: "test-3", isTest: true },
      ],
      agentsByCompany: [], // ← none of the test companies have agents
    });

    const res = await request(makeApp(db)).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.neocompany.health).toBe("degraded");
    expect(res.body.neocompany.testCompaniesMissingAgents).toBe(3);
    expect(res.body.neocompany.warnings).toContainEqual(
      expect.stringContaining("3 test companies have no seeded agents"),
    );
  });

  it("does NOT include neocompany section when actor is anonymous in authenticated mode", async () => {
    const db = makeDb({
      plugins: [],
      agentsCount: 0,
      companies: [],
      agentsByCompany: [],
    });
    const app = express();
    app.use((req, _res, next) => {
      (req as { actor?: { type: string; source: string } }).actor = {
        type: "none",
        source: "none",
      };
      next();
    });
    app.use(
      "/health",
      healthRoutes(db, {
        deploymentMode: "authenticated",
        deploymentExposure: "public",
        authReady: true,
        companyDeletionEnabled: false,
      }),
    );

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    // Redacted public payload — fork stats must NOT leak.
    expect(res.body.neocompany).toBeUndefined();
    expect(res.body).toEqual({
      status: "ok",
      deploymentMode: "authenticated",
      bootstrapStatus: "ready",
      bootstrapInviteActive: false,
    });
  });
});
