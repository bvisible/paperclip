/**
 * LinkedIn provider — personal member posts (w_member_social).
 *
 * OAuth 2.0 with PKCE. Uses LinkedIn's OpenID Connect userinfo endpoint
 * to resolve the account identity after exchange. The publish step is
 * declared but implemented in Phase L (publisher cron) — for now the
 * phase K scope is limited to connect / disconnect / refresh.
 *
 * References consulted (public LinkedIn developer docs, no code reused):
 *  - https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
 *  - https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
 *  - https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
 */

import { buildQuery, expiresAtFromSeconds, fetchJson, postForm } from "./base.js";
import type {
  AccountInfo,
  AuthResult,
  AuthUrl,
  AuthUrlParams,
  ExchangeCodeParams,
  PublishParams,
  PublishResult,
  RefreshTokenParams,
  SocialProvider,
} from "./types.js";

const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const LINKEDIN_UGC_POSTS_URL = "https://api.linkedin.com/v2/ugcPosts";
const LINKEDIN_ASSETS_REGISTER_URL =
  "https://api.linkedin.com/v2/assets?action=registerUpload";

const DEFAULT_SCOPES = ["openid", "profile", "email", "w_member_social"];

interface LinkedInTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

interface LinkedInUserInfo {
  sub: string;
  name: string;
  email?: string;
  picture?: string;
}

export const linkedin: SocialProvider = {
  key: "linkedin",
  displayName: "LinkedIn",
  scopes: DEFAULT_SCOPES,
  recommendedFeedDimensions: { width: 1200, height: 627 },

  buildAuthUrl({ clientId, redirectUri, state, scopes }: AuthUrlParams): AuthUrl {
    // LinkedIn Standalone apps authenticate with client_secret on the
    // /accessToken endpoint. PKCE alongside a secret makes LinkedIn return
    // invalid_client, so we skip PKCE here and rely on the secret.
    const qs = buildQuery({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: (scopes ?? DEFAULT_SCOPES).join(" "),
    });
    return {
      url: `${LINKEDIN_AUTH_URL}?${qs}`,
    };
  },

  async exchangeCode({
    clientId,
    clientSecret,
    code,
    redirectUri,
    codeVerifier,
  }: ExchangeCodeParams): Promise<AuthResult> {
    const body: Record<string, string | undefined> = {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    };
    if (codeVerifier) body.code_verifier = codeVerifier;

    const res = await postForm<LinkedInTokenResponse>(LINKEDIN_TOKEN_URL, body);
    return {
      accessToken: res.access_token,
      refreshToken: res.refresh_token,
      expiresAt: expiresAtFromSeconds(res.expires_in),
      scopes: res.scope ? res.scope.split(/\s+/).filter(Boolean) : undefined,
    };
  },

  async refreshToken({
    clientId,
    clientSecret,
    refreshToken,
  }: RefreshTokenParams): Promise<AuthResult> {
    const res = await postForm<LinkedInTokenResponse>(LINKEDIN_TOKEN_URL, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });
    return {
      accessToken: res.access_token,
      refreshToken: res.refresh_token ?? refreshToken,
      expiresAt: expiresAtFromSeconds(res.expires_in),
      scopes: res.scope ? res.scope.split(/\s+/).filter(Boolean) : undefined,
    };
  },

  async getAccountInfo(accessToken: string): Promise<AccountInfo> {
    const info = await fetchJson<LinkedInUserInfo>(LINKEDIN_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // LinkedIn v2 UGC posts target an `urn:li:person:<sub>` author. We
    // store the URN form so Phase L publish code can use it directly.
    return {
      accountId: `urn:li:person:${info.sub}`,
      accountName: info.name,
      iconUrl: info.picture,
    };
  },

  async publish({
    accessToken,
    accountId,
    text,
    imageBuffer,
    imageMimeType,
  }: PublishParams): Promise<PublishResult> {
    // accountId is already the full URN (urn:li:person:<sub>) because we
    // store it that way in getAccountInfo.
    const authorUrn = accountId;

    let imageAssetUrn: string | undefined;
    if (imageBuffer && imageBuffer.length > 0) {
      imageAssetUrn = await uploadLinkedInImage({
        accessToken,
        authorUrn,
        buffer: imageBuffer,
        mimeType: imageMimeType ?? "image/png",
      });
    }

    const shareMedia: Array<Record<string, unknown>> = imageAssetUrn
      ? [
          {
            status: "READY",
            description: { text: "" },
            media: imageAssetUrn,
            title: { text: "" },
          },
        ]
      : [];

    const body = {
      author: authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text },
          shareMediaCategory: imageAssetUrn ? "IMAGE" : "NONE",
          ...(shareMedia.length > 0 ? { media: shareMedia } : {}),
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
      },
    };

    const res = await fetch(LINKEDIN_UGC_POSTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
    });
    const responseText = await res.text();
    if (!res.ok) {
      throw new Error(`LinkedIn UGC post failed (${res.status}): ${responseText.slice(0, 400)}`);
    }
    // Header `x-restli-id` carries the post URN on success.
    const postUrn = res.headers.get("x-restli-id") ?? "";
    return {
      postId: postUrn,
      postUrl: postUrn ? `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}/` : undefined,
    };
  },
};

// ---------------------------------------------------------------------------
// LinkedIn image upload helper
// ---------------------------------------------------------------------------

interface UploadParams {
  accessToken: string;
  authorUrn: string;
  buffer: Buffer;
  mimeType: string;
}

interface RegisterUploadResponse {
  value: {
    uploadMechanism: {
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": {
        uploadUrl: string;
        headers?: Record<string, string>;
      };
    };
    asset: string;
  };
}

async function uploadLinkedInImage({
  accessToken,
  authorUrn,
  buffer,
  mimeType,
}: UploadParams): Promise<string> {
  const registerBody = {
    registerUploadRequest: {
      recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
      owner: authorUrn,
      serviceRelationships: [
        {
          relationshipType: "OWNER",
          identifier: "urn:li:userGeneratedContent",
        },
      ],
    },
  };
  const registerRes = await fetchJson<RegisterUploadResponse>(LINKEDIN_ASSETS_REGISTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(registerBody),
  });
  const mechanism =
    registerRes.value.uploadMechanism[
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
    ];
  const uploadUrl = mechanism.uploadUrl;
  if (!uploadUrl) throw new Error("LinkedIn register upload returned no uploadUrl");

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": mimeType,
      ...(mechanism.headers ?? {}),
    },
    body: new Uint8Array(buffer),
  });
  if (!uploadRes.ok) {
    const errorBody = await uploadRes.text().catch(() => "");
    throw new Error(
      `LinkedIn image upload failed (${uploadRes.status}): ${errorBody.slice(0, 300)}`,
    );
  }

  return registerRes.value.asset;
}
