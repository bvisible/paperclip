//// Neoffice Modification: vite-base-paperclip-prefix
//// Why: When Paperclip is served under /paperclip/ on Neoffice, fetch("/api/...")
////      hits Frappe instead of Paperclip's Express server. Prefix all client-side
////      API calls (REST, EventSource, WebSocket) with import.meta.env.BASE_URL so
////      they resolve to /paperclip/api/... when deployed sub-path.
//// Date: 2026-05-04
//// Refs: NORA #26 — sub-path Vite deployment
const RAW_BASE = import.meta.env.BASE_URL || "/";
const NORMALIZED_BASE = RAW_BASE.endsWith("/") ? RAW_BASE : `${RAW_BASE}/`;
export const API_BASE = `${NORMALIZED_BASE}api`;
//// End Neoffice Modification: vite-base-paperclip-prefix

const BASE = API_BASE;

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? undefined);
  const body = init?.body;
  if (!(body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BASE}${path}`, {
    headers,
    credentials: "include",
    ...init,
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new ApiError(
      (errorBody as { error?: string } | null)?.error ?? `Request failed: ${res.status}`,
      res.status,
      errorBody,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  postForm: <T>(path: string, body: FormData) =>
    request<T>(path, { method: "POST", body }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
