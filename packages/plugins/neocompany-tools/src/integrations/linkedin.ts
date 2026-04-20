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

import { buildPkce, buildQuery, expiresAtFromSeconds, fetchJson, postForm } from "./base.js";
import type {
  AccountInfo,
  AuthResult,
  AuthUrl,
  AuthUrlParams,
  ExchangeCodeParams,
  RefreshTokenParams,
  SocialProvider,
} from "./types.js";

const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

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
    const pkce = buildPkce();
    const qs = buildQuery({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: (scopes ?? DEFAULT_SCOPES).join(" "),
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
    });
    return {
      url: `${LINKEDIN_AUTH_URL}?${qs}`,
      codeVerifier: pkce.verifier,
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

  // publish() — implemented in Phase L (publisher cron). For now we just
  // declare the provider so Connect/Disconnect works end-to-end.
};
