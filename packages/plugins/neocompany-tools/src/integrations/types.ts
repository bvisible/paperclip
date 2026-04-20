/**
 * Social integrations — provider-agnostic contracts.
 *
 * Each provider (LinkedIn, Facebook, Instagram…) implements `SocialProvider`
 * with the endpoints / scopes / body shape specific to its API. The plugin
 * worker and the bridge routes only know about this interface — never the
 * concrete providers directly — so adding a new network stays local to one
 * file.
 */

export type SocialProviderKey = "linkedin" | "facebook" | "instagram";

export interface SocialProviderMeta {
  key: SocialProviderKey;
  displayName: string;
  /** Default OAuth scopes requested. */
  scopes: string[];
  /** Recommended dimensions for feed posts (px). */
  recommendedFeedDimensions: { width: number; height: number };
}

/** Input to `buildAuthUrl` — callback URL + any stateful data. */
export interface AuthUrlParams {
  clientId: string;
  /** Must match the redirect URL registered in the provider's developer
   *  portal. We use a single, platform-wide URL; per-company identity is
   *  carried in the `state` param. */
  redirectUri: string;
  /** Opaque state value — random + (optionally) HMAC-signed. */
  state: string;
  /** Optional: override scopes. */
  scopes?: string[];
}

export interface AuthUrl {
  url: string;
  /** Present when the provider requires PKCE (LinkedIn + Instagram). */
  codeVerifier?: string;
}

export interface ExchangeCodeParams {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface RefreshTokenParams {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface AuthResult {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds at which the token expires, or null if long-lived. */
  expiresAt: number | null;
  /** Scopes actually granted (may differ from requested). */
  scopes?: string[];
}

export interface AccountInfo {
  /** Provider-specific account id — URN for LinkedIn, page id for FB, etc. */
  accountId: string;
  accountName: string;
  /** Optional profile / page icon URL. */
  iconUrl?: string;
}

export interface PublishParams {
  accessToken: string;
  accountId: string;
  text: string;
  /** Publicly-reachable image URL OR data URL. Providers that require a
   *  public URL (Instagram) fail if only a data URL is given. */
  imageUrl?: string;
  /** Optional raw binary for providers that accept multipart upload. */
  imageBuffer?: Buffer;
  imageMimeType?: string;
}

export interface PublishResult {
  /** Provider-side post id (URN, media id, etc.). */
  postId: string;
  /** Public URL to the published post, when the provider exposes one. */
  postUrl?: string;
}

/**
 * Per-account override for the stored token and any provider-specific
 * material (e.g. Facebook page access token). Returned by `listAccounts`
 * so the callback can persist one row per account with the correct
 * access token instead of the user-level one.
 */
export interface DiscoveredAccount extends AccountInfo {
  /** When provided, overrides the auth access token for this account.
   *  Facebook Pages return a per-page access token; Instagram accounts
   *  share the page token. */
  accessToken?: string;
  /** Optional extra metadata (ig user id linked to this fb page, etc.). */
  extra?: Record<string, unknown>;
}

export interface SocialProvider extends SocialProviderMeta {
  buildAuthUrl(params: AuthUrlParams): AuthUrl;
  exchangeCode(params: ExchangeCodeParams): Promise<AuthResult>;
  refreshToken?(params: RefreshTokenParams): Promise<AuthResult>;
  getAccountInfo(accessToken: string): Promise<AccountInfo>;
  /** Optional: for providers that can return multiple managed accounts
   *  after a single OAuth flow (Facebook Pages, Instagram accounts). The
   *  callback route stores one StoredChannelToken per entry. */
  listAccounts?(accessToken: string): Promise<DiscoveredAccount[]>;
  publish?(params: PublishParams): Promise<PublishResult>;
}

/**
 * Shape of the token record stored in `plugin_state` scope=company under
 * key `channel:<provider>:<accountId>`. Only consumed by the worker — never
 * leaks to the UI (which sees a redacted summary).
 */
export interface StoredChannelToken {
  provider: SocialProviderKey;
  accountId: string;
  accountName: string;
  iconUrl?: string;
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms, or null when the token never expires. */
  expiresAt: number | null;
  scopes?: string[];
  /** ISO timestamp — when the OAuth flow completed. */
  connectedAt: string;
  /** ISO timestamp — last successful refresh, if any. */
  refreshedAt?: string;
}

/**
 * Shape of the transient record stored under `plugin_state` scope=instance
 * key `oauth-pending:<state>`. TTL ~10 min — cleared on callback or on
 * the next tick after expiration.
 */
export interface PendingOAuthState {
  state: string;
  provider: SocialProviderKey;
  companyId: string;
  codeVerifier?: string;
  /** Epoch ms — state expires at this timestamp. */
  expiresAt: number;
  /** Where to redirect the user after the callback completes. */
  returnTo: string;
}
