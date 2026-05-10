/**
 * Instagram Business provider — posts published to Instagram accounts
 * linked to Facebook Pages via the Meta Graph API (v23.0). Same Meta
 * app as Facebook, different scopes.
 *
 * Publishing is a 2-step dance:
 *   1. POST /{igUserId}/media with image_url + caption → creation_id
 *   2. POST /{igUserId}/media_publish with creation_id
 *
 * The image MUST be reachable from a public URL — data URLs and
 * multipart upload are not supported. The `server/src/routes/assets-public.ts`
 * helper signs temporary URLs that Meta can fetch.
 *
 * References:
 *   - https://developers.facebook.com/docs/instagram-platform/content-publishing
 *   - https://developers.facebook.com/docs/instagram-api/reference/ig-user/media
 */

import { buildQuery, expiresAtFromSeconds, fetchJson, postForm } from "./base.js";
import type {
  AccountInfo,
  AuthResult,
  AuthUrl,
  AuthUrlParams,
  DiscoveredAccount,
  ExchangeCodeParams,
  PublishParams,
  PublishResult,
  SocialProvider,
} from "./types.js";

const GRAPH_VERSION = "v23.0";
const FB_AUTH_URL = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
const FB_TOKEN_URL = `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`;
const FB_GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const DEFAULT_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
  "public_profile",
];

interface FbTokenResponse {
  access_token: string;
  expires_in?: number;
}

interface FbPageWithIg {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
}

interface FbAccountsResponse {
  data: FbPageWithIg[];
  paging?: { next?: string };
}

export const instagram: SocialProvider = {
  key: "instagram",
  displayName: "Instagram",
  scopes: DEFAULT_SCOPES,
  recommendedFeedDimensions: { width: 1080, height: 1080 },

  buildAuthUrl({ clientId, redirectUri, state, scopes }: AuthUrlParams): AuthUrl {
    const qs = buildQuery({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: (scopes ?? DEFAULT_SCOPES).join(","),
    });
    return { url: `${FB_AUTH_URL}?${qs}` };
  },

  async exchangeCode({
    clientId,
    clientSecret,
    code,
    redirectUri,
  }: ExchangeCodeParams): Promise<AuthResult> {
    const short = await postForm<FbTokenResponse>(FB_TOKEN_URL, {
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    });
    const long = await postForm<FbTokenResponse>(FB_TOKEN_URL, {
      grant_type: "fb_exchange_token",
      client_id: clientId,
      client_secret: clientSecret,
      fb_exchange_token: short.access_token,
    });
    return {
      accessToken: long.access_token,
      expiresAt: expiresAtFromSeconds(long.expires_in),
    };
  },

  async getAccountInfo(accessToken: string): Promise<AccountInfo> {
    const me = await fetchJson<{ id: string; name: string }>(
      `${FB_GRAPH_BASE}/me?fields=id,name`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return { accountId: me.id, accountName: me.name };
  },

  async listAccounts(accessToken: string): Promise<DiscoveredAccount[]> {
    // Fetch every Facebook Page the user manages AND that has a linked
    // Instagram Business account. We return one DiscoveredAccount per
    // Instagram account, using the PAGE's access token (that's what
    // Instagram's media publish endpoints expect).
    const accounts: DiscoveredAccount[] = [];
    let url: string | undefined = `${FB_GRAPH_BASE}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100`;
    while (url) {
      const resp: FbAccountsResponse = await fetchJson(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      for (const page of resp.data) {
        const ig = page.instagram_business_account;
        if (!ig?.id) continue;
        accounts.push({
          accountId: ig.id,
          accountName: ig.username ? `@${ig.username}` : page.name,
          accessToken: page.access_token,
          extra: { linkedPageId: page.id, linkedPageName: page.name },
        });
      }
      url = resp.paging?.next;
    }
    return accounts;
  },

  async publish({
    accessToken,
    accountId,
    text,
    imageUrl,
  }: PublishParams): Promise<PublishResult> {
    if (!imageUrl) {
      throw new Error(
        "Instagram requires a public image URL — data URLs and multipart upload are not supported",
      );
    }
    // Step 1: create a media container.
    const container = await postForm<{ id: string }>(
      `${FB_GRAPH_BASE}/${accountId}/media`,
      {
        image_url: imageUrl,
        caption: text,
        access_token: accessToken,
      },
    );
    // Step 2: publish the container.
    const published = await postForm<{ id: string }>(
      `${FB_GRAPH_BASE}/${accountId}/media_publish`,
      {
        creation_id: container.id,
        access_token: accessToken,
      },
    );
    return {
      postId: published.id,
      // IG permalink is fetched via a separate /permalink call; we skip
      // it here to avoid one more round-trip. Callers can build it later.
    };
  },
};
