//// Neoffice Modification: sprint-j-fixes-regression-tests
//// Why: NORA Sprint K Phase 0b (2026-05-19) — lock in the three plugin-side
////      behavioural changes from Sprint J so a future upstream merge or
////      refactor can't silently re-break them:
////        1. resolveCompanyId() falls back to runCtx.companyId when the LLM
////           sends "default" (or any non-UUID) in params.companyId
////        2. wiki_read_page rejects paths that don't start with "wiki/"
////        3. wiki_read_source rejects paths that don't start with "raw/"
////      All three faults previously surfaced as bewildering 500s because the
////      LLM couldn't tell from the tool descriptions what path prefix to
////      pick — the manifest was tightened (commit «docs(plugin-llm-wiki):
////      tighten path conventions…») and resolveCompanyId was introduced
////      (commit 5d8092af). These tests exercise the same code paths through
////      the SDK test harness so the contract is enforced for every CI run.
//// Date: 2026-05-19
//// Refs: NORA Sprint K Phase 0b, [[swirling-humming-lerdorf]]

import { beforeEach, describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import plugin from "../src/worker.js";
import manifest from "../src/manifest.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const WIKI_ROOT = "/tmp/sprint-j-fixes-wiki";

type Harness = ReturnType<typeof createTestHarness>;

async function setupHarness(): Promise<Harness> {
  const harness = createTestHarness({ manifest });
  // Stub localFolders writer so setup + bootstrap don't touch real disk.
  // Storage is in-memory only — the assertions below don't read it back,
  // they only care about which error / success the handler returns.
  const writtenPaths = new Map<string, string>();
  harness.ctx.localFolders.writeTextAtomic = async (_companyId, _folderKey, relativePath, contents) => {
    writtenPaths.set(relativePath, contents);
    return harness.ctx.localFolders.status(COMPANY_ID, "wiki-root");
  };
  harness.ctx.localFolders.readText = async (_companyId, _folderKey, relativePath) => {
    const value = writtenPaths.get(relativePath);
    if (value === undefined) {
      const err = new Error(`ENOENT: no such file or directory, open '${relativePath}'`);
      (err as unknown as { code: string }).code = "ENOENT";
      throw err;
    }
    return value;
  };
  await plugin.definition.setup(harness.ctx);
  // Bootstrap default space so resolveSpace() succeeds in the wiki tools.
  await harness.performAction("bootstrap-root", { companyId: COMPANY_ID, path: WIKI_ROOT });
  return harness;
}

describe("Sprint J fixes — regression contract", () => {
  describe("resolveCompanyId() falls back to runCtx.companyId", () => {
    let harness: Harness;
    beforeEach(async () => {
      harness = await setupHarness();
    });

    it("uses params.companyId when it is a valid UUID", async () => {
      const result = await harness.executeTool(
        "wiki_list_sources",
        { companyId: COMPANY_ID, wikiId: "default" },
        { companyId: COMPANY_ID },
      );
      expect((result as { data: { companyId: string } }).data.companyId).toBe(COMPANY_ID);
    });

    it("falls back to runCtx.companyId when params.companyId is 'default' (LLM placeholder)", async () => {
      const result = await harness.executeTool(
        "wiki_list_sources",
        { companyId: "default", wikiId: "default" },
        { companyId: COMPANY_ID },
      );
      // The fallback rewrote 'default' to the runCtx UUID without throwing.
      expect((result as { data: { companyId: string } }).data.companyId).toBe(COMPANY_ID);
    });

    it("throws when neither params nor runCtx carry a valid UUID", async () => {
      await expect(
        harness.executeTool(
          "wiki_list_sources",
          { companyId: "not-a-uuid", wikiId: "default" },
          { companyId: "also-not-a-uuid" },
        ),
      ).rejects.toThrow(/companyId is required/i);
    });
  });

  describe("Path prefix validators (wiki_read_page vs wiki_read_source)", () => {
    let harness: Harness;
    beforeEach(async () => {
      harness = await setupHarness();
    });

    it("wiki_read_page rejects a path that does NOT start with 'wiki/'", async () => {
      await expect(
        harness.executeTool(
          "wiki_read_page",
          { companyId: COMPANY_ID, wikiId: "default", path: "rag_comptabilite_suisse.md" },
          { companyId: COMPANY_ID },
        ),
      ).rejects.toThrow(/Wiki path must stay inside .*wiki\//i);
    });

    it("wiki_read_source rejects a path that does NOT start with 'raw/'", async () => {
      // wiki_read_source uses assertRawPath which requires the 'raw/' prefix.
      // Below path slips through assertPagePath (starts with 'wiki/') but the
      // tool reads from raw/, so the path is rejected by assertRawPath.
      await expect(
        harness.executeTool(
          "wiki_read_source",
          { companyId: COMPANY_ID, wikiId: "default", rawPath: "rag_comptabilite_suisse.md" },
          { companyId: COMPANY_ID },
        ),
      ).rejects.toThrow(/Wiki path must stay inside .*raw\//i);
    });

    it("wiki_write_page rejects a path that does NOT start with 'wiki/'", async () => {
      await expect(
        harness.executeTool(
          "wiki_write_page",
          {
            companyId: COMPANY_ID,
            wikiId: "default",
            path: "rag.md",
            contents: "# stub",
          },
          { companyId: COMPANY_ID },
        ),
      ).rejects.toThrow(/Wiki path must stay inside .*wiki\//i);
    });
  });
});
