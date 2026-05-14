//// Neocompany Modification — test for the Hermes per-(company,user,agent) memory isolation
//// This test file does not exist upstream. It pins resolveHermesHome's path
//// shape, the _system fallback, the sanitization guard, and the
//// isolation-disabled no-op. Drop together with hermes-isolated-agents.ts if
//// the fork ever stops using the hermes_local adapter.
//// End Neocompany Modification

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveHermesHome,
  ensureHermesHome,
  hermesIsolationEnabled,
  hermesHomeRoot,
  HERMES_SYSTEM_USER_BUCKET,
} from "../services/hermes-isolated-agents.js";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const AGENT = "33333333-3333-4333-8333-333333333333";

describe("hermes-isolated-agents", () => {
  let prevIsolated: string | undefined;
  let prevRoot: string | undefined;
  let tmpRoot: string;

  beforeEach(() => {
    prevIsolated = process.env.PAPERCLIP_HERMES_ISOLATED;
    prevRoot = process.env.PAPERCLIP_HERMES_HOME_ROOT;
    tmpRoot = mkdtempSync(join(tmpdir(), "hermes-iso-"));
    process.env.PAPERCLIP_HERMES_HOME_ROOT = tmpRoot;
  });

  afterEach(() => {
    if (prevIsolated === undefined) delete process.env.PAPERCLIP_HERMES_ISOLATED;
    else process.env.PAPERCLIP_HERMES_ISOLATED = prevIsolated;
    if (prevRoot === undefined) delete process.env.PAPERCLIP_HERMES_HOME_ROOT;
    else process.env.PAPERCLIP_HERMES_HOME_ROOT = prevRoot;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("isolation disabled (default)", () => {
    it("resolveHermesHome returns null when PAPERCLIP_HERMES_ISOLATED is unset", () => {
      delete process.env.PAPERCLIP_HERMES_ISOLATED;
      expect(hermesIsolationEnabled()).toBe(false);
      expect(resolveHermesHome(COMPANY, USER, AGENT)).toBeNull();
    });

    it("ensureHermesHome is a no-op returning null when disabled", async () => {
      delete process.env.PAPERCLIP_HERMES_ISOLATED;
      const result = await ensureHermesHome(COMPANY, USER, AGENT);
      expect(result).toBeNull();
    });
  });

  describe("isolation enabled", () => {
    beforeEach(() => {
      process.env.PAPERCLIP_HERMES_ISOLATED = "1";
    });

    it("resolves a 3-level path: <root>/{company}/{user}/{agent}", () => {
      const home = resolveHermesHome(COMPANY, USER, AGENT);
      expect(home).toBe(join(tmpRoot, COMPANY, USER, AGENT));
    });

    it("falls back to the _system bucket when userId is null", () => {
      const home = resolveHermesHome(COMPANY, null, AGENT);
      expect(home).toBe(join(tmpRoot, COMPANY, HERMES_SYSTEM_USER_BUCKET, AGENT));
    });

    it("falls back to _system when userId is an empty / whitespace string", () => {
      expect(resolveHermesHome(COMPANY, "", AGENT)).toBe(
        join(tmpRoot, COMPANY, HERMES_SYSTEM_USER_BUCKET, AGENT),
      );
      expect(resolveHermesHome(COMPANY, "   ", AGENT)).toBe(
        join(tmpRoot, COMPANY, HERMES_SYSTEM_USER_BUCKET, AGENT),
      );
    });

    it("two different users on the same company+agent get distinct homes", () => {
      const a = resolveHermesHome(COMPANY, "user-a", AGENT);
      const b = resolveHermesHome(COMPANY, "user-b", AGENT);
      expect(a).not.toBe(b);
      expect(a).toContain("/user-a/");
      expect(b).toContain("/user-b/");
    });

    it("two different companies never share a path prefix", () => {
      const a = resolveHermesHome("company-a", USER, AGENT);
      const b = resolveHermesHome("company-b", USER, AGENT);
      expect(a!.startsWith(join(tmpRoot, "company-a"))).toBe(true);
      expect(b!.startsWith(join(tmpRoot, "company-b"))).toBe(true);
    });

    it("sanitizes path-traversal attempts so a malformed id can't escape the root", () => {
      const home = resolveHermesHome(COMPANY, "../../etc", AGENT);
      // The `..` and `/` are replaced with `_`; the result stays under tmpRoot.
      expect(home!.startsWith(tmpRoot)).toBe(true);
      expect(home).not.toContain("..");
    });

    it("rejects an id that sanitizes to an empty / underscore-only segment", () => {
      expect(() => resolveHermesHome(COMPANY, USER, "..")).toThrow(/invalid agentId/);
      expect(() => resolveHermesHome("", USER, AGENT)).toThrow(/invalid companyId/);
    });

    it("ensureHermesHome creates the dir + memories/ subdir on disk", async () => {
      const home = await ensureHermesHome(COMPANY, USER, AGENT);
      expect(home).toBe(join(tmpRoot, COMPANY, USER, AGENT));
      expect(existsSync(home!)).toBe(true);
      expect(existsSync(join(home!, "memories"))).toBe(true);
    });

    it("ensureHermesHome is idempotent (second call does not throw)", async () => {
      await ensureHermesHome(COMPANY, USER, AGENT);
      const second = await ensureHermesHome(COMPANY, USER, AGENT);
      expect(existsSync(join(second!, "memories"))).toBe(true);
    });
  });

  describe("hermesHomeRoot", () => {
    it("honours PAPERCLIP_HERMES_HOME_ROOT", () => {
      process.env.PAPERCLIP_HERMES_HOME_ROOT = "/custom/hermes/root";
      expect(hermesHomeRoot()).toBe("/custom/hermes/root");
    });

    it("defaults to /var/lib/paperclip/hermes when unset", () => {
      delete process.env.PAPERCLIP_HERMES_HOME_ROOT;
      expect(hermesHomeRoot()).toBe("/var/lib/paperclip/hermes");
    });
  });
});
