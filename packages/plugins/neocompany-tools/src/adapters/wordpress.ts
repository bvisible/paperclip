/**
 * WordPress REST adapter — the lightweight replacement for the legacy Postiz
 * `WordPressService.wpFetch()` helper. Handles URL composition, Basic auth
 * (username + application password), and error normalisation. Zero NestJS
 * dependencies.
 *
 * Also exposes `wcFetch` for the WooCommerce REST namespace (`/wp-json/wc/v3`),
 * which accepts the same Basic Auth as wp/v2 when the user has the Manage
 * WooCommerce capability (admin / shop manager). This avoids provisioning a
 * separate WC consumer key/secret per tenant.
 */

export interface WordPressConfig {
  /** Base site URL, e.g. `https://neoservice.ai` (no trailing `/wp-json`). */
  siteUrl: string;
  /** WordPress username with REST write access. */
  username: string;
  /** WordPress Application Password — resolved from a plugin secret ref. */
  appPassword: string;
}

export interface WpFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

//// Neocompany Modification — Some endpoints (notably WC product listing)
//// return paginated responses with totals exposed via response headers. The
//// raw response wrapper lets callers inspect those headers without losing
//// the parsed body.
//// End Neocompany Modification
export interface WpFetchResult<T> {
  data: T;
  totalPages: number;
  total: number;
}

export class WordPressFetchError extends Error {
  readonly status: number;
  readonly detail: unknown;
  constructor(status: number, message: string, detail: unknown) {
    super(message);
    this.name = "WordPressFetchError";
    this.status = status;
    this.detail = detail;
  }
}

function basicAuth(username: string, appPassword: string): string {
  return "Basic " + Buffer.from(`${username}:${appPassword}`).toString("base64");
}

function normaliseBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

//// Neocompany Modification — Shared low-level fetch helper. The two public
//// wrappers (`wpFetch` for wp/v2, `wcFetch` for wc/v3) differ only by base
//// path, so extracting the common logic avoids drift in auth handling and
//// error normalisation.
//// End Neocompany Modification
async function apiFetch<T>(
  config: WordPressConfig,
  basePath: string,
  path: string,
  options: WpFetchOptions,
): Promise<WpFetchResult<T>> {
  const base = normaliseBaseUrl(config.siteUrl);
  const url = new URL(`${base}${basePath}${path.startsWith("/") ? path : `/${path}`}`);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    Authorization: basicAuth(config.username, config.appPassword),
    Accept: "application/json",
  };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: options.method ?? (options.body ? "POST" : "GET"),
      headers,
      body,
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new WordPressFetchError(0, `WordPress request failed: ${err instanceof Error ? err.message : String(err)}`, null);
  }

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    const detail = parsed as { message?: string; code?: string } | null;
    const msg = detail?.message ?? `WordPress API error ${res.status}`;
    throw new WordPressFetchError(res.status, msg, parsed);
  }

  // Tolerate fetch mocks that don't provide a Headers-shaped object.
  const getHeader = (name: string): string | null => {
    const h = (res as { headers?: { get?: (k: string) => string | null } }).headers;
    if (!h || typeof h.get !== "function") return null;
    return h.get(name);
  };
  const totalPagesHeader = getHeader("x-wp-totalpages");
  const totalHeader = getHeader("x-wp-total");
  return {
    data: parsed as T,
    totalPages: totalPagesHeader ? parseInt(totalPagesHeader, 10) || 1 : 1,
    total: totalHeader ? parseInt(totalHeader, 10) || 0 : 0,
  };
}

/**
 * Call the WordPress core REST API (wp/v2 namespace).
 *
 * @param config      Site credentials.
 * @param path        Endpoint path relative to `/wp-json/wp/v2`, e.g. `/posts`.
 * @param options     Optional method / body / query.
 */
export async function wpFetch<T = unknown>(
  config: WordPressConfig,
  path: string,
  options: WpFetchOptions = {},
): Promise<T> {
  const result = await apiFetch<T>(config, "/wp-json/wp/v2", path, options);
  return result.data;
}

//// Neocompany Modification — WP core fetch with pagination headers exposed.
//// Used by the WC catalog sync that needs to know how many pages to walk.
//// End Neocompany Modification
export async function wpFetchWithHeaders<T = unknown>(
  config: WordPressConfig,
  path: string,
  options: WpFetchOptions = {},
): Promise<WpFetchResult<T>> {
  return apiFetch<T>(config, "/wp-json/wp/v2", path, options);
}

//// Neocompany Modification — WooCommerce REST API (wc/v3 namespace).
//// Accepts the same Basic Auth as wp/v2 when the underlying user has the
//// Manage WooCommerce capability. This avoids provisioning a separate WC
//// consumer key/secret pair per tenant.
//// End Neocompany Modification
export async function wcFetch<T = unknown>(
  config: WordPressConfig,
  path: string,
  options: WpFetchOptions = {},
): Promise<T> {
  const result = await apiFetch<T>(config, "/wp-json/wc/v3", path, options);
  return result.data;
}

export async function wcFetchWithHeaders<T = unknown>(
  config: WordPressConfig,
  path: string,
  options: WpFetchOptions = {},
): Promise<WpFetchResult<T>> {
  return apiFetch<T>(config, "/wp-json/wc/v3", path, options);
}
