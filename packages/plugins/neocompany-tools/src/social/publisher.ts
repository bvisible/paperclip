/**
 * Social publisher cron — transitions `social_post` entities from
 * `scheduled` to `published` (or `failed`) by calling each provider.
 *
 * Runs every minute (declared in manifest.jobs). The tick:
 *   1. Scans every company for scheduled posts whose `scheduledAt <= now`.
 *   2. For each post, locks it by flipping to `publishing` (best-effort —
 *      plugin_entities has no row-level lock, but one minute cadence + an
 *      attempts counter is enough for our scale).
 *   3. Refreshes the channel token if it is about to expire.
 *   4. Loads the referenced library image if any.
 *   5. Calls `provider.publish(...)`.
 *   6. On success: status=published, providerPostId, publishedAt.
 *   7. On error: attempts++, if < 3 → back to scheduled (+5min), else
 *      status=failed with lastError.
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";
import { getProvider } from "../integrations/registry.js";
import type { StoredChannelToken, SocialProviderKey } from "../integrations/types.js";
import {
  SOCIAL_POST_ENTITY_TYPE,
  type SocialPostData,
} from "./types.js";
import {
  IMAGE_ENTITY_TYPE,
  type GeneratedImageData,
} from "../images/types.js";

const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MINUTES = 5;
const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

interface PlatformConfig {
  linkedinClientId?: string;
  linkedinClientSecretRef?: string;
  facebookAppId?: string;
  facebookAppSecretRef?: string;
}

async function resolveProviderCreds(
  ctx: PluginContext,
  provider: SocialProviderKey,
): Promise<{ clientId: string; clientSecret: string }> {
  const platform = ((await ctx.config.get()) ?? {}) as PlatformConfig;
  let clientId: string | undefined;
  let clientSecretRef: string | undefined;
  if (provider === "linkedin") {
    clientId = platform.linkedinClientId;
    clientSecretRef = platform.linkedinClientSecretRef;
  } else if (provider === "facebook" || provider === "instagram") {
    clientId = platform.facebookAppId;
    clientSecretRef = platform.facebookAppSecretRef;
  }
  if (!clientId || !clientSecretRef) {
    throw new Error(`Provider ${provider} not configured on this platform`);
  }
  const clientSecret = await ctx.secrets.resolve(clientSecretRef);
  if (!clientSecret) throw new Error(`Cannot resolve ${provider} client secret`);
  return { clientId, clientSecret };
}

function decodeDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return {
    mimeType: match[1]!,
    buffer: Buffer.from(match[2]!, "base64"),
  };
}

async function loadImageForPost(
  ctx: PluginContext,
  companyId: string,
  imageId: string,
): Promise<{ buffer?: Buffer; mimeType?: string; imageUrl?: string }> {
  const rows = await ctx.entities.list({
    entityType: IMAGE_ENTITY_TYPE,
    scopeKind: "company",
    scopeId: companyId,
    externalId: imageId,
    limit: 1,
  });
  const row = rows[0];
  if (!row) return {};
  const data = row.data as unknown as GeneratedImageData;
  const url = data.finalImageUrl ?? data.rawImageUrl;
  if (!url) return {};
  if (url.startsWith("data:")) {
    const decoded = decodeDataUrl(url);
    if (decoded) return { buffer: decoded.buffer, mimeType: decoded.mimeType };
    return {};
  }
  return { imageUrl: url };
}

async function ensureFreshToken(
  ctx: PluginContext,
  companyId: string,
  provider: SocialProviderKey,
  accountId: string,
  stored: StoredChannelToken,
): Promise<StoredChannelToken> {
  if (stored.expiresAt == null) return stored;
  if (stored.expiresAt > Date.now() + TOKEN_REFRESH_THRESHOLD_MS) return stored;
  if (!stored.refreshToken) return stored;

  const providerImpl = getProvider(provider);
  if (!providerImpl.refreshToken) return stored;
  const { clientId, clientSecret } = await resolveProviderCreds(ctx, provider);
  const fresh = await providerImpl.refreshToken({
    clientId,
    clientSecret,
    refreshToken: stored.refreshToken,
  });
  const next: StoredChannelToken = {
    ...stored,
    accessToken: fresh.accessToken,
    refreshToken: fresh.refreshToken ?? stored.refreshToken,
    expiresAt: fresh.expiresAt,
    scopes: fresh.scopes ?? stored.scopes,
    refreshedAt: new Date().toISOString(),
  };
  await ctx.state.set(
    {
      scopeKind: "company",
      scopeId: companyId,
      stateKey: `channel:${provider}:${accountId}`,
    },
    next as unknown as Record<string, unknown>,
  );
  return next;
}

async function transitionPost(
  ctx: PluginContext,
  companyId: string,
  externalId: string,
  title: string | null,
  currentEntityStatus: string | null,
  data: SocialPostData,
  nextStatus: SocialPostData["status"],
  extraFields: Partial<SocialPostData> = {},
): Promise<void> {
  const next: SocialPostData = { ...data, ...extraFields, status: nextStatus };
  await ctx.entities.upsert({
    entityType: SOCIAL_POST_ENTITY_TYPE,
    scopeKind: "company",
    scopeId: companyId,
    externalId,
    title: title ?? undefined,
    status: nextStatus,
    data: next as unknown as Record<string, unknown>,
  });
}

/**
 * Execute a single publish tick. Looks at every company's scheduled posts.
 */
export async function runSocialPublisherTick(ctx: PluginContext): Promise<{
  scanned: number;
  published: number;
  failed: number;
  retried: number;
}> {
  const report = { scanned: 0, published: 0, failed: 0, retried: 0 };

  // Fetch every scheduled post across every company. plugin_entities doesn't
  // support cross-company filters directly, so we rely on companies.list +
  // per-company queries.
  const companies = await ctx.companies.list();
  const now = Date.now();

  for (const company of companies) {
    const rows = await ctx.entities.list({
      entityType: SOCIAL_POST_ENTITY_TYPE,
      scopeKind: "company",
      scopeId: company.id,
      limit: 200,
    });
    for (const row of rows) {
      const data = row.data as unknown as SocialPostData;
      if (data.status !== "scheduled") continue;
      const scheduledAt = data.scheduledAt ?? data.proposedAt;
      if (!scheduledAt || new Date(scheduledAt).getTime() > now) continue;

      report.scanned += 1;
      const externalId = row.externalId ?? row.id;

      try {
        // Flip to `publishing` to reduce contention with other ticks.
        await transitionPost(ctx, company.id, externalId, row.title, row.status, data, "publishing");

        const channelKey = `channel:${data.channel.provider}:${parseAccountId(data.channel.channelKey)}`;
        const storedRaw = await ctx.state.get({
          scopeKind: "company",
          scopeId: company.id,
          stateKey: channelKey,
        });
        if (!storedRaw) {
          throw new Error(`Channel token missing for ${data.channel.provider}`);
        }
        let stored = storedRaw as unknown as StoredChannelToken;
        stored = await ensureFreshToken(
          ctx,
          company.id,
          data.channel.provider,
          stored.accountId,
          stored,
        );

        const providerImpl = getProvider(data.channel.provider);
        if (!providerImpl.publish) {
          throw new Error(`Provider ${data.channel.provider} does not implement publish()`);
        }

        let imageBuffer: Buffer | undefined;
        let imageMimeType: string | undefined;
        let imageUrl: string | undefined;
        if (data.imageId) {
          const loaded = await loadImageForPost(ctx, company.id, data.imageId);
          imageBuffer = loaded.buffer;
          imageMimeType = loaded.mimeType;
          imageUrl = loaded.imageUrl;
        }

        const result = await providerImpl.publish({
          accessToken: stored.accessToken,
          accountId: stored.accountId,
          text: data.text,
          imageUrl,
          imageBuffer,
          imageMimeType,
        });

        await transitionPost(
          ctx,
          company.id,
          externalId,
          row.title,
          row.status,
          data,
          "published",
          {
            providerPostId: result.postId,
            publishedAt: new Date().toISOString(),
          },
        );
        await ctx.activity.log({
          companyId: company.id,
          message: `Published social post ${externalId} on ${data.channel.provider} (${result.postId})`,
          entityType: SOCIAL_POST_ENTITY_TYPE,
          entityId: externalId,
        });
        report.published += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const currentAttempts = data.attempts ?? 0;
        const nextAttempts = currentAttempts + 1;
        if (nextAttempts < MAX_ATTEMPTS) {
          const nextSchedule = new Date(
            Date.now() + RETRY_BACKOFF_MINUTES * 60 * 1000,
          ).toISOString();
          await transitionPost(
            ctx,
            company.id,
            externalId,
            row.title,
            row.status,
            data,
            "scheduled",
            {
              attempts: nextAttempts,
              lastError: message,
              scheduledAt: nextSchedule,
            },
          );
          report.retried += 1;
          ctx.logger?.warn?.(
            `[social-publisher] retry ${nextAttempts}/${MAX_ATTEMPTS} for ${externalId}: ${message.slice(0, 200)}`,
          );
        } else {
          await transitionPost(
            ctx,
            company.id,
            externalId,
            row.title,
            row.status,
            data,
            "failed",
            {
              attempts: nextAttempts,
              lastError: message,
            },
          );
          report.failed += 1;
          ctx.logger?.error?.(
            `[social-publisher] giving up on ${externalId}: ${message.slice(0, 300)}`,
          );
        }
      }
    }
  }

  return report;
}

function parseAccountId(channelKey: string): string {
  // channelKey = `<provider>:<accountId>` — accountId may itself contain
  // colons (e.g. `urn:li:person:xxx`), so we split on the FIRST colon only.
  const idx = channelKey.indexOf(":");
  if (idx < 0) return channelKey;
  return channelKey.slice(idx + 1);
}
