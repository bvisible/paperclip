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
import { assertInstanceAdmin, assertBoard } from "./authz.js";
import { notFound } from "../errors.js";

const PLUGIN_KEY = "neocompany-tools";

/** Keys we manage in plugin_state scope=instance. */
const PLATFORM_KEYS = {
  enabledTools: "platform:enabled-tools",
  googleClientId: "platform:google:clientId",
  googleClientSecretRef: "platform:google:clientSecretRef",
  googleRefreshTokenRef: "platform:google:refreshTokenRef",
  googlePsiApiKeyRef: "platform:google:psiApiKeyRef",
  openPageRankApiKeyRef: "platform:openPageRank:apiKeyRef",
  resendApiKeyRef: "platform:resend:apiKeyRef",
  resendDefaultFrom: "platform:resend:defaultFrom",
} as const;

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

  async function resolvePluginId(): Promise<string> {
    const plugin = await pluginRegistryService(db).getByKey(PLUGIN_KEY);
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
      const [
        googleClientId,
        googleClientSecretRef,
        googleRefreshTokenRef,
        googlePsiApiKeyRef,
        openPageRankApiKeyRef,
        resendApiKeyRef,
        resendDefaultFrom,
      ] = await Promise.all([
        stateStore.get(pluginId, "instance", PLATFORM_KEYS.googleClientId),
        stateStore.get(pluginId, "instance", PLATFORM_KEYS.googleClientSecretRef),
        stateStore.get(pluginId, "instance", PLATFORM_KEYS.googleRefreshTokenRef),
        stateStore.get(pluginId, "instance", PLATFORM_KEYS.googlePsiApiKeyRef),
        stateStore.get(pluginId, "instance", PLATFORM_KEYS.openPageRankApiKeyRef),
        stateStore.get(pluginId, "instance", PLATFORM_KEYS.resendApiKeyRef),
        stateStore.get(pluginId, "instance", PLATFORM_KEYS.resendDefaultFrom),
      ]);
      const view: PlatformConfigView = {
        googleClientId: (googleClientId as string) ?? "",
        googleClientSecretRef: (googleClientSecretRef as string) ?? null,
        googleRefreshTokenRef: (googleRefreshTokenRef as string) ?? null,
        googlePsiApiKeyRef: (googlePsiApiKeyRef as string) ?? null,
        openPageRankApiKeyRef: (openPageRankApiKeyRef as string) ?? null,
        resendApiKeyRef: (resendApiKeyRef as string) ?? null,
        resendDefaultFrom: (resendDefaultFrom as string) ?? "",
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
      // Only persist fields that the caller explicitly sent. `null` clears
      // a ref; `""` clears a text field. Absent fields are ignored.
      const updates: Array<Promise<void>> = [];
      const writeIfProvided = (key: keyof typeof PLATFORM_KEYS, value: unknown) => {
        if (value === undefined) return;
        updates.push(
          stateStore.set(pluginId, {
            scopeKind: "instance",
            stateKey: PLATFORM_KEYS[key],
            value: value as unknown,
          }),
        );
      };
      writeIfProvided("googleClientId", body.googleClientId);
      writeIfProvided("googleClientSecretRef", body.googleClientSecretRef);
      writeIfProvided("googleRefreshTokenRef", body.googleRefreshTokenRef);
      writeIfProvided("googlePsiApiKeyRef", body.googlePsiApiKeyRef);
      writeIfProvided("openPageRankApiKeyRef", body.openPageRankApiKeyRef);
      writeIfProvided("resendApiKeyRef", body.resendApiKeyRef);
      writeIfProvided("resendDefaultFrom", body.resendDefaultFrom);
      await Promise.all(updates);
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
      const raw = await stateStore.get(pluginId, "instance", PLATFORM_KEYS.enabledTools);
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
        stateKey: PLATFORM_KEYS.enabledTools,
        value: enabled as unknown,
      });
      res.json({ ok: true, enabled });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  return router;
}

export { createPlatformConfigRoutes };
