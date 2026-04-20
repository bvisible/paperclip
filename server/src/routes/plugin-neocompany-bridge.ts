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
import { createPluginSecretsHandler } from "../services/plugin-secrets-handler.js";
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
  openaiApiKeyRef: string | null;
  linkedinClientId: string;
  linkedinClientSecretRef: string | null;
  facebookAppId: string;
  facebookAppSecretRef: string | null;
}

/** Transient pending OAuth state — mirrors the interface in the worker. */
interface PendingOAuthState {
  state: string;
  provider: "linkedin" | "facebook" | "instagram";
  companyId: string;
  codeVerifier?: string;
  expiresAt: number;
  returnTo: string;
}

interface StoredChannelToken {
  provider: "linkedin" | "facebook" | "instagram";
  accountId: string;
  accountName: string;
  iconUrl?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number | null;
  scopes?: string[];
  connectedAt: string;
  refreshedAt?: string;
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
        openaiApiKeyRef: (cfg.openaiApiKeyRef as string) ?? null,
        linkedinClientId: (cfg.linkedinClientId as string) ?? "",
        linkedinClientSecretRef: (cfg.linkedinClientSecretRef as string) ?? null,
        facebookAppId: (cfg.facebookAppId as string) ?? "",
        facebookAppSecretRef: (cfg.facebookAppSecretRef as string) ?? null,
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
      writeIfProvided("openaiApiKeyRef", body.openaiApiKeyRef);
      writeIfProvided("linkedinClientId", body.linkedinClientId);
      writeIfProvided("linkedinClientSecretRef", body.linkedinClientSecretRef);
      writeIfProvided("facebookAppId", body.facebookAppId);
      writeIfProvided("facebookAppSecretRef", body.facebookAppSecretRef);
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

  // -----------------------------------------------------------------------
  // GET /bridge/oauth/callback — public OAuth landing (no auth)
  //
  // The provider (LinkedIn / Facebook) redirects the end user's browser
  // here after they approve the consent screen. We look up the pending
  // state, exchange the code, fetch the account identity, and persist a
  // `StoredChannelToken` under plugin_state scope=company. Then we
  // redirect the user back to the UI.
  //
  // Errors redirect to the UI with ?error=... so the user sees a
  // meaningful message instead of a raw JSON 500.
  // -----------------------------------------------------------------------

  router.get("/plugins/neocompany-tools/bridge/oauth/callback", async (req, res) => {
    const state = String(req.query.state ?? "");
    const code = String(req.query.code ?? "");
    const errorParam = req.query.error ? String(req.query.error) : null;
    const errorDescription = req.query.error_description
      ? String(req.query.error_description)
      : null;

    const fallbackReturn = "/";
    const redirectWithError = (target: string, reason: string) => {
      const sep = target.includes("?") ? "&" : "?";
      res.redirect(`${target}${sep}oauth_error=${encodeURIComponent(reason)}`);
    };

    try {
      if (!state) {
        res.status(400).send("Missing state");
        return;
      }

      const pluginId = await resolvePluginId();
      const pendingKey = `oauth-pending:${state}`;
      const pending = (await stateStore.get(pluginId, "instance", pendingKey)) as
        | PendingOAuthState
        | null;
      if (!pending || pending.state !== state) {
        res.status(400).send("Unknown or expired state");
        return;
      }
      // Consume the pending record immediately so it cannot be replayed.
      await stateStore.set(pluginId, {
        scopeKind: "instance",
        stateKey: pendingKey,
        value: null as unknown,
      });

      if (Date.now() > pending.expiresAt) {
        redirectWithError(pending.returnTo || fallbackReturn, "state_expired");
        return;
      }
      if (errorParam) {
        redirectWithError(
          pending.returnTo || fallbackReturn,
          `${errorParam}${errorDescription ? ":" + errorDescription : ""}`.slice(0, 200),
        );
        return;
      }
      if (!code) {
        redirectWithError(pending.returnTo || fallbackReturn, "missing_code");
        return;
      }

      // Read platform config for client creds.
      const configRow = await registry.getConfig(pluginId);
      const cfg = (configRow?.configJson ?? {}) as Record<string, unknown>;

      let clientId: string | undefined;
      let clientSecretRef: string | undefined;
      if (pending.provider === "linkedin") {
        clientId = cfg.linkedinClientId as string | undefined;
        clientSecretRef = cfg.linkedinClientSecretRef as string | undefined;
      } else if (pending.provider === "facebook" || pending.provider === "instagram") {
        clientId = cfg.facebookAppId as string | undefined;
        clientSecretRef = cfg.facebookAppSecretRef as string | undefined;
      }
      if (!clientId || !clientSecretRef) {
        redirectWithError(pending.returnTo || fallbackReturn, "platform_not_configured");
        return;
      }

      // Resolve the client secret through the plugin secrets handler so
      // the same allowlist checks apply (only refs declared in
      // instanceConfigSchema are allowed).
      const secretsHandler = createPluginSecretsHandler({ db, pluginId });
      const clientSecret = await secretsHandler.resolve({ secretRef: clientSecretRef });

      // Build the redirect URI — must match exactly what was used when
      // constructing the auth URL (origin + callback path).
      const publicUrl = resolvePublicUrl(req);
      const redirectUri = `${publicUrl}/api/plugins/neocompany-tools/bridge/oauth/callback`;

      // Provider exchange — LinkedIn only for now.
      let auth: {
        accessToken: string;
        refreshToken?: string;
        expiresAt: number | null;
        scopes?: string[];
      };
      let account: { accountId: string; accountName: string; iconUrl?: string };

      if (pending.provider === "linkedin") {
        const tokenRes = await postForm<{
          access_token: string;
          expires_in: number;
          refresh_token?: string;
          scope?: string;
        }>("https://www.linkedin.com/oauth/v2/accessToken", {
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
          code_verifier: pending.codeVerifier,
        });
        auth = {
          accessToken: tokenRes.access_token,
          refreshToken: tokenRes.refresh_token,
          expiresAt: tokenRes.expires_in ? Date.now() + tokenRes.expires_in * 1000 : null,
          scopes: tokenRes.scope ? tokenRes.scope.split(/\s+/).filter(Boolean) : undefined,
        };
        const info = await fetchJson<{ sub: string; name: string; picture?: string }>(
          "https://api.linkedin.com/v2/userinfo",
          { headers: { Authorization: `Bearer ${auth.accessToken}` } },
        );
        account = {
          accountId: `urn:li:person:${info.sub}`,
          accountName: info.name,
          iconUrl: info.picture,
        };
      } else {
        redirectWithError(pending.returnTo || fallbackReturn, "provider_not_implemented");
        return;
      }

      // Persist the token + update the per-provider index so channelsList
      // can enumerate it without a prefix scan primitive.
      const stored: StoredChannelToken = {
        provider: pending.provider,
        accountId: account.accountId,
        accountName: account.accountName,
        iconUrl: account.iconUrl,
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        expiresAt: auth.expiresAt,
        scopes: auth.scopes,
        connectedAt: new Date().toISOString(),
      };
      await stateStore.set(pluginId, {
        scopeKind: "company",
        scopeId: pending.companyId,
        stateKey: `channel:${pending.provider}:${account.accountId}`,
        value: stored as unknown,
      });
      const indexKey = `channel-index:${pending.provider}`;
      const currentIndex = (await stateStore.get(pluginId, "company", indexKey, {
        scopeId: pending.companyId,
      })) as string[] | null;
      const nextIndex = Array.from(new Set([...(currentIndex ?? []), account.accountId]));
      await stateStore.set(pluginId, {
        scopeKind: "company",
        scopeId: pending.companyId,
        stateKey: indexKey,
        value: nextIndex as unknown,
      });

      const sep = pending.returnTo.includes("?") ? "&" : "?";
      res.redirect(
        `${pending.returnTo}${sep}connected=${pending.provider}&account=${encodeURIComponent(
          account.accountName,
        )}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error("[plugin-neocompany-bridge] oauth/callback failed", message);
      res.status(500).send(`OAuth callback failed: ${message.slice(0, 300)}`);
    }
  });

  return router;
}

// -----------------------------------------------------------------------
// Helpers (module-local)
// -----------------------------------------------------------------------

function resolvePublicUrl(req: { protocol: string; get: (h: string) => string | undefined }): string {
  // Prefer PAPERCLIP_PUBLIC_URL so we match exactly what was used when the
  // OAuth app was registered. Fall back to the incoming request host.
  const env = process.env.PAPERCLIP_PUBLIC_URL;
  if (env) return env.replace(/\/+$/, "");
  const host = req.get("host") ?? "";
  return `${req.protocol}://${host}`.replace(/\/+$/, "");
}

async function postForm<T>(
  url: string,
  body: Record<string, string | undefined>,
): Promise<T> {
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null || v === "") continue;
    pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: pairs.join("&"),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text) as T;
}

async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text) as T;
}

export { createPlatformConfigRoutes };
