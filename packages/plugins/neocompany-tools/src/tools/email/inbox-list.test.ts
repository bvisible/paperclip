//// Neocompany Modification — tests for emailListMessages (entity-backed)
//// End Neocompany Modification

import { describe, expect, it } from "vitest";
import { runEmailListMessages } from "./inbox-list.js";
import {
  makeRunCtx,
  makeEntitiesStore,
  makePluginContext,
} from "../../__tests__/test-helpers.js";

async function seedEmail(
  entities: ReturnType<typeof makeEntitiesStore>,
  runCtx: { companyId: string },
  opts: {
    externalId: string;
    from: string;
    fromName?: string;
    subject: string;
    receivedAt: string;
    status?: "pending" | "processed" | "ignored";
    accountId?: string;
  },
) {
  await entities.upsert({
    entityType: "incoming_email",
    scopeKind: "company",
    scopeId: runCtx.companyId,
    externalId: opts.externalId,
    title: opts.subject,
    status: opts.status ?? "pending",
    data: {
      accountId: opts.accountId ?? "acct-1",
      fromAddress: opts.from,
      fromName: opts.fromName,
      toAddress: "support@example.com",
      subject: opts.subject,
      receivedAt: opts.receivedAt,
      status: opts.status ?? "pending",
    },
  });
}

describe("runEmailListMessages", () => {
  it("returns 0 emails with friendly message when inbox is empty", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });

    const result = await runEmailListMessages(ctx, {}, makeRunCtx());
    expect(result.error).toBeUndefined();
    const data = result.data as { count: number; messages: unknown[] };
    expect(data.count).toBe(0);
    expect(result.content).toMatch(/No incoming emails/);
  });

  it("returns all emails sorted by receivedAt descending", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const runCtx = makeRunCtx();

    await seedEmail(entities, runCtx, {
      externalId: "e1",
      from: "alice@example.com",
      subject: "Hello",
      receivedAt: "2026-05-10T08:00:00Z",
    });
    await seedEmail(entities, runCtx, {
      externalId: "e2",
      from: "bob@example.com",
      subject: "Newer",
      receivedAt: "2026-05-11T08:00:00Z",
    });

    const result = await runEmailListMessages(ctx, {}, runCtx);
    const data = result.data as { count: number; messages: Array<{ subject: string }> };
    expect(data.count).toBe(2);
    expect(data.messages[0].subject).toBe("Newer");
    expect(data.messages[1].subject).toBe("Hello");
  });

  it("filters by status (pending / processed / ignored)", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const runCtx = makeRunCtx();

    await seedEmail(entities, runCtx, {
      externalId: "e1",
      from: "a@example.com",
      subject: "A",
      receivedAt: "2026-05-10T08:00:00Z",
      status: "pending",
    });
    await seedEmail(entities, runCtx, {
      externalId: "e2",
      from: "b@example.com",
      subject: "B",
      receivedAt: "2026-05-11T08:00:00Z",
      status: "processed",
    });

    const result = await runEmailListMessages(ctx, { status: "processed" }, runCtx);
    const data = result.data as { messages: Array<{ status: string; subject: string }> };
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].subject).toBe("B");
  });

  it("status='any' returns everything", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const runCtx = makeRunCtx();

    await seedEmail(entities, runCtx, { externalId: "a", from: "a@x.com", subject: "A", receivedAt: "2026-05-10T00:00:00Z", status: "pending" });
    await seedEmail(entities, runCtx, { externalId: "b", from: "b@x.com", subject: "B", receivedAt: "2026-05-10T01:00:00Z", status: "ignored" });

    const result = await runEmailListMessages(ctx, { status: "any" }, runCtx);
    const data = result.data as { count: number };
    expect(data.count).toBe(2);
  });

  it("filters by fromAddress substring (case-insensitive)", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const runCtx = makeRunCtx();

    await seedEmail(entities, runCtx, { externalId: "a", from: "alice@example.com", subject: "A", receivedAt: "2026-05-10T00:00:00Z" });
    await seedEmail(entities, runCtx, { externalId: "b", from: "bob@example.com", subject: "B", receivedAt: "2026-05-10T01:00:00Z" });

    const result = await runEmailListMessages(ctx, { fromAddress: "ALICE" }, runCtx);
    const data = result.data as { messages: Array<{ from: string }> };
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].from).toBe("alice@example.com");
  });

  it("clamps limit between 1 and 100", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const runCtx = makeRunCtx();

    const result = await runEmailListMessages(ctx, { limit: 9999 }, runCtx);
    expect(result.error).toBeUndefined();
    // entities.list received limit=100, not 9999.
    expect(entities.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });

  it("renders email summary with status badges", async () => {
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    const runCtx = makeRunCtx();

    await seedEmail(entities, runCtx, {
      externalId: "e1",
      from: "vip@client.com",
      fromName: "VIP Client",
      subject: "Important",
      receivedAt: "2026-05-11T08:00:00Z",
      status: "pending",
    });

    const result = await runEmailListMessages(ctx, {}, runCtx);
    expect(result.content).toMatch(/\[pending\]/);
    expect(result.content).toMatch(/VIP Client/);
    expect(result.content).toMatch(/Important/);
  });
});
