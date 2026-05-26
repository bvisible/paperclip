//// Neocompany Modification — pure addition (Neocompany fork on top of paperclipai/paperclip)
//// This file does not exist upstream. Safe across upstream merges.

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
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents } from "@paperclipai/db";
import { pluginRegistryService } from "../services/plugin-registry.js";
import { pluginStateStore } from "../services/plugin-state-store.js";
import { invalidateNeocompanyAllowlistCache } from "../services/plugin-tool-dispatcher.js";
import { createPluginSecretsHandler } from "../services/plugin-secrets-handler.js";
import {
  accessService,
  agentInstructionsService,
  agentService,
  logActivity,
} from "../services/index.js";
import { seedDefaultAgentsForCompany } from "../services/seed-agents.js";
import { loadInstructionsBundleForNewAgent } from "../services/default-agent-instructions.js";
import { assertInstanceAdmin, assertBoard, assertCompanyAccess } from "./authz.js";
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
  // POST /bridge/reseed-agents — re-run the seed-fleet loop on a company
  //
  // Idempotent (skips seedKeys already present on the target). Needed for
  // companies that existed BEFORE the seed-agents wiring was restored on
  // 2026-05-11 — POST /api/companies seeds new ones automatically, but
  // existing rows must be backfilled. Instance-admin only.
  // -----------------------------------------------------------------------

  const agentsSvc = agentService(db);
  const access = accessService(db);
  const instructions = agentInstructionsService();

  router.post("/plugins/neocompany-tools/bridge/reseed-agents", async (req, res) => {
    assertInstanceAdmin(req);
    const companyId = (req.body as { companyId?: string } | undefined)?.companyId;
    if (!companyId || typeof companyId !== "string") {
      res.status(400).json({ error: "companyId required" });
      return;
    }

    // Discover seedKeys already present so we don't double-create.
    const existingRows = await db
      .select({ id: agents.id, metadata: agents.metadata })
      .from(agents)
      .where(eq(agents.companyId, companyId));
    const existingSeedKeys = new Set<string>();
    for (const row of existingRows) {
      const md = (row.metadata ?? {}) as Record<string, unknown>;
      const key = md.seedKey;
      if (typeof key === "string" && key.length > 0) existingSeedKeys.add(key);
    }

    const actorUserId = "actor" in req && req.actor && typeof req.actor === "object"
      ? ((req.actor as { userId?: string }).userId ?? null)
      : null;

    try {
      const created = await seedDefaultAgentsForCompany(
        companyId,
        {
          createAgent: (cid, input) =>
            agentsSvc.create(cid, input as Parameters<typeof agentsSvc.create>[1]),
          materializeBundleForNewAgent: async (agent) => {
            const adapterConfig = (agent.adapterConfig ?? {}) as Record<string, unknown>;
            const instructionsTemplate =
              typeof adapterConfig.instructionsTemplate === "string"
                ? (adapterConfig.instructionsTemplate as string)
                : null;
            const files = await loadInstructionsBundleForNewAgent({
              role: agent.role,
              instructionsTemplate,
            });
            const result = await instructions.materializeManagedBundle(agent, files, {
              entryFile: "AGENTS.md",
              replaceExisting: false,
            });
            await agentsSvc.update(agent.id, { adapterConfig: result.adapterConfig });
          },
          grantDefaultAgentAccess: async (cid, agentId, grantedByUserId) => {
            await access.ensureMembership(cid, "agent", agentId, "member", "active");
            await access.setPrincipalPermission(
              cid,
              "agent",
              agentId,
              "tasks:assign",
              true,
              grantedByUserId,
            );
          },
          logActivity: async ({ companyId: cid, agentId, actorUserId: aid, seedKey }) => {
            await logActivity(db, {
              companyId: cid,
              actorType: "user",
              actorId: aid ?? "board",
              action: "agent.seeded",
              entityType: "agent",
              entityId: agentId,
              details: { seedKey, source: "reseed-agents" },
            });
          },
        },
        {
          openclawGatewayUrl: process.env.OPENCLAW_GATEWAY_URL ?? "ws://127.0.0.1:3200",
          openclawGatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN ?? "",
          actorUserId,
          enableHeartbeat: true,
          heartbeatIntervalSec: 900,
        },
        existingSeedKeys,
      );
      res.json({
        companyId,
        created,
        alreadyPresent: [...existingSeedKeys],
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[reseed-agents] failed", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
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

  //// Neocompany Modification — PUT /bridge/agent-identity
  ////
  //// Patches an agent's identity (name, title, metadata.persona,
  //// metadata.emailIdentity) from the plugin SettingsPage. Worker plugins
  //// cannot mutate agents (the SDK only exposes `agents.list/get/...`),
  //// so this route is the bridge they go through. Multi-tenant guard:
  //// caller must have company access AND the agent must belong to that
  //// company (cross-tenant rename blocked).
  //// End Neocompany Modification
  router.put("/plugins/neocompany-tools/bridge/agent-identity", async (req, res) => {
    interface AgentIdentityPatchBody {
      companyId?: string;
      agentId?: string;
      name?: string;
      title?: string;
      persona?: string;
      emailIdentity?: {
        address?: string;
        fromName?: string;
        signatureId?: string;
        signatureHtmlOverride?: string;
      };
    }
    const body = (req.body ?? {}) as AgentIdentityPatchBody;
    if (!body.companyId || !body.agentId) {
      res.status(400).json({ error: "companyId and agentId are required" });
      return;
    }
    try {
      assertCompanyAccess(req, body.companyId);
      const existing = await agentsSvc.getById(body.agentId);
      if (!existing) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      if (existing.companyId !== body.companyId) {
        // Block cross-tenant access — caller could otherwise pass any
        // agentId after having access to ANY company.
        res.status(403).json({ error: "Agent does not belong to this company" });
        return;
      }
      // Merge metadata patch — only the fields the caller sent are touched.
      const currentMetadata = (existing.metadata ?? {}) as Record<string, unknown>;
      const nextMetadata: Record<string, unknown> = { ...currentMetadata };
      if (body.persona !== undefined) {
        nextMetadata.persona = body.persona;
      }
      if (body.emailIdentity !== undefined) {
        const currentIdentity = (currentMetadata.emailIdentity ?? {}) as Record<string, unknown>;
        nextMetadata.emailIdentity = { ...currentIdentity, ...body.emailIdentity };
      }
      const patch: Partial<{ name: string; title: string; metadata: Record<string, unknown> }> = {};
      if (typeof body.name === "string" && body.name.trim().length > 0) patch.name = body.name.trim();
      if (body.title !== undefined) patch.title = body.title;
      if (body.persona !== undefined || body.emailIdentity !== undefined) patch.metadata = nextMetadata;
      if (Object.keys(patch).length === 0) {
        res.json({ ok: true, updated: false });
        return;
      }
      const updated = await agentsSvc.update(body.agentId, patch as never);
      res.json({ ok: true, updated: Boolean(updated), agent: updated ? { id: updated.id, name: updated.name, title: updated.title, metadata: updated.metadata } : null });
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode ?? 500;
      const message = err instanceof Error ? err.message : String(err);
      res.status(status).json({ error: message });
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
      await stateStore.delete(pluginId, "instance", pendingKey);

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

      // Provider exchange — dispatch per provider. Each branch produces
      // (auth, accounts[]) — typically one account for LinkedIn but a
      // list for Facebook Pages / Instagram Business accounts.
      let auth: {
        accessToken: string;
        refreshToken?: string;
        expiresAt: number | null;
        scopes?: string[];
      };
      interface DiscoveredAccount {
        accountId: string;
        accountName: string;
        iconUrl?: string;
        /** per-account override (FB page tokens, IG=shared page token) */
        accessToken?: string;
      }
      let accounts: DiscoveredAccount[] = [];

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
        accounts = [
          {
            accountId: `urn:li:person:${info.sub}`,
            accountName: info.name,
            iconUrl: info.picture,
          },
        ];

        //// Neocompany Modification: linkedin-page-posting
        // Fetch admin'd Company Pages and emit one channel account per Page
        // alongside the personal-feed account above. Requires scopes
        // r_organization_admin + w_organization_social (see DEFAULT_SCOPES in
        // packages/plugins/neocompany-tools/src/integrations/linkedin.ts).
        // The plugin's `publish` method is URN-agnostic — accountId is used
        // verbatim as the UGC post's `author`, so a Page URN
        // (urn:li:organization:<id>) works the same way as a person URN.
        try {
          interface LinkedInOrgAcl {
            organization?: string;
            role?: string;
            state?: string;
          }
          const aclsRes = await fetchJson<{ elements?: LinkedInOrgAcl[] }>(
            `https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`,
            {
              headers: {
                Authorization: `Bearer ${auth.accessToken}`,
                "X-Restli-Protocol-Version": "2.0.0",
                "LinkedIn-Version": "202605",
              },
            },
          );
          const orgUrns = (aclsRes.elements ?? [])
            .map((el) => el.organization)
            .filter(
              (u): u is string =>
                typeof u === "string" && u.startsWith("urn:li:organization:"),
            );
          console.log(
            `[neocompany-oauth] linkedin organizationAcls: ${orgUrns.length} page(s)`,
          );
          for (const orgUrn of orgUrns) {
            const orgId = orgUrn.replace("urn:li:organization:", "");
            try {
              const org = await fetchJson<{
                vanityName?: string;
                localizedName?: string;
                name?: { localized?: Record<string, string> };
              }>(
                `https://api.linkedin.com/rest/organizations/${encodeURIComponent(orgId)}`,
                {
                  headers: {
                    Authorization: `Bearer ${auth.accessToken}`,
                    "X-Restli-Protocol-Version": "2.0.0",
                    "LinkedIn-Version": "202605",
                  },
                },
              );
              const name =
                org.localizedName ||
                (org.name?.localized && Object.values(org.name.localized)[0]) ||
                org.vanityName ||
                `Page ${orgId}`;
              accounts.push({
                accountId: orgUrn,
                accountName: name,
              });
            } catch (e) {
              console.log(
                `[neocompany-oauth] linkedin org ${orgId} fetch failed: ${String(e)}`,
              );
            }
          }
        } catch (e) {
          console.log(
            `[neocompany-oauth] linkedin organizationAcls failed: ${String(e)}`,
          );
        }
        // End Neocompany Modification: linkedin-page-posting
      } else if (pending.provider === "facebook" || pending.provider === "instagram") {
        const GRAPH_V = "v23.0";
        const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_V}`;

        // 1. short-lived user token via authorization_code
        const shortRes = await postForm<{ access_token: string; expires_in?: number }>(
          `${GRAPH_BASE}/oauth/access_token`,
          {
            grant_type: "authorization_code",
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code,
          },
        );
        // 2. exchange for long-lived user token (~60 days)
        const longRes = await postForm<{ access_token: string; expires_in?: number }>(
          `${GRAPH_BASE}/oauth/access_token`,
          {
            grant_type: "fb_exchange_token",
            client_id: clientId,
            client_secret: clientSecret,
            fb_exchange_token: shortRes.access_token,
          },
        );
        auth = {
          accessToken: longRes.access_token,
          expiresAt: longRes.expires_in ? Date.now() + longRes.expires_in * 1000 : null,
        };

        // 3. fetch pages (and linked IG accounts) owned by the user
        type FbPageNode = {
          id: string;
          name: string;
          access_token?: string;
          category?: string;
          instagram_business_account?: { id: string; username?: string };
        };
        const fields = pending.provider === "instagram"
          ? "id,name,access_token,instagram_business_account{id,username}"
          : "id,name,access_token,category";
        const pagesUrl = `${GRAPH_BASE}/me/accounts?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(auth.accessToken)}`;
        const pagesRes = await fetchJson<{ data: FbPageNode[] }>(pagesUrl);
        let pageNodes: FbPageNode[] = pagesRes.data ?? [];
        console.log(`[neocompany-oauth] /me/accounts returned ${pageNodes.length} page(s)`);

        // Fallback: /me/accounts omits "new Pages experience" pages granted via
        // Facebook Login for Business. Discover them through the user's business
        // portfolios, then resolve a Page access token per discovered page.
        if (pageNodes.length === 0) {
          // Recover the granted Page IDs from the token's granular_scopes via
          // debug_token (works with only pages_show_list), plus a business-
          // portfolio fallback (needs business_management; ignored otherwise).
          const pageIds = new Set<string>();
          try {
            const dbg = await fetchJson<{
              data?: { granular_scopes?: Array<{ scope: string; target_ids?: string[] }> };
            }>(
              `${GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(auth.accessToken)}&access_token=${encodeURIComponent(`${clientId}|${clientSecret}`)}`,
            );
            const gs = dbg.data?.granular_scopes ?? [];
            console.log(
              `[neocompany-oauth] granular_scopes: ${JSON.stringify(gs.map((s) => ({ scope: s.scope, n: s.target_ids?.length ?? 0 })))}`,
            );
            for (const s of gs) {
              if (s.scope.startsWith("pages_") || s.scope.startsWith("instagram_")) {
                for (const id of s.target_ids ?? []) pageIds.add(id);
              }
            }
          } catch (e) {
            console.log(`[neocompany-oauth] debug_token failed: ${String(e)}`);
          }
          try {
            const bizRes = await fetchJson<{ data: Array<{ id: string }> }>(
              `${GRAPH_BASE}/me/businesses?fields=id&limit=100&access_token=${encodeURIComponent(auth.accessToken)}`,
            );
            for (const biz of bizRes.data ?? []) {
              for (const edge of ["owned_pages", "client_pages"] as const) {
                try {
                  const edgeRes = await fetchJson<{ data: Array<{ id: string }> }>(
                    `${GRAPH_BASE}/${biz.id}/${edge}?fields=id&limit=100&access_token=${encodeURIComponent(auth.accessToken)}`,
                  );
                  for (const p of edgeRes.data ?? []) pageIds.add(p.id);
                } catch {
                  /* edge unavailable for this business */
                }
              }
            }
          } catch (e) {
            console.log(`[neocompany-oauth] /me/businesses unavailable: ${String(e)}`);
          }
          // Resolve a Page access token (+ IG link) for each discovered page.
          const resolved: FbPageNode[] = [];
          for (const id of pageIds) {
            try {
              const node = await fetchJson<FbPageNode>(
                `${GRAPH_BASE}/${id}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(auth.accessToken)}`,
              );
              if (node?.access_token) resolved.push(node);
              else console.log(`[neocompany-oauth] page ${id} returned no access_token`);
            } catch (e) {
              console.log(`[neocompany-oauth] page ${id} resolve failed: ${String(e)}`);
            }
          }
          pageNodes = resolved;
          console.log(`[neocompany-oauth] fallback discovered ${pageIds.size} id(s), resolved ${resolved.length} page(s)`);
        }

        if (pending.provider === "facebook") {
          accounts = pageNodes
            .filter((p) => p.access_token)
            .map((p) => ({
              accountId: p.id,
              accountName: p.name,
              accessToken: p.access_token!,
            }));
        } else {
          accounts = pageNodes
            .filter((p) => p.instagram_business_account?.id && p.access_token)
            .map((p) => ({
              accountId: p.instagram_business_account!.id,
              accountName: p.instagram_business_account!.username
                ? `@${p.instagram_business_account!.username}`
                : p.name,
              accessToken: p.access_token!,
            }));
        }

        if (accounts.length === 0) {
          redirectWithError(
            pending.returnTo || fallbackReturn,
            pending.provider === "instagram"
              ? "no_instagram_business_account_linked"
              : "no_facebook_pages",
          );
          return;
        }
      } else {
        redirectWithError(pending.returnTo || fallbackReturn, "provider_not_implemented");
        return;
      }

      // Persist one token per discovered account + update the index.
      const indexKey = `channel-index:${pending.provider}`;
      const currentIndex = (await stateStore.get(pluginId, "company", indexKey, {
        scopeId: pending.companyId,
      })) as string[] | null;
      const nextIndex = new Set<string>(currentIndex ?? []);

      for (const account of accounts) {
        const stored: StoredChannelToken = {
          provider: pending.provider,
          accountId: account.accountId,
          accountName: account.accountName,
          iconUrl: account.iconUrl,
          accessToken: account.accessToken ?? auth.accessToken,
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
        nextIndex.add(account.accountId);
      }
      await stateStore.set(pluginId, {
        scopeKind: "company",
        scopeId: pending.companyId,
        stateKey: indexKey,
        value: Array.from(nextIndex) as unknown,
      });

      const sep = pending.returnTo.includes("?") ? "&" : "?";
      const primary = accounts[0]!;
      res.redirect(
        `${pending.returnTo}${sep}connected=${pending.provider}&count=${accounts.length}&account=${encodeURIComponent(
          primary.accountName,
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
