//// Neocompany Modification — tests for emailReadMessage
//// End Neocompany Modification

import { describe, expect, it } from "vitest";
import { runEmailReadMessage } from "./inbox-read.js";
import {
  makeRunCtx,
  makeEntitiesStore,
  makePluginContext,
} from "../../__tests__/test-helpers.js";

async function seedEmail(
  entities: ReturnType<typeof makeEntitiesStore>,
  runCtx: { companyId: string },
  opts: { externalId: string; bodyText?: string; bodyHtml?: string },
) {
  await entities.upsert({
    entityType: "incoming_email",
    scopeKind: "company",
    scopeId: runCtx.companyId,
    externalId: opts.externalId,
    title: "subj",
    data: {
      accountId: "acct-1",
      fromAddress: "alice@example.com",
      fromName: "Alice",
      toAddress: "neo@neoservice.ai",
      subject: "subj",
      receivedAt: "2026-05-11T08:00:00Z",
      status: "pending",
      bodyText: opts.bodyText,
      bodyHtml: opts.bodyHtml,
    },
  });
}

describe("runEmailReadMessage", () => {
  it("requires an id", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const result = await runEmailReadMessage(ctx, { id: "" }, makeRunCtx());
    expect(result.error).toMatch(/required/);
  });

  it("returns the email body and metadata", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const runCtx = makeRunCtx();

    await seedEmail(entities, runCtx, {
      externalId: "e1",
      bodyText: "Hello, this is a test message.",
    });

    const [record] = [...entities.records.values()];
    const result = await runEmailReadMessage(ctx, { id: record.id }, runCtx);
    expect(result.error).toBeUndefined();
    const data = result.data as { subject: string; from: string; bodyText: string };
    expect(data.from).toBe("alice@example.com");
    expect(data.subject).toBe("subj");
    expect(data.bodyText).toBe("Hello, this is a test message.");
    expect(result.content).toMatch(/Hello, this is a test message/);
    expect(result.content).toMatch(/From: Alice <alice@example.com>/);
  });

  it("falls back to bodyHtml when bodyText is missing", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const runCtx = makeRunCtx();
    await seedEmail(entities, runCtx, {
      externalId: "e1",
      bodyHtml: "<p>HTML body</p>",
    });
    const [record] = [...entities.records.values()];
    const result = await runEmailReadMessage(ctx, { id: record.id }, runCtx);
    expect(result.content).toMatch(/<p>HTML body<\/p>/);
  });

  it("shows '(empty body)' when both bodyText and bodyHtml are absent", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const runCtx = makeRunCtx();
    await seedEmail(entities, runCtx, { externalId: "e1" });
    const [record] = [...entities.records.values()];
    const result = await runEmailReadMessage(ctx, { id: record.id }, runCtx);
    expect(result.content).toMatch(/\(empty body\)/);
  });

  it("returns clear error when id is unknown", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const runCtx = makeRunCtx();
    const result = await runEmailReadMessage(ctx, { id: "ghost" }, runCtx);
    expect(result.error).toMatch(/not found/);
  });

  it("scopes lookup to the caller's company (cross-tenant isolation)", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });

    // Same UUID id in company A vs company B (synthetic — the mock UUIDs are
    // sequential so we craft this by upserting in a specific order).
    await entities.upsert({
      entityType: "incoming_email",
      scopeKind: "company",
      scopeId: "company-A",
      externalId: "shared",
      data: { accountId: "1", fromAddress: "a@a", toAddress: "b@b", subject: "A", receivedAt: "2026-01-01T00:00:00Z", status: "pending" },
    });

    // List from company B should not find anything.
    const result = await runEmailReadMessage(ctx, { id: "entity-1" }, makeRunCtx({ companyId: "company-B" }));
    expect(result.error).toMatch(/not found/);
  });
});
