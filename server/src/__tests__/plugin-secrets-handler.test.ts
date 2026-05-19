import { describe, expect, it, vi } from "vitest";
import { createPluginSecretsHandler } from "../services/plugin-secrets-handler.js";

//// Neocompany Modification — the handler is no longer a stub. We feed it
//// a minimal `db` mock that exposes `select(...).from(...).where(...).limit(...)`
//// returning the rows we want — that's how Drizzle queries are shaped.
//// End Neocompany Modification

function makeDbMock(rows: Array<{ companyId: string }>) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => rows,
        }),
      }),
    }),
  } as never;
}

// Stub the secretService used inside the handler so the test doesn't need
// the whole secret provider stack. We hijack the module side-effect via
// vi.mock, intercepting `resolveSecretValue` to confirm wiring + delegation.
vi.mock("../services/secrets.js", () => ({
  secretService: () => ({
    resolveSecretValue: async (companyId: string, secretId: string) =>
      `resolved(${companyId},${secretId})`,
  }),
}));

describe("createPluginSecretsHandler", () => {
  it("rejects malformed secret refs before doing any lookup", async () => {
    const handler = createPluginSecretsHandler({
      db: makeDbMock([]),
      pluginId: "11111111-1111-4111-8111-111111111111",
    });
    await expect(
      handler.resolve({ secretRef: "not-a-uuid" }),
    ).rejects.toThrow(/invalid secret reference/i);
  });

  it("rejects empty refs", async () => {
    const handler = createPluginSecretsHandler({
      db: makeDbMock([]),
      pluginId: "11111111-1111-4111-8111-111111111111",
    });
    await expect(handler.resolve({ secretRef: "" })).rejects.toThrow(/invalid secret reference/i);
  });

  it("returns generic error when the UUID is not found in company_secrets", async () => {
    const handler = createPluginSecretsHandler({
      db: makeDbMock([]),
      pluginId: "11111111-1111-4111-8111-111111111111",
    });
    await expect(
      handler.resolve({ secretRef: "77777777-7777-4777-8777-777777777777" }),
    ).rejects.toThrow(/secret not found/i);
  });

  it("resolves the value via secretService when the company_secrets row exists", async () => {
    const handler = createPluginSecretsHandler({
      db: makeDbMock([{ companyId: "co-42" }]),
      pluginId: "11111111-1111-4111-8111-111111111111",
    });
    const value = await handler.resolve({
      secretRef: "77777777-7777-4777-8777-777777777777",
    });
    expect(value).toBe("resolved(co-42,77777777-7777-4777-8777-777777777777)");
  });
});
