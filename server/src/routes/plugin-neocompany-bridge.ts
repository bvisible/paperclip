/**
 * Super-admin bridge routes for the `neocompany-tools` plugin.
 *
 * The plugin's worker is NOT allowed to write platform-wide configuration
 * (Google OAuth creds, Resend key, Open PageRank key, PSI key, enabled
 * tool allowlist). Those writes go through these routes, which are
 * protected by `assertInstanceAdmin` from `authz.ts`. The worker reads
 * the same keys via `ctx.state.get({scopeKind: "instance", ...})`.
 *
 * Reads of `enabled-tools` and `am-i-admin` are open to any authenticated
 * user — the UI needs them to know what to render.
 *
 * Route mount point: `/api/plugins/neocompany-tools/bridge/...`
 *
 * @see doc/plugins/PLUGIN_SPEC.md §21.3 — `plugin_state` table
 */

import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { pluginRegistryService } from "../services/plugin-registry.js";
import { pluginStateStore } from "../services/plugin-state-store.js";
import { invalidateNeocompanyAllowlistCache } from "../services/plugin-tool-dispatcher.js";
import { assertInstanceAdmin, assertBoard } from "./authz.js";
import { notFound } from "../errors.js";

const PLUGIN_KEY = "neocompany-tools";

/** Only the platform-enabled-tools allowlist lives in plugin_state. The
 *  secret refs + googleClientId + defaultFrom all live in plugin_config
 *  so the plugin-secrets-handler's allowlist extractor picks them up. */
const ENABLED_TOOLS_STATE_KEY = "platform:enabled-tools";

/** Shape the UI + worker expect when reading platform config. */
interface PlatformConfigView {
  googleClientId: string;
  googleClientSecretRef: string | null;
  googleRefreshTokenRef: string | null;
  googlePsiApiKeyRef: string | null;
  openPageRankApiKeyRef: string | null;
  resendApiKeyRef: string | null;
  resendDefaultFrom: string;
}

function createPlatformConfigRoutes(db: Db): Router {
  const router = Router();
  const stateStore = pluginStateStore(db);
  const registry = pluginRegistryService(db);

  async function resolvePluginId(): Promise<string> {
    const plugin = await registry.getByKey(PLUGIN_KEY);
    if (!plugin) throw notFound(`Plugin "${PLUGIN_KEY}" not installed`);
    return plugin.id;
  }

  // -----------------------------------------------------------------------
  // GET /bridge/am-i-admin — simple admin probe for the UI
  // -----------------------------------------------------------------------

  router.get("/plugins/neocompany-tools/bridge/am-i-admin", (req, res) => {
    // Any authenticated actor can ask; we just report whether they are
    // an instance admin so the Settings UI can conditionally render the
    // platform section.
    try {
      assertInstanceAdmin(req);
      res.json({ isAdmin: true });
    } catch {
      res.json({ isAdmin: false });
    }
  });

  // -----------------------------------------------------------------------
  // GET /bridge/platform — read platform config (any authenticated actor)
  // -----------------------------------------------------------------------

  router.get("/plugins/neocompany-tools/bridge/platform", async (req, res) => {
    // Require at least a board-level actor so we don't leak anything via
    // anonymous reads; the returned refs are non-secret but operational.
    assertBoard(req);
    try {
      const pluginId = await resolvePluginId();
      const row = await registry.getConfig(pluginId);
      const cfg = (row?.configJson ?? {}) as Record<string, unknown>;
      const view: PlatformConfigView = {
        googleClientId: (cfg.googleClientId as string) ?? "",
        googleClientSecretRef: (cfg.googleClientSecretRef as string) ?? null,
        googleRefreshTokenRef: (cfg.googleRefreshTokenRef as string) ?? null,
        googlePsiApiKeyRef: (cfg.googlePsiApiKeyRef as string) ?? null,
        openPageRankApiKeyRef: (cfg.openPageRankApiKeyRef as string) ?? null,
        resendApiKeyRef: (cfg.resendApiKeyRef as string) ?? null,
        resendDefaultFrom:
          ((cfg.resendDefaultFrom as string) ?? (cfg.defaultFromAddress as string)) ?? "",
      };
      res.json(view);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // -----------------------------------------------------------------------
  // PUT /bridge/platform — write platform config (ADMIN ONLY)
  // -----------------------------------------------------------------------

  router.put("/plugins/neocompany-tools/bridge/platform", async (req, res) => {
    assertInstanceAdmin(req);
    const body = (req.body ?? {}) as Partial<PlatformConfigView>;
    try {
      const pluginId = await resolvePluginId();
      // Only persist fields the caller explicitly sent. The patchConfig
      // helper does a shallow merge so unrelated fields are preserved.
      // null clears a ref; "" clears a text field; absent fields ignored.
      const patch: Record<string, unknown> = {};
      const writeIfProvided = (key: keyof PlatformConfigView, value: unknown) => {
        if (value === undefined) return;
        patch[key as string] = value;
      };
      writeIfProvided("googleClientId", body.googleClientId);
      writeIfProvided("googleClientSecretRef", body.googleClientSecretRef);
      writeIfProvided("googleRefreshTokenRef", body.googleRefreshTokenRef);
      writeIfProvided("googlePsiApiKeyRef", body.googlePsiApiKeyRef);
      writeIfProvided("openPageRankApiKeyRef", body.openPageRankApiKeyRef);
      writeIfProvided("resendApiKeyRef", body.resendApiKeyRef);
      writeIfProvided("resendDefaultFrom", body.resendDefaultFrom);
      if (Object.keys(patch).length > 0) {
        await registry.patchConfig(pluginId, { configJson: patch });
      }
      res.json({ ok: true, updatedFields: Object.keys(body) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // -----------------------------------------------------------------------
  // GET /bridge/enabled-tools — read the platform-wide tool allowlist
  // -----------------------------------------------------------------------

  router.get("/plugins/neocompany-tools/bridge/enabled-tools", async (req, res) => {
    assertBoard(req);
    try {
      const pluginId = await resolvePluginId();
      const raw = await stateStore.get(pluginId, "instance", ENABLED_TOOLS_STATE_KEY);
      const enabled = Array.isArray(raw) ? (raw as string[]) : null;
      // `null` is the "unconfigured" state → the dispatcher treats it as
      // "allow all" for backwards-compatibility. The UI knows to show an
      // "All tools enabled (not configured yet)" banner.
      res.json({ enabled });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // -----------------------------------------------------------------------
  // POST /bridge/enabled-tools — write the allowlist (ADMIN ONLY)
  // -----------------------------------------------------------------------

  router.post("/plugins/neocompany-tools/bridge/enabled-tools", async (req, res) => {
    assertInstanceAdmin(req);
    const body = (req.body ?? {}) as { enabled?: unknown };
    if (!Array.isArray(body.enabled)) {
      res.status(400).json({ error: "`enabled` must be an array of tool names" });
      return;
    }
    const enabled = (body.enabled as unknown[]).filter((v): v is string => typeof v === "string");
    try {
      const pluginId = await resolvePluginId();
      await stateStore.set(pluginId, {
        scopeKind: "instance",
        stateKey: ENABLED_TOOLS_STATE_KEY,
        value: enabled as unknown,
      });
      // Drop the dispatcher's in-memory allowlist cache so the new
      // values take effect immediately instead of after the TTL window.
      invalidateNeocompanyAllowlistCache();
      res.json({ ok: true, enabled });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  return router;
}

export { createPlatformConfigRoutes };
