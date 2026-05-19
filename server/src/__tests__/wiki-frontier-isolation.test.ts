//// Neoffice Modification: sprint-l-frontier-memoire-wiki-tests-vitest
//// Why: NORA Sprint L (2026-05-19) — source-level companions to the
////      Python tests in nora/tests/suite_memory.py that prove the
////      memory-vs-wiki frontier. These tests are intentionally
////      static-source checks (no Frappe, no Postgres, no SSH) so they
////      can run in any CI environment that has the paperclip-nora
////      repo checked out.
////
////      They prove three things:
////        (1) The wiki_sync.py client classifies tier C paths as
////            non-shareable (mirrors `wiki_classify_path_tier_c_rejected`
////            in suite_memory.py, but checks the source code directly)
////        (2) The api/wiki_pages.py server validator lists every tier C
////            subdirectory in its rejected set (defence in depth)
////        (3) The Hindsight client points at loopback in the source —
////            no cross-instance URL hardcoded anywhere
////
//// Date: 2026-05-19
//// Refs: NORA Sprint L Phase C, [[NORA/36-llm-wiki-poc/09-frontiere-memoire-savoir]]

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const NORA_REPO = "/Users/jeremy/GitHub/nora";
const DEVOPS_REPO = "/Users/jeremy/GitHub/neoffice-devops";

function readIfPresent(absPath: string): string | null {
  if (!existsSync(absPath)) return null;
  return readFileSync(absPath, "utf8");
}

describe("Sprint L — frontière mémoire/wiki (source-level)", () => {
  describe("Axe A — Hindsight reste loopback", () => {
    it("HindsightClient.DEFAULT_BASE_URL is loopback in the source", () => {
      const src = readIfPresent(
        path.join(NORA_REPO, "nora/integrations/hindsight/client.py"),
      );
      if (!src) {
        // CI without the nora repo checked out — skip with a clear message.
        console.warn("[skip] /Users/jeremy/GitHub/nora not present");
        return;
      }
      // Locate the constant and ensure it's loopback
      const match = src.match(/DEFAULT_BASE_URL\s*=\s*"(http:\/\/[^"]+)"/);
      expect(match, "DEFAULT_BASE_URL constant must exist in client.py").not.toBeNull();
      const url = match![1];
      expect(url).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):/);
    });

    it("no cross-instance hostname is hardcoded in hindsight client", () => {
      const src = readIfPresent(
        path.join(NORA_REPO, "nora/integrations/hindsight/client.py"),
      );
      if (!src) return;
      expect(src).not.toMatch(/neoservice\.neoffice\.me/);
      expect(src).not.toMatch(/\.noraai\.ch/);
    });
  });

  describe("Axe B — wiki_sync client rejects tier C", () => {
    it("_classify_path source lists all tier C directories as non-shareable", () => {
      const src = readIfPresent(
        path.join(NORA_REPO, "nora/integrations/neoservice_sync/wiki_sync.py"),
      );
      if (!src) return;
      // The TIER_C_DIRECTORIES tuple. The naive regex `\(([^)]+)\)` is wrong
      // because inline comments may contain parentheses (e.g.
      // `# ERP snapshots (plan comptable, clients clés)`). Match from the
      // tuple opener up to the next `)` that sits on its own line — the
      // closing paren of a Python tuple-literal pattern.
      const start = src.indexOf("TIER_C_DIRECTORIES = (");
      expect(start, "TIER_C_DIRECTORIES tuple must exist").toBeGreaterThan(-1);
      const closing = src.indexOf("\n)", start);
      expect(closing, "tuple closing paren on its own line must exist").toBeGreaterThan(start);
      const tierCBody = src.slice(start, closing);
      for (const required of [
        "wiki/synthesis",
        "wiki/projects",
        "wiki/folds",
        "wiki/canvases",
        "wiki/meta",
      ]) {
        expect(tierCBody, `tier C tuple must contain "${required}"`).toContain(required);
      }
    });

    it("PROTECTED_LOCAL_FILES lists AGENTS.md, IDEA.md, wiki/index.md, wiki/log.md", () => {
      const src = readIfPresent(
        path.join(NORA_REPO, "nora/integrations/neoservice_sync/wiki_sync.py"),
      );
      if (!src) return;
      const match = src.match(/PROTECTED_LOCAL_FILES\s*=\s*frozenset\(\{([^}]+)\}\)/s);
      expect(match, "PROTECTED_LOCAL_FILES must exist").not.toBeNull();
      const body = match![1];
      for (const required of ["AGENTS.md", "IDEA.md", "wiki/index.md", "wiki/log.md"]) {
        expect(body, `protected files must include "${required}"`).toContain(required);
      }
    });
  });

  describe("Axe B-bis — wiki_pages.py server validator", () => {
    it("REJECTED_PATHS on the server side lists tier C + control files", () => {
      const src = readIfPresent(
        path.join(DEVOPS_REPO, "neoffice_devops/api/wiki_pages.py"),
      );
      if (!src) return;
      const start = src.indexOf("REJECTED_PATHS = (");
      expect(start, "REJECTED_PATHS tuple must exist on the server").toBeGreaterThan(-1);
      const closing = src.indexOf("\n)", start);
      expect(closing).toBeGreaterThan(start);
      const body = src.slice(start, closing);
      for (const required of [
        "wiki/synthesis/",
        "wiki/projects/",
        "wiki/folds/",
        "wiki/canvases/",
        "wiki/meta/",
        "AGENTS.md",
        "IDEA.md",
      ]) {
        expect(body, `server REJECTED_PATHS must contain "${required}"`).toContain(required);
      }
    });

    it("ACCEPTABLE_TIER_B_PATHS lists exactly concepts/sources/entities (no synthesis)", () => {
      const src = readIfPresent(
        path.join(DEVOPS_REPO, "neoffice_devops/api/wiki_pages.py"),
      );
      if (!src) return;
      const start = src.indexOf("ACCEPTABLE_TIER_B_PATHS = (");
      expect(start).toBeGreaterThan(-1);
      const closing = src.indexOf("\n)", start);
      expect(closing).toBeGreaterThan(start);
      const body = src.slice(start, closing);
      expect(body).toContain("wiki/concepts/");
      expect(body).toContain("wiki/sources/");
      expect(body).toContain("wiki/entities/");
      // critical: synthesis is NOT in the acceptable list
      expect(body).not.toContain("wiki/synthesis/");
    });
  });

  describe("Axe — collective_sync is the only Hindsight cross-instance pipeline", () => {
    it("scheduled_collective_sync exists in collective_sync.py (will be cut Phase D)", () => {
      const src = readIfPresent(
        path.join(NORA_REPO, "nora/integrations/neoservice_sync/collective_sync.py"),
      );
      if (!src) return;
      expect(src).toMatch(/def\s+scheduled_collective_sync\b/);
    });

    it("no other module schedules cross-instance Hindsight push besides collective_sync", () => {
      const src = readIfPresent(path.join(NORA_REPO, "nora/hooks.py"));
      if (!src) return;
      // grep all scheduler entries containing "neoservice_sync"
      const matches = src.match(/nora\.integrations\.neoservice_sync\.[a-z_]+\.(?:scheduled_|run_)\w+/g) || [];
      // After Phase D, only wiki_sync.scheduled_wiki_sync should remain active.
      // Before Phase D, collective_sync.scheduled_collective_sync is also there.
      // Either way: NO other module should appear.
      const unique = new Set(matches.map((m) => m.split(".").slice(0, 4).join(".")));
      for (const mod of unique) {
        expect(
          ["nora.integrations.neoservice_sync.collective_sync", "nora.integrations.neoservice_sync.wiki_sync"],
        ).toContain(mod);
      }
    });
  });
});
