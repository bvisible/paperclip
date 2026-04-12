/**
 * WordPress REST adapter — the lightweight replacement for the legacy Postiz
 * `WordPressService.wpFetch()` helper. Handles URL composition, Basic auth
 * (username + application password), and error normalisation. Zero NestJS
 * dependencies.
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

/**
 * Call the WordPress REST API.
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
  const base = normaliseBaseUrl(config.siteUrl);
  const url = new URL(`${base}/wp-json/wp/v2${path.startsWith("/") ? path : `/${path}`}`);
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

  return parsed as T;
}
