/**
 * Facebook Pages provider — posts published to Facebook Pages via the
 * Meta Graph API (v23.0). Each managed Page becomes its own channel
 * with its own page access token (not the user's token).
 *
 * References:
 *   - https://developers.facebook.com/docs/facebook-login/guides/advanced/oidc-token
 *   - https://developers.facebook.com/docs/graph-api/reference/page/feed
 *   - https://developers.facebook.com/docs/graph-api/reference/page/photos
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
  "pages_manage_posts",
  "pages_show_list",
  "pages_read_engagement",
  "public_profile",
];

interface FbTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

interface FbUserResponse {
  id: string;
  name: string;
}

interface FbPageResponse {
  id: string;
  name: string;
  access_token: string;
  category?: string;
  tasks?: string[];
}

interface FbAccountsResponse {
  data: FbPageResponse[];
  paging?: { next?: string };
}

export const facebook: SocialProvider = {
  key: "facebook",
  displayName: "Facebook",
  scopes: DEFAULT_SCOPES,
  recommendedFeedDimensions: { width: 1200, height: 630 },

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
    // Short-lived user token (60 min). We immediately exchange it for a
    // long-lived token below so the publisher cron doesn't have to refresh
    // every hour.
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
    // Fall-back single account (the Facebook user themselves). We mostly
    // rely on listAccounts below.
    const me = await fetchJson<FbUserResponse>(
      `${FB_GRAPH_BASE}/me?fields=id,name`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return { accountId: me.id, accountName: me.name };
  },

  async listAccounts(accessToken: string): Promise<DiscoveredAccount[]> {
    const pages: FbPageResponse[] = [];
    let url: string | undefined = `${FB_GRAPH_BASE}/me/accounts?fields=id,name,access_token,category&limit=100`;
    while (url) {
      const resp: FbAccountsResponse = await fetchJson(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      pages.push(...resp.data);
      url = resp.paging?.next;
    }
    return pages.map((p) => ({
      accountId: p.id,
      accountName: p.name,
      accessToken: p.access_token,
      extra: p.category ? { category: p.category } : undefined,
    }));
  },

  async publish({
    accessToken,
    accountId,
    text,
    imageBuffer,
    imageUrl,
  }: PublishParams): Promise<PublishResult> {
    // Facebook Pages API: use /photos with source (multipart) or url for
    // posts with an image, otherwise /feed for a text-only post.
    if (!imageBuffer && !imageUrl) {
      const resp = await postForm<{ id: string }>(
        `${FB_GRAPH_BASE}/${accountId}/feed`,
        {
          message: text,
          access_token: accessToken,
        },
      );
      return {
        postId: resp.id,
        postUrl: `https://www.facebook.com/${resp.id}`,
      };
    }

    // Prefer imageUrl when available (Facebook downloads it). Otherwise
    // fall back to multipart upload of the raw buffer.
    if (imageUrl) {
      const resp = await postForm<{ id: string; post_id?: string }>(
        `${FB_GRAPH_BASE}/${accountId}/photos`,
        {
          url: imageUrl,
          caption: text,
          access_token: accessToken,
        },
      );
      const postId = resp.post_id ?? resp.id;
      return {
        postId,
        postUrl: `https://www.facebook.com/${postId}`,
      };
    }

    // Multipart upload of raw buffer.
    const form = new FormData();
    const blob = new Blob([new Uint8Array(imageBuffer!)], { type: "image/png" });
    form.append("source", blob, "image.png");
    form.append("caption", text);
    form.append("access_token", accessToken);
    const res = await fetch(`${FB_GRAPH_BASE}/${accountId}/photos`, {
      method: "POST",
      body: form,
    });
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`Facebook photo upload failed (${res.status}): ${bodyText.slice(0, 400)}`);
    }
    const body = JSON.parse(bodyText) as { id: string; post_id?: string };
    const postId = body.post_id ?? body.id;
    return {
      postId,
      postUrl: `https://www.facebook.com/${postId}`,
    };
  },
};
