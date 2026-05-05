/**
 * Frappe HTTP adapter.
 *
 * Every NORA tool call routes through here. This is the ONE place where
 * we talk to Frappe — tools stay pure data transformations.
 *
 * Frappe convention:
 *   Authorization: token <api_key>:<api_secret>
 *   POST /api/method/<dotted.path.to.whitelisted.method>
 *   body: JSON args matching the method signature
 *   response: { message: <return value>, exc_type?, exception? } or bare JSON
 */

export interface FrappeConfig {
  /** Base URL including scheme, no trailing slash. E.g. "https://osiris.neoffice.me" */
  url: string;
  /** Frappe API key (the one bound to a User). */
  apiKey: string;
  /** Frappe API secret. */
  apiSecret: string;
  /** Optional site name (multi-site bench). Passed as X-Frappe-Site-Name. */
  siteName?: string;
  /** Per-call timeout. Default 60s — ERP writes can be slow. */
  timeoutMs?: number;
}

export class FrappeFetchError extends Error {
  constructor(
    public readonly status: number,
    public readonly excType: string,
    public readonly body: unknown,
    message?: string,
  ) {
    super(message ?? `Frappe ${status} ${excType}`);
    this.name = "FrappeFetchError";
  }
}

/**
 * Call a whitelisted Frappe method with typed input and response.
 *
 * @param config Credentials + endpoint.
 * @param endpoint Dotted path, e.g. "nora.api.frappe_tools_whitelist.count_documents"
 * @param body Arguments the method expects (positional or keyword — Frappe accepts either).
 * @returns Whatever the method returns under `response.message`, or the whole
 *          response body if it's not wrapped.
 * @throws FrappeFetchError on non-2xx or Frappe exception.
 */
export async function frappeFetch<T>(
  config: FrappeConfig,
  endpoint: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const cleanBase = config.url.replace(/\/+$/, "");
  const url = `${cleanBase}/api/method/${endpoint}`;

  const headers: Record<string, string> = {
    Authorization: `token ${config.apiKey}:${config.apiSecret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (config.siteName) {
    headers["X-Frappe-Site-Name"] = config.siteName;
  }

  const controller = new AbortController();
  const timeoutMs = config.timeoutMs ?? 60_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === "AbortError") {
      throw new FrappeFetchError(0, "Timeout", null, `Frappe request timed out after ${timeoutMs}ms`);
    }
    throw new FrappeFetchError(0, "NetworkError", null, `Frappe network error: ${(err as Error).message}`);
  }
  clearTimeout(timeout);

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Non-JSON response (HTML 500 page, etc.)
      throw new FrappeFetchError(res.status, "NonJsonResponse", text.slice(0, 500));
    }
  }

  if (!res.ok) {
    const parsedObj = (parsed as Record<string, unknown>) ?? {};
    const excType = (parsedObj.exc_type as string) ?? "FrappeError";
    const exception = (parsedObj.exception as string) ?? text.slice(0, 500);
    throw new FrappeFetchError(res.status, excType, parsed, exception);
  }

  const obj = (parsed as Record<string, unknown>) ?? {};
  // Frappe convention: successful whitelisted responses are wrapped in { message: ... }
  if ("message" in obj) {
    return obj.message as T;
  }
  return parsed as T;
}

/**
 * Multipart upload to Frappe (`/api/method/upload_file`). Used by file upload
 * tools — Frappe expects `file` as a multipart binary part plus optional
 * `is_private`, `doctype`, `docname`, `fieldname`, `folder` form fields.
 *
 * The agent passes `fileContentBase64` (string) which we decode into a Blob.
 * For attaching to an existing document, set `doctype` + `docname` so Frappe
 * links the File record automatically.
 */
export async function frappeFetchMultipart<T>(
  config: FrappeConfig,
  endpoint: string,
  fields: Record<string, string>,
  file: { name: string; contentBase64: string; mimeType?: string },
): Promise<T> {
  const cleanBase = config.url.replace(/\/+$/, "");
  const url = `${cleanBase}/api/method/${endpoint}`;

  const headers: Record<string, string> = {
    Authorization: `token ${config.apiKey}:${config.apiSecret}`,
    Accept: "application/json",
    // Note: do NOT set Content-Type — fetch() will derive multipart boundary.
  };
  if (config.siteName) {
    headers["X-Frappe-Site-Name"] = config.siteName;
  }

  // Decode base64 → bytes → Blob.
  const binary = Buffer.from(file.contentBase64, "base64");
  const blob = new Blob([binary], { type: file.mimeType ?? "application/octet-stream" });

  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    form.append(k, v);
  }
  form.append("file", blob, file.name);

  const controller = new AbortController();
  const timeoutMs = config.timeoutMs ?? 120_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === "AbortError") {
      throw new FrappeFetchError(0, "Timeout", null, `Frappe upload timed out after ${timeoutMs}ms`);
    }
    throw new FrappeFetchError(0, "NetworkError", null, `Frappe upload network error: ${(err as Error).message}`);
  }
  clearTimeout(timeout);

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new FrappeFetchError(res.status, "NonJsonResponse", text.slice(0, 500));
    }
  }

  if (!res.ok) {
    const parsedObj = (parsed as Record<string, unknown>) ?? {};
    const excType = (parsedObj.exc_type as string) ?? "FrappeError";
    const exception = (parsedObj.exception as string) ?? text.slice(0, 500);
    throw new FrappeFetchError(res.status, excType, parsed, exception);
  }

  const obj = (parsed as Record<string, unknown>) ?? {};
  if ("message" in obj) {
    return obj.message as T;
  }
  return parsed as T;
}
