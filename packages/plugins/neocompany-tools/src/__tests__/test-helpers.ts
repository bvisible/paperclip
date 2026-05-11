//// Neocompany Modification — shared test fixtures for neocompany-tools tests
//// Reusable factories for ToolRunContext, ToolContextAccess, and a lightweight
//// in-memory entities mock that mimics ctx.entities.{list, upsert, delete}.
//// End Neocompany Modification

import { vi, expect } from "vitest";
import type { ToolRunContext, PluginContext, PluginEntityRecord } from "@paperclipai/plugin-sdk";
import type { ToolContextAccess } from "../tools/index.js";

// ---------------------------------------------------------------------------
// Default ToolRunContext
// ---------------------------------------------------------------------------

export function makeRunCtx(overrides: Partial<ToolRunContext> = {}): ToolRunContext {
  return {
    agentId: "agent-test",
    runId: "run-test",
    companyId: "company-test",
    projectId: "project-test",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// In-memory entities mock — mimics ctx.entities semantics enough to test
// CRUD-style tools (imageList / imageDelete / templateCreate / etc.).
// ---------------------------------------------------------------------------

export function makeEntitiesStore() {
  const records = new Map<string, PluginEntityRecord>();

  function externalKey(r: { entityType: string; scopeKind: string; scopeId: string | null; externalId: string | null }) {
    return `${r.entityType}|${r.scopeKind}|${r.scopeId ?? ""}|${r.externalId ?? ""}`;
  }

  const upsert = vi.fn(async (input: {
    entityType: string;
    scopeKind: string;
    scopeId?: string;
    externalId?: string;
    title?: string;
    status?: string;
    data: Record<string, unknown>;
  }): Promise<PluginEntityRecord> => {
    const key = input.externalId
      ? externalKey({
          entityType: input.entityType,
          scopeKind: input.scopeKind,
          scopeId: input.scopeId ?? null,
          externalId: input.externalId,
        })
      : null;
    const existingId = key
      ? [...records.values()].find((r) => externalKey(r) === key)?.id
      : undefined;
    const now = new Date().toISOString();
    const id = existingId ?? `entity-${records.size + 1}`;
    const record: PluginEntityRecord = {
      id,
      entityType: input.entityType,
      scopeKind: input.scopeKind as PluginEntityRecord["scopeKind"],
      scopeId: input.scopeId ?? null,
      externalId: input.externalId ?? null,
      title: input.title ?? null,
      status: input.status ?? null,
      data: input.data,
      createdAt: existingId ? records.get(existingId)!.createdAt : now,
      updatedAt: now,
    };
    records.set(id, record);
    return record;
  });

  const list = vi.fn(async (query: {
    entityType?: string;
    scopeKind?: string;
    scopeId?: string;
    externalId?: string;
    limit?: number;
    offset?: number;
  }): Promise<PluginEntityRecord[]> => {
    let out = [...records.values()];
    if (query.entityType) out = out.filter((r) => r.entityType === query.entityType);
    if (query.scopeKind) out = out.filter((r) => r.scopeKind === query.scopeKind);
    if (query.scopeId) out = out.filter((r) => r.scopeId === query.scopeId);
    if (query.externalId) out = out.filter((r) => r.externalId === query.externalId);
    if (query.offset) out = out.slice(query.offset);
    if (query.limit) out = out.slice(0, query.limit);
    return out;
  });

  const del = vi.fn(async (input: { id: string }): Promise<PluginEntityRecord | null> => {
    const existing = records.get(input.id);
    if (!existing) return null;
    records.delete(input.id);
    return existing;
  });

  return {
    records,
    upsert,
    list,
    delete: del,
  };
}

// ---------------------------------------------------------------------------
// Activity log mock
// ---------------------------------------------------------------------------

export function makeActivityLog() {
  const calls: Array<{ companyId: string; message: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }> = [];
  return {
    log: vi.fn(async (params: { companyId: string; message: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }) => {
      calls.push(params);
    }),
    calls,
  };
}

// ---------------------------------------------------------------------------
// Minimal PluginContext mock — wires entities + activity + a no-op stub for
// everything else. Tools that touch unmocked sections will throw a clear
// error, which is good — it tells us the test needs additional setup.
// ---------------------------------------------------------------------------

export function makePluginContext(opts: {
  entities?: ReturnType<typeof makeEntitiesStore>;
  activity?: ReturnType<typeof makeActivityLog>;
} = {}): { ctx: PluginContext; entities: ReturnType<typeof makeEntitiesStore>; activity: ReturnType<typeof makeActivityLog>; secrets: ReturnType<typeof vi.fn>; events: { emit: ReturnType<typeof vi.fn> } } {
  const entities = opts.entities ?? makeEntitiesStore();
  const activity = opts.activity ?? makeActivityLog();
  const secrets = vi.fn(async (_ref: string) => "stub-secret-value");
  const eventsEmit = vi.fn(async () => undefined);

  // Cast through unknown because we don't implement the full PluginContext —
  // only the slices our tools actually call. Tests that reach unmocked
  // properties fail with a clear "is not a function" which is the cue to
  // extend this helper.
  const ctx = {
    entities,
    activity,
    secrets: { resolve: secrets },
    events: { emit: eventsEmit, subscribe: vi.fn() },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    metrics: { write: vi.fn() },
    telemetry: { track: vi.fn() },
  } as unknown as PluginContext;

  return { ctx, entities, activity, secrets, events: { emit: eventsEmit } };
}

// ---------------------------------------------------------------------------
// ToolContextAccess factory — mocks all helpers the worker passes to tool
// handlers. Tests pass partial `overrides` to plug only what the tool needs.
// ---------------------------------------------------------------------------

export function makeCtxAccess(overrides: {
  ctx?: PluginContext;
  gsc?: unknown;
  ga4?: unknown;
  emailSend?: unknown;
  pageSpeed?: unknown;
  openPageRank?: unknown;
  wordpress?: unknown;
  toolConfig?: <T>(toolName: string, defaults: T) => T;
} = {}): ToolContextAccess {
  const ctx = overrides.ctx ?? makePluginContext().ctx;
  return {
    getPluginContext: () => ctx,
    getGscConfig: vi.fn(async () => overrides.gsc ?? { siteUrl: "https://example.com", accessToken: "stub" }) as never,
    getGa4Config: vi.fn(async () => overrides.ga4 ?? { propertyId: "0", accessToken: "stub" }) as never,
    getEmailSendConfig: vi.fn(async () => overrides.emailSend ?? { provider: "smtp" }) as never,
    getPageSpeedConfig: vi.fn(async () => overrides.pageSpeed ?? { apiKey: "stub" }) as never,
    getOpenPageRankConfig: vi.fn(async () => overrides.openPageRank ?? { apiKey: "stub" }) as never,
    getWordPressConfig: vi.fn(async () => overrides.wordpress ?? {
      siteUrl: "https://wp.example.com",
      username: "test",
      appPassword: "stub",
    }) as never,
    getToolConfig: vi.fn(async <T,>(_companyId: string, toolName: string, defaults: T): Promise<T> => {
      if (overrides.toolConfig) return overrides.toolConfig(toolName, defaults);
      return defaults;
    }) as never,
  };
}

// ---------------------------------------------------------------------------
// Misc assertions
// ---------------------------------------------------------------------------

/**
 * Asserts the tool returned a ToolResult that is either a clean success
 * (with `content` and no `error`) or an explicit failure with `error`. Used
 * by smoke tests that don't care about the exact payload.
 */
export function expectValidToolResult(result: unknown) {
  expect(result).toBeDefined();
  expect(typeof result).toBe("object");
  expect(result).not.toBeNull();
  const r = result as { content?: string; error?: string };
  // Either content is a string OR an error code is set.
  const hasContent = typeof r.content === "string";
  const hasError = typeof r.error === "string";
  expect(hasContent || hasError).toBe(true);
}
