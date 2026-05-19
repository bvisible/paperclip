//// Neocompany Modification — multi-tenant isolation regression test
//// Pins the fix for the bug discovered 2026-05-19 where
//// registry.listEntities ignored scopeKind and scopeId, leaking
//// brand_template / library_image / approval / calendar rows across
//// every tenant on the instance. Reed Blake users were seeing the
//// Neoservice templates and vice versa. Without these tests it would
//// be easy for a future refactor to drop the filter again silently.
//// End Neocompany Modification

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
  pluginEntities,
  plugins,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { pluginRegistryService } from "../services/plugin-registry.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping plugin-registry listEntities scope tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("plugin-registry.listEntities — scope filtering", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-list-entities-scope-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(pluginEntities);
    await db.delete(plugins);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed() {
    const pluginId = randomUUID();
    const reedCompanyId = randomUUID();
    const neoCompanyId = randomUUID();
    await db.insert(companies).values([
      { id: reedCompanyId, name: "Reed Blake", issuePrefix: "REE" },
      { id: neoCompanyId, name: "Neoservice", issuePrefix: "NEO" },
    ]);
    await db.insert(plugins).values({
      id: pluginId,
      pluginKey: "paperclip.list-entities-scope-test",
      packageName: "@paperclipai/plugin-list-entities-scope-test",
      version: "0.1.0",
      apiVersion: 1,
      categories: ["automation"],
      manifestJson: {} as never,
      status: "ready",
      installOrder: 1,
    });
    await db.insert(pluginEntities).values([
      {
        id: randomUUID(),
        pluginId,
        entityType: "brand_template",
        scopeKind: "company",
        scopeId: reedCompanyId,
        externalId: "reed-tmpl-1",
        title: "Reed template",
        data: {},
      },
      {
        id: randomUUID(),
        pluginId,
        entityType: "brand_template",
        scopeKind: "company",
        scopeId: neoCompanyId,
        externalId: "neo-tmpl-1",
        title: "Neoservice template",
        data: {},
      },
      {
        id: randomUUID(),
        pluginId,
        entityType: "library_image",
        scopeKind: "company",
        scopeId: neoCompanyId,
        externalId: "neo-img-1",
        title: "Neo image",
        data: {},
      },
    ]);
    return { pluginId, reedCompanyId, neoCompanyId };
  }

  it("returns only the rows that match the requested scope (per-tenant isolation)", async () => {
    const { pluginId, reedCompanyId, neoCompanyId } = await seed();
    const registry = pluginRegistryService(db);

    const reedTemplates = await registry.listEntities(pluginId, {
      entityType: "brand_template",
      scopeKind: "company",
      scopeId: reedCompanyId,
    });
    expect(reedTemplates.map((r) => r.title)).toEqual(["Reed template"]);

    const neoTemplates = await registry.listEntities(pluginId, {
      entityType: "brand_template",
      scopeKind: "company",
      scopeId: neoCompanyId,
    });
    expect(neoTemplates.map((r) => r.title)).toEqual(["Neoservice template"]);
  });

  it("combines entityType and scope filters so other entity types in the same scope are not returned", async () => {
    const { pluginId, neoCompanyId } = await seed();
    const registry = pluginRegistryService(db);

    const onlyTemplates = await registry.listEntities(pluginId, {
      entityType: "brand_template",
      scopeKind: "company",
      scopeId: neoCompanyId,
    });
    expect(onlyTemplates.map((r) => r.entityType)).toEqual(["brand_template"]);
  });

  it("returns all rows when no scope filter is supplied (admin/migration path)", async () => {
    const { pluginId } = await seed();
    const registry = pluginRegistryService(db);

    const all = await registry.listEntities(pluginId, { entityType: "brand_template" });
    expect(all.map((r) => r.title).sort()).toEqual(["Neoservice template", "Reed template"]);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Per-entity-type isolation matrix
  //
  // Each row of the matrix below is a real entity type used by the
  // neocompany-tools plugin in production (cf. packages/plugins/
  // neocompany-tools/src/{templates,images,social,email}/types.ts). The
  // generated test pins that listEntities returns only the matching
  // company's row when both companies have one. Adding a new content
  // surface? Add its entity type here and you get the isolation guarantee
  // for free.
  // ─────────────────────────────────────────────────────────────────────
  const CONTENT_ENTITY_TYPES = [
    { entityType: "brand_template", surface: "Content > Templates" },
    { entityType: "generated_image", surface: "Content > Image library" },
    { entityType: "editorial_strategy", surface: "Content > Strategy" },
    { entityType: "social_post", surface: "Content > Calendar / Approvals" },
    { entityType: "email_account", surface: "Channels (email)" },
    { entityType: "incoming_email", surface: "Channels (email inbox)" },
  ] as const;

  async function seedTwoRowsOfType(entityType: string) {
    const pluginId = randomUUID();
    const reedCompanyId = randomUUID();
    const neoCompanyId = randomUUID();
    await db.insert(companies).values([
      { id: reedCompanyId, name: "Reed Blake", issuePrefix: "REE" },
      { id: neoCompanyId, name: "Neoservice", issuePrefix: "NEO" },
    ]);
    await db.insert(plugins).values({
      id: pluginId,
      pluginKey: `paperclip.iso-${entityType}-test`,
      packageName: `@paperclipai/plugin-iso-${entityType}-test`,
      version: "0.1.0",
      apiVersion: 1,
      categories: ["automation"],
      manifestJson: {} as never,
      status: "ready",
      installOrder: 1,
    });
    await db.insert(pluginEntities).values([
      {
        id: randomUUID(),
        pluginId,
        entityType,
        scopeKind: "company",
        scopeId: reedCompanyId,
        externalId: `reed-${entityType}-1`,
        title: `Reed ${entityType}`,
        data: {},
      },
      {
        id: randomUUID(),
        pluginId,
        entityType,
        scopeKind: "company",
        scopeId: neoCompanyId,
        externalId: `neo-${entityType}-1`,
        title: `Neo ${entityType}`,
        data: {},
      },
    ]);
    return { pluginId, reedCompanyId, neoCompanyId };
  }

  describe("content surface isolation matrix", () => {
    for (const { entityType, surface } of CONTENT_ENTITY_TYPES) {
      it(`${entityType} (${surface}) does not leak across tenants`, async () => {
        const { pluginId, reedCompanyId, neoCompanyId } = await seedTwoRowsOfType(entityType);
        const registry = pluginRegistryService(db);

        const reedRows = await registry.listEntities(pluginId, {
          entityType,
          scopeKind: "company",
          scopeId: reedCompanyId,
        });
        expect(reedRows.map((r) => r.title)).toEqual([`Reed ${entityType}`]);
        expect(reedRows.every((r) => r.scopeId === reedCompanyId)).toBe(true);

        const neoRows = await registry.listEntities(pluginId, {
          entityType,
          scopeKind: "company",
          scopeId: neoCompanyId,
        });
        expect(neoRows.map((r) => r.title)).toEqual([`Neo ${entityType}`]);
        expect(neoRows.every((r) => r.scopeId === neoCompanyId)).toBe(true);
      });
    }
  });
});
