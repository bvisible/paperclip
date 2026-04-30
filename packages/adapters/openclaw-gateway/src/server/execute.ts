import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterRuntimeServiceReport,
} from "@paperclipai/adapter-utils";
import {
  asNumber,
  asString,
  buildPaperclipEnv,
  parseObject,
  renderPaperclipWakePrompt,
  stringifyPaperclipWakePayload,
} from "@paperclipai/adapter-utils/server-utils";
import crypto, { randomUUID } from "node:crypto";
import { promises as fsPromises } from "node:fs";
import { homedir } from "node:os";
import { WebSocket } from "ws";

type SessionKeyStrategy = "fixed" | "issue" | "run";

type WakePayload = {
  runId: string;
  agentId: string;
  companyId: string;
  taskId: string | null;
  issueId: string | null;
  wakeReason: string | null;
  wakeCommentId: string | null;
  approvalId: string | null;
  approvalStatus: string | null;
  issueIds: string[];
};

type GatewayDeviceIdentity = {
  deviceId: string;
  publicKeyRawBase64Url: string;
  privateKeyPem: string;
  source: "configured" | "ephemeral";
};

type GatewayRequestFrame = {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
};

type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
  };
};

type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  expectFinal: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

type GatewayResponseError = Error & {
  gatewayCode?: string;
  gatewayDetails?: Record<string, unknown>;
};

type GatewayClientOptions = {
  url: string;
  headers: Record<string, string>;
  onEvent: (frame: GatewayEventFrame) => Promise<void> | void;
  onLog: AdapterExecutionContext["onLog"];
};

type GatewayClientRequestOptions = {
  timeoutMs: number;
  expectFinal?: boolean;
};

const PROTOCOL_VERSION = 3;
const DEFAULT_SCOPES = ["operator.admin"];
const DEFAULT_CLIENT_ID = "gateway-client";
const DEFAULT_CLIENT_MODE = "backend";
const DEFAULT_CLIENT_VERSION = "paperclip";
const DEFAULT_ROLE = "operator";

const SENSITIVE_LOG_KEY_PATTERN =
  /(^|[_-])(auth|authorization|token|secret|password|api[_-]?key|private[_-]?key)([_-]|$)|^x-openclaw-(auth|token)$/i;

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseOptionalPositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return Math.max(1, Math.floor(parsed));
  }
  return null;
}

function parseBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return fallback;
}

function normalizeSessionKeyStrategy(value: unknown): SessionKeyStrategy {
  const normalized = asString(value, "issue").trim().toLowerCase();
  if (normalized === "fixed" || normalized === "run") return normalized;
  return "issue";
}

function prefixSessionKeyForAgent(sessionKey: string, agentId: string | null): string {
  if (!agentId || sessionKey.startsWith("agent:")) return sessionKey;
  return `agent:${agentId}:${sessionKey}`;
}

export function resolveSessionKey(input: {
  strategy: SessionKeyStrategy;
  configuredSessionKey: string | null;
  agentId: string | null;
  runId: string;
  issueId: string | null;
}): string {
  const fallback = input.configuredSessionKey ?? "paperclip";
  if (input.strategy === "run") {
    return prefixSessionKeyForAgent(`paperclip:run:${input.runId}`, input.agentId);
  }
  if (input.strategy === "issue" && input.issueId) {
    return prefixSessionKeyForAgent(`paperclip:issue:${input.issueId}`, input.agentId);
  }
  return prefixSessionKeyForAgent(fallback, input.agentId);
}

function isLoopbackHost(hostname: string): boolean {
  const value = hostname.trim().toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

function toStringRecord(value: unknown): Record<string, string> {
  const parsed = parseObject(value);
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeScopes(value: unknown): string[] {
  const parsed = toStringArray(value);
  return parsed.length > 0 ? parsed : [...DEFAULT_SCOPES];
}

function uniqueScopes(scopes: string[]): string[] {
  return Array.from(new Set(scopes.map((scope) => scope.trim()).filter(Boolean)));
}

function headerMapGetIgnoreCase(headers: Record<string, string>, key: string): string | null {
  const match = Object.entries(headers).find(([entryKey]) => entryKey.toLowerCase() === key.toLowerCase());
  return match ? match[1] : null;
}

function headerMapHasIgnoreCase(headers: Record<string, string>, key: string): boolean {
  return Object.keys(headers).some((entryKey) => entryKey.toLowerCase() === key.toLowerCase());
}

function getGatewayErrorDetails(err: unknown): Record<string, unknown> | null {
  if (!err || typeof err !== "object") return null;
  const candidate = (err as GatewayResponseError).gatewayDetails;
  return asRecord(candidate);
}

function extractPairingRequestId(err: unknown): string | null {
  const details = getGatewayErrorDetails(err);
  const fromDetails = nonEmpty(details?.requestId);
  if (fromDetails) return fromDetails;
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/requestId\s*[:=]\s*([A-Za-z0-9_-]+)/i);
  return match?.[1] ?? null;
}

function toAuthorizationHeaderValue(rawToken: string): string {
  const trimmed = rawToken.trim();
  if (!trimmed) return trimmed;
  return /^bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

function tokenFromAuthHeader(rawHeader: string | null): string | null {
  if (!rawHeader) return null;
  const trimmed = rawHeader.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^bearer\s+(.+)$/i);
  return match ? nonEmpty(match[1]) : trimmed;
}

function resolveAuthToken(config: Record<string, unknown>, headers: Record<string, string>): string | null {
  const explicit = nonEmpty(config.authToken) ?? nonEmpty(config.token);
  if (explicit) return explicit;

  const tokenHeader = headerMapGetIgnoreCase(headers, "x-openclaw-token");
  if (nonEmpty(tokenHeader)) return nonEmpty(tokenHeader);

  const authHeader =
    headerMapGetIgnoreCase(headers, "x-openclaw-auth") ??
    headerMapGetIgnoreCase(headers, "authorization");
  return tokenFromAuthHeader(authHeader);
}

function isSensitiveLogKey(key: string): boolean {
  return SENSITIVE_LOG_KEY_PATTERN.test(key.trim());
}

function sha256Prefix(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function redactSecretForLog(value: string): string {
  return `[redacted len=${value.length} sha256=${sha256Prefix(value)}]`;
}

function truncateForLog(value: string, maxChars = 320): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}... [truncated ${value.length - maxChars} chars]`;
}

function redactForLog(value: unknown, keyPath: string[] = [], depth = 0): unknown {
  const currentKey = keyPath[keyPath.length - 1] ?? "";
  if (typeof value === "string") {
    if (isSensitiveLogKey(currentKey)) return redactSecretForLog(value);
    return truncateForLog(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= 6) return "[array-truncated]";
    const out = value.slice(0, 20).map((entry, index) => redactForLog(entry, [...keyPath, `${index}`], depth + 1));
    if (value.length > 20) out.push(`[+${value.length - 20} more items]`);
    return out;
  }
  if (typeof value === "object") {
    if (depth >= 6) return "[object-truncated]";
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [key, entry] of entries.slice(0, 80)) {
      out[key] = redactForLog(entry, [...keyPath, key], depth + 1);
    }
    if (entries.length > 80) {
      out.__truncated__ = `+${entries.length - 80} keys`;
    }
    return out;
  }
  return String(value);
}

function stringifyForLog(value: unknown, maxChars: number): string {
  const text = JSON.stringify(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}... [truncated ${text.length - maxChars} chars]`;
}

function buildWakePayload(ctx: AdapterExecutionContext): WakePayload {
  const { runId, agent, context } = ctx;
  return {
    runId,
    agentId: agent.id,
    companyId: agent.companyId,
    taskId: nonEmpty(context.taskId) ?? nonEmpty(context.issueId),
    issueId: nonEmpty(context.issueId),
    wakeReason: nonEmpty(context.wakeReason),
    wakeCommentId: nonEmpty(context.wakeCommentId) ?? nonEmpty(context.commentId),
    approvalId: nonEmpty(context.approvalId),
    approvalStatus: nonEmpty(context.approvalStatus),
    issueIds: Array.isArray(context.issueIds)
      ? context.issueIds.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0,
        )
      : [],
  };
}

function resolvePaperclipApiUrlOverride(value: unknown): string | null {
  const raw = nonEmpty(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

const DEFAULT_CLAIMED_API_KEY_PATH = "~/.openclaw/workspace/paperclip-claimed-api-key.json";

function resolveClaimedApiKeyPath(value: unknown): string {
  return nonEmpty(value) ?? DEFAULT_CLAIMED_API_KEY_PATH;
}

// =============================================================================
// NORA function-calls native — Phase 2.2
// =============================================================================
//
// The adapter exposes plugin tools (e.g. nora-frappe-tools) as OpenAI-style
// `clientTools` in the agent.run payload, so the LLM can invoke them via
// native `tool_calls` instead of being asked to emit `<tool_call>` text or
// shell out to `curl POST /api/plugins/tools/execute`.
//
// Flow on a wake event:
//  1. Load the API key from the claim file written by the agent at first wake.
//  2. GET /api/plugins/tools to list the tools available to this agent.
//  3. Convert AgentToolDescriptor[] -> ClientToolDefinition[] and inject in
//     agentParams.clientTools.
//  4. Send agent.run via WebSocket. OpenClaw fork (>= dae7845) accepts the new
//     `clientTools` field on AgentParamsSchema.
//  5. If the run terminates with stopReason="tool_calls", iterate up to
//     MAX_FUNCTION_CALL_ROUNDTRIPS times: execute the tool via
//     POST /api/plugins/tools/execute and re-issue agent.run with the result
//     embedded in the next message (Option A — see
//     NORA/19-function-calls-natifs/04-...). When stopReason flips back to
//     `end_turn` (or anything other than `tool_calls`), the final answer is in
//     the assistant chunks / payloads, and we exit the loop.
//
// If the claim file is missing (first wake on a fresh workspace), or the API
// is unreachable, the function returns null/empty arrays and the run proceeds
// without clientTools — falling back to the legacy behaviour rather than
// failing the wake.

const MAX_FUNCTION_CALL_ROUNDTRIPS = 5;

function expandHomePath(path: string): string {
  if (path.startsWith("~/")) {
    return `${homedir()}/${path.slice(2)}`;
  }
  return path;
}

async function loadClaimedApiKey(claimedApiKeyPath: string): Promise<string | null> {
  try {
    const expanded = expandHomePath(claimedApiKeyPath);
    const content = await fsPromises.readFile(expanded, "utf8");
    const json = JSON.parse(content) as { apiKey?: unknown };
    return typeof json.apiKey === "string" && json.apiKey.length > 0 ? json.apiKey : null;
  } catch {
    return null;
  }
}

type AgentToolDescriptor = {
  name: string;
  displayName?: string;
  description: string;
  parametersSchema: Record<string, unknown>;
  pluginId?: string;
};

async function fetchAvailableTools(
  apiUrl: string,
  apiKey: string,
  toolFilter?: ReadonlySet<string>,
): Promise<AgentToolDescriptor[]> {
  const url = new URL("/api/plugins/tools", apiUrl).toString();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`fetchAvailableTools failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as unknown;
  const all = Array.isArray(json) ? (json as AgentToolDescriptor[]) : [];
  // NORA Phase 5 — apply per-agent filter when provided. Without this all
  // 48 plugin tools are sent to every agent and Qwen3.6 spends turns
  // exploring tools that aren't relevant to the question (e.g. calling
  // `frappeFieldInfo` four times before answering "how many customers"
  // — each call returns ~18 KB and overflows the model context window).
  if (!toolFilter || toolFilter.size === 0) return all;
  return all.filter((t) => toolFilter.has(t.name));
}

/**
 * Per-agent tool allow-list for native function-calling. Maps the OpenClaw
 * agent id to the namespaced tool names that agent should see in its
 * clientTools array. Adapter config can override via
 * `clientToolAllowlist: string[]`.
 */
const DEFAULT_AGENT_TOOL_ALLOWLIST: Record<string, ReadonlySet<string>> = {
  "main-v15": new Set<string>([]), // text-only orchestrator
  "tools-v15": new Set<string>([
    "nora-frappe-tools:frappeDocumentCount",
    "nora-frappe-tools:frappeDocumentList",
    "nora-frappe-tools:frappeDocumentGet",
    "nora-frappe-tools:frappeDocumentInsert",
    "nora-frappe-tools:frappeDocumentUpdate",
    "nora-frappe-tools:frappeDocumentDelete",
    "nora-frappe-tools:frappeReportRun",
    "nora-frappe-tools:noraWorkItemComplete",
  ]),
  "sales-v15": new Set<string>([
    "nora-frappe-tools:frappeDocumentCount",
    "nora-frappe-tools:frappeDocumentList",
    "nora-frappe-tools:frappeDocumentGet",
    "nora-frappe-tools:frappeCustomerCreate",
    "nora-frappe-tools:frappeQuotationCreate",
    "nora-frappe-tools:frappeSalesInvoiceCreate",
    "nora-frappe-tools:frappeOutstandingReceivables",
    "nora-frappe-tools:frappeRevenueSummary",
    "nora-frappe-tools:noraWorkItemComplete",
  ]),
  "accounting-v15": new Set<string>([
    "nora-frappe-tools:frappeDocumentCount",
    "nora-frappe-tools:frappeDocumentList",
    "nora-frappe-tools:frappeDocumentGet",
    "nora-frappe-tools:frappePaymentEntryCreate",
    "nora-frappe-tools:frappeBankReconciliation",
    "nora-frappe-tools:noraTaxFiling",
    "nora-frappe-tools:frappeOutstandingReceivables",
    "nora-frappe-tools:frappeOutstandingPayables",
    "nora-frappe-tools:frappeRevenueSummary",
    "nora-frappe-tools:noraWorkItemComplete",
  ]),
  "hr-v15": new Set<string>([
    "nora-frappe-tools:frappeDocumentCount",
    "nora-frappe-tools:frappeDocumentList",
    "nora-frappe-tools:frappeDocumentGet",
    "nora-frappe-tools:frappeLeaveApply",
    "nora-frappe-tools:noraPayrollRun",
    "nora-frappe-tools:noraWorkItemComplete",
  ]),
  "purchasing-v15": new Set<string>([
    "nora-frappe-tools:frappeDocumentCount",
    "nora-frappe-tools:frappeDocumentList",
    "nora-frappe-tools:frappeDocumentGet",
    "nora-frappe-tools:frappeSupplierCreate",
    "nora-frappe-tools:frappePurchaseOrderCreate",
    "nora-frappe-tools:frappeOutstandingPayables",
    "nora-frappe-tools:noraWorkItemComplete",
  ]),
};

function resolveAgentToolFilter(ctx: AdapterExecutionContext): ReadonlySet<string> | undefined {
  // Adapter config has highest priority — operators can override the
  // default allowlist per agent.
  const cfgAllow = ctx.config.clientToolAllowlist;
  if (Array.isArray(cfgAllow)) {
    const names = cfgAllow.filter((v): v is string => typeof v === "string" && v.length > 0);
    return new Set<string>(names);
  }
  const agentId = nonEmpty(ctx.agent?.id) ?? nonEmpty(ctx.config.agentId);
  if (!agentId) return undefined;
  return DEFAULT_AGENT_TOOL_ALLOWLIST[agentId];
}

type PluginToolExecuteResponse = {
  result?: {
    content?: string;
    data?: unknown;
    error?: unknown;
  };
};

async function executePluginTool(
  apiUrl: string,
  apiKey: string,
  runId: string,
  tool: string,
  parameters: unknown,
): Promise<PluginToolExecuteResponse> {
  const url = new URL("/api/plugins/tools/execute", apiUrl).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Paperclip-Run-Id": runId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tool, parameters }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`executePluginTool failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as PluginToolExecuteResponse;
}

type ClientToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

function toClientTools(tools: AgentToolDescriptor[]): ClientToolDefinition[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parametersSchema,
    },
  }));
}

type PendingToolCall = {
  id: string;
  name: string;
  arguments: string;
};

function extractPendingToolCalls(payload: unknown): PendingToolCall[] {
  // OpenClaw WS responds with `{ runId, status, result: { payloads, meta } }`
  // (see src/gateway/server-methods/agent.ts:328 — the `result` field carries
  // the runEmbeddedPiAgent return value). Falls back to top-level `meta` for
  // older shapes / direct callers.
  const root = asRecord(payload);
  const meta =
    asRecord(asRecord(root?.result)?.meta) ?? asRecord(root?.meta);
  if (!meta) return [];
  const stopReason = nonEmpty(meta.stopReason);
  if (stopReason !== "tool_calls") return [];
  const raw = meta.pendingToolCalls;
  if (!Array.isArray(raw)) return [];
  const calls: PendingToolCall[] = [];
  for (const entry of raw) {
    const r = asRecord(entry);
    if (!r) continue;
    const id = nonEmpty(r.id);
    const name = nonEmpty(r.name);
    const args = typeof r.arguments === "string" ? r.arguments : JSON.stringify(r.arguments ?? {});
    if (id && name) {
      calls.push({ id, name, arguments: args });
    }
  }
  return calls;
}

function resolvePaperclipApiUrlForFetch(ctx: AdapterExecutionContext): string {
  const override = resolvePaperclipApiUrlOverride(ctx.config.paperclipApiUrl);
  if (override) return override;
  const port = asNumber(ctx.config.paperclipApiPort, 3100);
  return `http://127.0.0.1:${port}`;
}

// =============================================================================

function buildPaperclipEnvForWake(ctx: AdapterExecutionContext, wakePayload: WakePayload): Record<string, string> {
  const paperclipApiUrlOverride = resolvePaperclipApiUrlOverride(ctx.config.paperclipApiUrl);
  const paperclipEnv: Record<string, string> = {
    ...buildPaperclipEnv(ctx.agent),
    PAPERCLIP_RUN_ID: ctx.runId,
  };

  if (paperclipApiUrlOverride) {
    paperclipEnv.PAPERCLIP_API_URL = paperclipApiUrlOverride;
  }
  if (wakePayload.taskId) paperclipEnv.PAPERCLIP_TASK_ID = wakePayload.taskId;
  if (wakePayload.wakeReason) paperclipEnv.PAPERCLIP_WAKE_REASON = wakePayload.wakeReason;
  if (wakePayload.wakeCommentId) paperclipEnv.PAPERCLIP_WAKE_COMMENT_ID = wakePayload.wakeCommentId;
  if (wakePayload.approvalId) paperclipEnv.PAPERCLIP_APPROVAL_ID = wakePayload.approvalId;
  if (wakePayload.approvalStatus) paperclipEnv.PAPERCLIP_APPROVAL_STATUS = wakePayload.approvalStatus;
  if (wakePayload.issueIds.length > 0) {
    paperclipEnv.PAPERCLIP_LINKED_ISSUE_IDS = wakePayload.issueIds.join(",");
  }

  return paperclipEnv;
}

function buildWakeText(
  payload: WakePayload,
  paperclipEnv: Record<string, string>,
  structuredWakePrompt: string,
  claimedApiKeyPath: string,
  simpleMode: boolean,
  nativeFunctionCalls = false,
): string {
  // NORA Phase 4 — when native function-calls are wired the LLM has access to
  // plugin tools as native OpenAI tool_calls (executed inline by the runner
  // via patch 7's clientToolExecutor). The wake message must NOT forbid tool
  // calls; it should encourage them. Drop the long curl-procedure preamble
  // (irrelevant when tools are native) and just let the LLM plan its tool
  // calls naturally.
  if (nativeFunctionCalls) {
    return [
      `Paperclip wake event. Issue ${payload.issueId ?? ""}${payload.taskId && payload.taskId !== payload.issueId ? ` (task ${payload.taskId})` : ""}.`,
      "",
      "Use the tools available to you to answer or progress the issue. Each tool call is executed and its result returned in the same turn — formulate the final response based on the real result(s) you receive.",
      ...(structuredWakePrompt ? ["", structuredWakePrompt] : []),
    ].join("\n");
  }
  // simpleMode: agents without HTTP-tooling rights (tools.allow=[]) shouldn't
  // receive the procedural workflow — it leads them to emit unsupported
  // tool_call payloads they can't follow. Send only the structured payload so
  // they have the issue context and can reply in plain text. The runtime
  // captures their assistantChunks as the comment automatically.
  if (simpleMode) {
    return [
      `Paperclip wake event. Issue ${payload.issueId ?? ""}${payload.taskId && payload.taskId !== payload.issueId ? ` (task ${payload.taskId})` : ""}.`,
      "",
      "Reply in plain text. Do not call any tool — your reply will be posted as the issue's comment automatically.",
      ...(structuredWakePrompt ? ["", structuredWakePrompt] : []),
    ].join("\n");
  }

  const orderedKeys = [
    "PAPERCLIP_RUN_ID",
    "PAPERCLIP_AGENT_ID",
    "PAPERCLIP_COMPANY_ID",
    "PAPERCLIP_API_URL",
    "PAPERCLIP_TASK_ID",
    "PAPERCLIP_WAKE_REASON",
    "PAPERCLIP_WAKE_COMMENT_ID",
    "PAPERCLIP_APPROVAL_ID",
    "PAPERCLIP_APPROVAL_STATUS",
    "PAPERCLIP_LINKED_ISSUE_IDS",
  ];

  const envLines: string[] = [];
  for (const key of orderedKeys) {
    const value = paperclipEnv[key];
    if (!value) continue;
    envLines.push(`${key}=${value}`);
  }

  const issueIdHint = payload.taskId ?? payload.issueId ?? "";
  const apiBaseHint = paperclipEnv.PAPERCLIP_API_URL ?? "<set PAPERCLIP_API_URL>";

  const lines = [
    "Paperclip wake event for a cloud adapter.",
    "",
    "Run this procedure now. Do not guess undocumented endpoints and do not ask for additional heartbeat docs.",
    "",
    "Set these values in your run context:",
    ...envLines,
    `PAPERCLIP_API_KEY=<token from ${claimedApiKeyPath}>`,
    "",
    `Load PAPERCLIP_API_KEY from ${claimedApiKeyPath} (the token you saved after claim-api-key).`,
    "",
    `api_base=${apiBaseHint}`,
    `task_id=${payload.taskId ?? ""}`,
    `issue_id=${payload.issueId ?? ""}`,
    `wake_reason=${payload.wakeReason ?? ""}`,
    `wake_comment_id=${payload.wakeCommentId ?? ""}`,
    `approval_id=${payload.approvalId ?? ""}`,
    `approval_status=${payload.approvalStatus ?? ""}`,
    `linked_issue_ids=${payload.issueIds.join(",")}`,
    "",
    "HTTP rules:",
    "- Use Authorization: Bearer $PAPERCLIP_API_KEY on every API call.",
    "- Use X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID on every mutating API call.",
    "- Use only /api endpoints listed below.",
    "- Do NOT call guessed endpoints like /api/cloud-adapter/*, /api/cloud-adapters/*, /api/adapters/cloud/*, or /api/heartbeat.",
    "",
    "Workflow:",
    "1) GET /api/agents/me",
    `2) Determine issueId: PAPERCLIP_TASK_ID if present, otherwise issue_id (${issueIdHint}).`,
    "3) If issueId exists:",
    "   - POST /api/issues/{issueId}/checkout with {\"agentId\":\"$PAPERCLIP_AGENT_ID\",\"expectedStatuses\":[\"todo\",\"backlog\",\"blocked\",\"in_review\"]}",
    "   - GET /api/issues/{issueId}",
    "   - GET /api/issues/{issueId}/comments",
    "   - Execute the issue instructions exactly. If the issue is actionable, take concrete action in this run; do not stop at a plan unless planning was requested.",
    "   - Leave durable progress with a clear next action. Use child issues for long or parallel delegated work instead of polling agents, sessions, or processes.",
    "   - Create child issues directly when you know what needs to be done; use POST /api/issues/{issueId}/interactions with kind suggest_tasks, ask_user_questions, or request_confirmation when the board/user must choose, answer, or confirm before you can continue.",
    "   - For plan approval, update the plan document first, then create request_confirmation targeting the latest plan revision with idempotencyKey confirmation:{issueId}:plan:{revisionId}; wait for acceptance before creating implementation subtasks.",
    "   - If blocked, PATCH /api/issues/{issueId} with {\"status\":\"blocked\",\"comment\":\"what is blocked, who owns the unblock, and the next action\"}.",
    "   - If instructions require a comment, POST /api/issues/{issueId}/comments with {\"body\":\"...\"}.",
    "   - PATCH /api/issues/{issueId} with {\"status\":\"done\",\"comment\":\"what changed and why\"}.",
    "4) If issueId does not exist:",
    "   - GET /api/companies/$PAPERCLIP_COMPANY_ID/issues?assigneeAgentId=$PAPERCLIP_AGENT_ID&status=todo,in_progress,in_review,blocked",
    "   - Pick in_progress first, then in_review when you were woken by a comment, then todo, then blocked, then execute step 3.",
    "",
    "Useful endpoints for issue work:",
    "- POST /api/issues/{issueId}/comments",
    "- PATCH /api/issues/{issueId}",
    "- POST /api/companies/{companyId}/issues (when asked to create a new issue)",
    ...(structuredWakePrompt
      ? [
          "",
          structuredWakePrompt,
        ]
      : []),
    "",
    "Complete the workflow in this run.",
  ];
  return lines.join("\n");
}

function appendWakeText(baseText: string, wakeText: string): string {
  const trimmedBase = baseText.trim();
  return trimmedBase.length > 0 ? `${trimmedBase}\n\n${wakeText}` : wakeText;
}

function joinWakePayloadSections(structuredWakePrompt: string, structuredWakeJson: string): string {
  const sections = [
    structuredWakePrompt.trim(),
    "Structured wake payload JSON:",
    "```json",
    structuredWakeJson,
    "```",
  ].filter((entry) => entry.trim().length > 0);
  return sections.join("\n");
}

function buildStandardPaperclipPayload(
  ctx: AdapterExecutionContext,
  wakePayload: WakePayload,
  paperclipEnv: Record<string, string>,
  payloadTemplate: Record<string, unknown>,
): Record<string, unknown> {
  const templatePaperclip = parseObject(payloadTemplate.paperclip);
  const workspace = asRecord(ctx.context.paperclipWorkspace);
  const workspaces = Array.isArray(ctx.context.paperclipWorkspaces)
    ? ctx.context.paperclipWorkspaces.filter((entry): entry is Record<string, unknown> => Boolean(asRecord(entry)))
    : [];
  const configuredWorkspaceRuntime = parseObject(ctx.config.workspaceRuntime);
  const runtimeServiceIntents = Array.isArray(ctx.context.paperclipRuntimeServiceIntents)
    ? ctx.context.paperclipRuntimeServiceIntents.filter(
        (entry): entry is Record<string, unknown> => Boolean(asRecord(entry)),
      )
    : [];

  const standardPaperclip: Record<string, unknown> = {
    runId: ctx.runId,
    companyId: ctx.agent.companyId,
    agentId: ctx.agent.id,
    agentName: ctx.agent.name,
    taskId: wakePayload.taskId,
    issueId: wakePayload.issueId,
    issueIds: wakePayload.issueIds,
    wakeReason: wakePayload.wakeReason,
    wakeCommentId: wakePayload.wakeCommentId,
    approvalId: wakePayload.approvalId,
    approvalStatus: wakePayload.approvalStatus,
    apiUrl: paperclipEnv.PAPERCLIP_API_URL ?? null,
  };
  const structuredWake = parseObject(ctx.context.paperclipWake);
  if (Object.keys(structuredWake).length > 0) {
    standardPaperclip.wake = structuredWake;
  }

  if (workspace) {
    standardPaperclip.workspace = workspace;
  }
  if (workspaces.length > 0) {
    standardPaperclip.workspaces = workspaces;
  }
  if (runtimeServiceIntents.length > 0 || Object.keys(configuredWorkspaceRuntime).length > 0) {
    standardPaperclip.workspaceRuntime = {
      ...configuredWorkspaceRuntime,
      ...(runtimeServiceIntents.length > 0 ? { services: runtimeServiceIntents } : {}),
    };
  }

  return {
    ...templatePaperclip,
    ...standardPaperclip,
  };
}

function normalizeUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function rawDataToString(data: unknown): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) {
    return Buffer.concat(
      data.map((entry) => (Buffer.isBuffer(entry) ? entry : Buffer.from(String(entry), "utf8"))),
    ).toString("utf8");
  }
  return String(data ?? "");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" }) as Buffer;
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function signDevicePayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), key);
  return base64UrlEncode(sig);
}

function buildDeviceAuthPayloadV3(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce: string;
  platform?: string | null;
  deviceFamily?: string | null;
}): string {
  const scopes = params.scopes.join(",");
  const token = params.token ?? "";
  const platform = params.platform?.trim() ?? "";
  const deviceFamily = params.deviceFamily?.trim() ?? "";
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
    params.nonce,
    platform,
    deviceFamily,
  ].join("|");
}

function resolveDeviceIdentity(config: Record<string, unknown>): GatewayDeviceIdentity {
  const configuredPrivateKey = nonEmpty(config.devicePrivateKeyPem);
  if (configuredPrivateKey) {
    const privateKey = crypto.createPrivateKey(configuredPrivateKey);
    const publicKey = crypto.createPublicKey(privateKey);
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const raw = derivePublicKeyRaw(publicKeyPem);
    return {
      deviceId: crypto.createHash("sha256").update(raw).digest("hex"),
      publicKeyRawBase64Url: base64UrlEncode(raw),
      privateKeyPem: configuredPrivateKey,
      source: "configured",
    };
  }

  const generated = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = generated.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = generated.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const raw = derivePublicKeyRaw(publicKeyPem);
  return {
    deviceId: crypto.createHash("sha256").update(raw).digest("hex"),
    publicKeyRawBase64Url: base64UrlEncode(raw),
    privateKeyPem,
    source: "ephemeral",
  };
}

function isResponseFrame(value: unknown): value is GatewayResponseFrame {
  const record = asRecord(value);
  return Boolean(record && record.type === "res" && typeof record.id === "string" && typeof record.ok === "boolean");
}

function isEventFrame(value: unknown): value is GatewayEventFrame {
  const record = asRecord(value);
  return Boolean(record && record.type === "event" && typeof record.event === "string");
}

class GatewayWsClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private challengePromise: Promise<string>;
  private resolveChallenge!: (nonce: string) => void;
  private rejectChallenge!: (err: Error) => void;

  constructor(private readonly opts: GatewayClientOptions) {
    this.challengePromise = new Promise<string>((resolve, reject) => {
      this.resolveChallenge = resolve;
      this.rejectChallenge = reject;
    });
    this.challengePromise.catch(() => {});
  }

  async connect(
    buildConnectParams: (nonce: string) => Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Record<string, unknown> | null> {
    this.ws = new WebSocket(this.opts.url, {
      headers: this.opts.headers,
      maxPayload: 25 * 1024 * 1024,
    });

    const ws = this.ws;

    ws.on("message", (data) => {
      this.handleMessage(rawDataToString(data));
    });

    ws.on("close", (code, reason) => {
      const reasonText = rawDataToString(reason);
      const err = new Error(`gateway closed (${code}): ${reasonText}`);
      this.failPending(err);
      this.rejectChallenge(err);
    });

    ws.on("error", (err) => {
      const message = err instanceof Error ? err.message : String(err);
      void this.opts.onLog("stderr", `[openclaw-gateway] websocket error: ${message}\n`);
    });

    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const onOpen = () => {
          cleanup();
          resolve();
        };
        const onError = (err: Error) => {
          cleanup();
          reject(err);
        };
        const onClose = (code: number, reason: Buffer) => {
          cleanup();
          reject(new Error(`gateway closed before open (${code}): ${rawDataToString(reason)}`));
        };
        const cleanup = () => {
          ws.off("open", onOpen);
          ws.off("error", onError);
          ws.off("close", onClose);
        };
        ws.once("open", onOpen);
        ws.once("error", onError);
        ws.once("close", onClose);
      }),
      timeoutMs,
      "gateway websocket open timeout",
    );

    const nonce = await withTimeout(this.challengePromise, timeoutMs, "gateway connect challenge timeout");
    const signedConnectParams = buildConnectParams(nonce);

    const hello = await this.request<Record<string, unknown> | null>("connect", signedConnectParams, {
      timeoutMs,
    });

    return hello;
  }

  async request<T>(
    method: string,
    params: unknown,
    opts: GatewayClientRequestOptions,
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("gateway not connected");
    }

    const id = randomUUID();
    const frame: GatewayRequestFrame = {
      type: "req",
      id,
      method,
      params,
    };

    const payload = JSON.stringify(frame);
    const requestPromise = new Promise<T>((resolve, reject) => {
      const timer =
        opts.timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`gateway request timeout (${method})`));
            }, opts.timeoutMs)
          : null;

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        expectFinal: opts.expectFinal === true,
        timer,
      });
    });

    this.ws.send(payload);
    return requestPromise;
  }

  close() {
    if (!this.ws) return;
    this.ws.close(1000, "paperclip-complete");
    this.ws = null;
  }

  private failPending(err: Error) {
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  private handleMessage(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (isEventFrame(parsed)) {
      if (parsed.event === "connect.challenge") {
        const payload = asRecord(parsed.payload);
        const nonce = nonEmpty(payload?.nonce);
        if (nonce) {
          this.resolveChallenge(nonce);
          return;
        }
      }
      void Promise.resolve(this.opts.onEvent(parsed)).catch(() => {
        // Ignore event callback failures and keep stream active.
      });
      return;
    }

    if (!isResponseFrame(parsed)) return;

    const pending = this.pending.get(parsed.id);
    if (!pending) return;

    const payload = asRecord(parsed.payload);
    const status = nonEmpty(payload?.status)?.toLowerCase();
    if (pending.expectFinal && status === "accepted") {
      return;
    }

    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(parsed.id);

    if (parsed.ok) {
      pending.resolve(parsed.payload ?? null);
      return;
    }

    const errorRecord = asRecord(parsed.error);
    const message =
      nonEmpty(errorRecord?.message) ??
      nonEmpty(errorRecord?.code) ??
      "gateway request failed";
    const err = new Error(message) as GatewayResponseError;
    const code = nonEmpty(errorRecord?.code);
    const details = asRecord(errorRecord?.details);
    if (code) err.gatewayCode = code;
    if (details) err.gatewayDetails = details;
    pending.reject(err);
  }
}

async function autoApproveDevicePairing(params: {
  url: string;
  headers: Record<string, string>;
  connectTimeoutMs: number;
  clientId: string;
  clientMode: string;
  clientVersion: string;
  role: string;
  scopes: string[];
  authToken: string | null;
  password: string | null;
  requestId: string | null;
  deviceId: string | null;
  onLog: AdapterExecutionContext["onLog"];
}): Promise<{ ok: true; requestId: string } | { ok: false; reason: string }> {
  if (!params.authToken && !params.password) {
    return { ok: false, reason: "shared auth token/password is missing" };
  }

  const approvalScopes = uniqueScopes([...params.scopes, "operator.pairing"]);
  const client = new GatewayWsClient({
    url: params.url,
    headers: params.headers,
    onEvent: () => {},
    onLog: params.onLog,
  });

  try {
    await params.onLog(
      "stdout",
      "[openclaw-gateway] pairing required; attempting automatic pairing approval via gateway methods\n",
    );

    await client.connect(
      () => ({
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: params.clientId,
          version: params.clientVersion,
          platform: process.platform,
          mode: params.clientMode,
        },
        role: params.role,
        scopes: approvalScopes,
        auth: {
          ...(params.authToken ? { token: params.authToken } : {}),
          ...(params.password ? { password: params.password } : {}),
        },
      }),
      params.connectTimeoutMs,
    );

    let requestId = params.requestId;
    if (!requestId) {
      const listPayload = await client.request<Record<string, unknown>>("device.pair.list", {}, {
        timeoutMs: params.connectTimeoutMs,
      });
      const pending = Array.isArray(listPayload.pending) ? listPayload.pending : [];
      const pendingRecords = pending
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry));
      const matching =
        (params.deviceId
          ? pendingRecords.find((entry) => nonEmpty(entry.deviceId) === params.deviceId)
          : null) ?? pendingRecords[pendingRecords.length - 1];
      requestId = nonEmpty(matching?.requestId);
    }

    if (!requestId) {
      return { ok: false, reason: "no pending device pairing request found" };
    }

    await client.request(
      "device.pair.approve",
      { requestId },
      {
        timeoutMs: params.connectTimeoutMs,
      },
    );

    return { ok: true, requestId };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    client.close();
  }
}

function parseUsage(value: unknown): AdapterExecutionResult["usage"] | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const inputTokens = asNumber(record.inputTokens ?? record.input, 0);
  const outputTokens = asNumber(record.outputTokens ?? record.output, 0);
  const cachedInputTokens = asNumber(
    record.cachedInputTokens ?? record.cached_input_tokens ?? record.cacheRead ?? record.cache_read,
    0,
  );

  if (inputTokens <= 0 && outputTokens <= 0 && cachedInputTokens <= 0) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
  };
}

function extractRuntimeServicesFromMeta(meta: Record<string, unknown> | null): AdapterRuntimeServiceReport[] {
  if (!meta) return [];
  const reports: AdapterRuntimeServiceReport[] = [];

  const runtimeServices = Array.isArray(meta.runtimeServices)
    ? meta.runtimeServices.filter((entry): entry is Record<string, unknown> => Boolean(asRecord(entry)))
    : [];
  for (const entry of runtimeServices) {
    const serviceName = nonEmpty(entry.serviceName) ?? nonEmpty(entry.name);
    if (!serviceName) continue;
    const rawStatus = nonEmpty(entry.status)?.toLowerCase();
    const status =
      rawStatus === "starting" || rawStatus === "running" || rawStatus === "stopped" || rawStatus === "failed"
        ? rawStatus
        : "running";
    const rawLifecycle = nonEmpty(entry.lifecycle)?.toLowerCase();
    const lifecycle = rawLifecycle === "shared" ? "shared" : "ephemeral";
    const rawScopeType = nonEmpty(entry.scopeType)?.toLowerCase();
    const scopeType =
      rawScopeType === "project_workspace" ||
      rawScopeType === "execution_workspace" ||
      rawScopeType === "agent"
        ? rawScopeType
        : "run";
    const rawHealth = nonEmpty(entry.healthStatus)?.toLowerCase();
    const healthStatus =
      rawHealth === "healthy" || rawHealth === "unhealthy" || rawHealth === "unknown"
        ? rawHealth
        : status === "running"
          ? "healthy"
          : "unknown";

    reports.push({
      id: nonEmpty(entry.id),
      projectId: nonEmpty(entry.projectId),
      projectWorkspaceId: nonEmpty(entry.projectWorkspaceId),
      issueId: nonEmpty(entry.issueId),
      scopeType,
      scopeId: nonEmpty(entry.scopeId),
      serviceName,
      status,
      lifecycle,
      reuseKey: nonEmpty(entry.reuseKey),
      command: nonEmpty(entry.command),
      cwd: nonEmpty(entry.cwd),
      port: parseOptionalPositiveInteger(entry.port),
      url: nonEmpty(entry.url),
      providerRef: nonEmpty(entry.providerRef) ?? nonEmpty(entry.previewId),
      ownerAgentId: nonEmpty(entry.ownerAgentId),
      stopPolicy: asRecord(entry.stopPolicy),
      healthStatus,
    });
  }

  const previewUrl = nonEmpty(meta.previewUrl);
  if (previewUrl) {
    reports.push({
      serviceName: "preview",
      status: "running",
      lifecycle: "ephemeral",
      scopeType: "run",
      url: previewUrl,
      providerRef: nonEmpty(meta.previewId) ?? previewUrl,
      healthStatus: "healthy",
    });
  }

  const previewUrls = Array.isArray(meta.previewUrls)
    ? meta.previewUrls.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  previewUrls.forEach((url, index) => {
    reports.push({
      serviceName: index === 0 ? "preview" : `preview-${index + 1}`,
      status: "running",
      lifecycle: "ephemeral",
      scopeType: "run",
      url,
      providerRef: `${url}#${index}`,
      healthStatus: "healthy",
    });
  });

  return reports;
}

function extractResultText(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;

  const payloads = Array.isArray(record.payloads) ? record.payloads : [];
  const texts = payloads
    .map((entry) => {
      const payload = asRecord(entry);
      return nonEmpty(payload?.text);
    })
    .filter((entry): entry is string => Boolean(entry));

  if (texts.length > 0) return texts.join("\n\n");
  return nonEmpty(record.text) ?? nonEmpty(record.summary) ?? null;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const urlValue = asString(ctx.config.url, "").trim();
  if (!urlValue) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: "OpenClaw gateway adapter missing url",
      errorCode: "openclaw_gateway_url_missing",
    };
  }

  const parsedUrl = normalizeUrl(urlValue);
  if (!parsedUrl) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: `Invalid gateway URL: ${urlValue}`,
      errorCode: "openclaw_gateway_url_invalid",
    };
  }

  if (parsedUrl.protocol !== "ws:" && parsedUrl.protocol !== "wss:") {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: `Unsupported gateway URL protocol: ${parsedUrl.protocol}`,
      errorCode: "openclaw_gateway_url_protocol",
    };
  }

  const timeoutSec = Math.max(0, Math.floor(asNumber(ctx.config.timeoutSec, 120)));
  const timeoutMs = timeoutSec > 0 ? timeoutSec * 1000 : 0;
  // Allow agents whose runs legitimately take >15s (LLM with long prompts,
  // first cold call after gateway boot, contended Olares slot…) to keep
  // the WS open handshake permissive. Cap defaults to 60s (plenty for a
  // healthy WS handshake), but the agent can override via
  // adapter_config.connectTimeoutMs when it expects longer cold starts.
  const connectTimeoutMs =
    parseOptionalPositiveInteger(ctx.config.connectTimeoutMs) ??
    (timeoutMs > 0 ? Math.min(timeoutMs, 60_000) : 10_000);
  const waitTimeoutMs = parseOptionalPositiveInteger(ctx.config.waitTimeoutMs) ?? (timeoutMs > 0 ? timeoutMs : 30_000);

  const payloadTemplate = parseObject(ctx.config.payloadTemplate);
  const transportHint = nonEmpty(ctx.config.streamTransport) ?? nonEmpty(ctx.config.transport);

  const headers = toStringRecord(ctx.config.headers);
  const authToken = resolveAuthToken(parseObject(ctx.config), headers);
  const password = nonEmpty(ctx.config.password);
  const deviceToken = nonEmpty(ctx.config.deviceToken);

  if (authToken && !headerMapHasIgnoreCase(headers, "authorization")) {
    headers.authorization = toAuthorizationHeaderValue(authToken);
  }

  const clientId = nonEmpty(ctx.config.clientId) ?? DEFAULT_CLIENT_ID;
  const clientMode = nonEmpty(ctx.config.clientMode) ?? DEFAULT_CLIENT_MODE;
  const clientVersion = nonEmpty(ctx.config.clientVersion) ?? DEFAULT_CLIENT_VERSION;
  const role = nonEmpty(ctx.config.role) ?? DEFAULT_ROLE;
  const scopes = normalizeScopes(ctx.config.scopes);
  const deviceFamily = nonEmpty(ctx.config.deviceFamily);
  const disableDeviceAuth = parseBoolean(ctx.config.disableDeviceAuth, false);

  const wakePayload = buildWakePayload(ctx);
  const paperclipEnv = buildPaperclipEnvForWake(ctx, wakePayload);
  const structuredWakePrompt = renderPaperclipWakePrompt(ctx.context.paperclipWake);
  const structuredWakeJson = stringifyPaperclipWakePayload(ctx.context.paperclipWake);
  // NORA function-calls native — Phase 2.2 : pre-resolve whether we will
  // inject clientTools so we can drop the verbose curl-procedure preamble
  // from the wake text. When the claim API key is loadable AND the feature
  // is on, we can safely assume the LLM will see plugin tools as native
  // OpenAI function-calls (no need to teach it the HTTP procedure).
  const fcUseNativeFunctionCalls = parseBoolean(ctx.config.useNativeFunctionCalls, true);
  const claimedApiKeyPathResolved = resolveClaimedApiKeyPath(ctx.config.claimedApiKeyPath);
  const fcPreloadedApiKey = fcUseNativeFunctionCalls
    ? await loadClaimedApiKey(claimedApiKeyPathResolved)
    : null;
  const wakeTextNativeFunctionCalls =
    fcUseNativeFunctionCalls && fcPreloadedApiKey !== null;
  const wakeTextSimpleMode =
    !wakeTextNativeFunctionCalls && parseBoolean(ctx.config.simpleWakeText, false);
  const wakeText = buildWakeText(
    wakePayload,
    paperclipEnv,
    structuredWakeJson
      ? joinWakePayloadSections(structuredWakePrompt, structuredWakeJson)
      : structuredWakePrompt,
    claimedApiKeyPathResolved,
    wakeTextSimpleMode,
    wakeTextNativeFunctionCalls,
  );

  const sessionKeyStrategy = normalizeSessionKeyStrategy(ctx.config.sessionKeyStrategy);
  const configuredSessionKey = nonEmpty(ctx.config.sessionKey);
  const sessionKey = resolveSessionKey({
    strategy: sessionKeyStrategy,
    configuredSessionKey,
    agentId: nonEmpty(ctx.config.agentId),
    runId: ctx.runId,
    issueId: wakePayload.issueId,
  });

  const templateMessage = nonEmpty(payloadTemplate.message) ?? nonEmpty(payloadTemplate.text);
  const message = templateMessage ? appendWakeText(templateMessage, wakeText) : wakeText;
  const paperclipPayload = buildStandardPaperclipPayload(ctx, wakePayload, paperclipEnv, payloadTemplate);

  const agentParams: Record<string, unknown> = {
    ...payloadTemplate,
    message,
    sessionKey,
    idempotencyKey: ctx.runId,
  };
  delete agentParams.text;
  // NOTE — Tried `agentParams.disableTools = true` to short-circuit OpenClaw's
  // createOpenClawCodingTools() (a 13-15s prep step per run, profiled via
  // NORA-PROBE in node_modules/openclaw/dist/selection-D9uTvvsw.js:6181).
  // Rejected: OpenClaw's WS schema is strict (`additionalProperties: false`)
  // and returns "invalid agent params: at root: unexpected property
  // 'disableTools'". The field exists internally (params.disableTools is
  // honored by runEmbeddedAttempt) but is not exposed in the public agent.run
  // protocol. → upstream PR needed to whitelist `disableTools` (and ideally
  // short-circuit when agents.list[].tools.allow is empty).
  // Tracking: NORA/18-reset-2026-04-29/25-perf-cold-start-15s-investigation.md
  // Move paperclip context to extraSystemPrompt to avoid OpenClaw schema rejection
  // (OpenClaw uses additionalProperties: false and rejects unknown root-level fields)
  const paperclipContextXml = `<paperclip-context>\n${JSON.stringify(paperclipPayload, null, 2)}\n</paperclip-context>`;
  agentParams.extraSystemPrompt = paperclipContextXml;

  // NORA Phase 7 — Prompt size optimization. OpenClaw's protocol schema
  // (packages/.../protocol-Hjar_s3V.js:209) accepts an optional
  // `promptMode: "full" | "minimal" | "none"` agent param that drastically
  // changes the system prompt size:
  //   - "full"    (default): ~24K chars (skills bundled + tooling list +
  //                          gateway CLI ref + execution bias + safety + …)
  //   - "minimal" (auto when `tools.allow` is non-empty): ~5-8K chars
  //   - "none"  : 1 line ("You are a personal assistant running inside OpenClaw.")
  //
  // We expose this via adapterConfig so each agent can opt in. main-v15
  // (text-only orchestrator with `tools.allow:[]`) sets promptMode="none"
  // to drop the 24K → 1 line, which removes the irrelevant tooling/skills
  // catalog and keeps the prompt prefix STABLE between runs (so Olares
  // KV-cache hits — gain ~99% on warm calls).
  //
  // Reference: NORA/18-reset-2026-04-29/29-plan-recuperation-tools-agents-skills-memory.md
  const promptModeRaw = nonEmpty(ctx.config.promptMode);
  if (
    promptModeRaw === "none" ||
    promptModeRaw === "minimal" ||
    promptModeRaw === "full"
  ) {
    agentParams.promptMode = promptModeRaw;
  }

  const configuredAgentId = nonEmpty(ctx.config.agentId);
  if (configuredAgentId && !nonEmpty(agentParams.agentId)) {
    agentParams.agentId = configuredAgentId;
  }

  if (typeof agentParams.timeout !== "number") {
    agentParams.timeout = waitTimeoutMs;
  }

  if (ctx.onMeta) {
    await ctx.onMeta({
      adapterType: "openclaw_gateway",
      command: "gateway",
      commandArgs: ["ws", parsedUrl.toString(), "agent"],
      context: ctx.context,
    });
  }

  const outboundHeaderKeys = Object.keys(headers).sort();
  await ctx.onLog(
    "stdout",
    `[openclaw-gateway] outbound headers (redacted): ${stringifyForLog(redactForLog(headers), 4_000)}\n`,
  );
  await ctx.onLog(
    "stdout",
    `[openclaw-gateway] outbound payload (redacted): ${stringifyForLog(redactForLog(agentParams), 12_000)}\n`,
  );
  await ctx.onLog("stdout", `[openclaw-gateway] outbound header keys: ${outboundHeaderKeys.join(", ")}\n`);
  if (transportHint) {
    await ctx.onLog(
      "stdout",
      `[openclaw-gateway] ignoring streamTransport=${transportHint}; gateway adapter always uses websocket protocol\n`,
    );
  }
  if (parsedUrl.protocol === "ws:" && !isLoopbackHost(parsedUrl.hostname)) {
    await ctx.onLog(
      "stdout",
      "[openclaw-gateway] warning: using plaintext ws:// to a non-loopback host; prefer wss:// for remote endpoints\n",
    );
  }

  const autoPairOnFirstConnect = parseBoolean(ctx.config.autoPairOnFirstConnect, true);
  let autoPairAttempted = false;
  let latestResultPayload: unknown = null;

  while (true) {
    const trackedRunIds = new Set<string>([ctx.runId]);
    const assistantChunks: string[] = [];
    let lifecycleError: string | null = null;
    let deviceIdentity: GatewayDeviceIdentity | null = null;

    const onEvent = async (frame: GatewayEventFrame) => {
      if (frame.event !== "agent") {
        if (frame.event === "shutdown") {
          await ctx.onLog(
            "stdout",
            `[openclaw-gateway] gateway shutdown notice: ${stringifyForLog(frame.payload ?? {}, 2_000)}\n`,
          );
        }
        return;
      }

      const payload = asRecord(frame.payload);
      if (!payload) return;

      const runId = nonEmpty(payload.runId);
      if (!runId || !trackedRunIds.has(runId)) return;

      const stream = nonEmpty(payload.stream) ?? "unknown";
      const data = asRecord(payload.data) ?? {};
      await ctx.onLog(
        "stdout",
        `[openclaw-gateway:event] run=${runId} stream=${stream} data=${stringifyForLog(data, 8_000)}\n`,
      );

      if (stream === "assistant") {
        const delta = nonEmpty(data.delta);
        const text = nonEmpty(data.text);
        if (delta) {
          assistantChunks.push(delta);
        } else if (text) {
          assistantChunks.push(text);
        }
        return;
      }

      if (stream === "error") {
        lifecycleError = nonEmpty(data.error) ?? nonEmpty(data.message) ?? lifecycleError;
        return;
      }

      if (stream === "lifecycle") {
        const phase = nonEmpty(data.phase)?.toLowerCase();
        if (phase === "error" || phase === "failed" || phase === "cancelled") {
          lifecycleError = nonEmpty(data.error) ?? nonEmpty(data.message) ?? lifecycleError;
        }
      }
    };

    const client = new GatewayWsClient({
      url: parsedUrl.toString(),
      headers,
      onEvent,
      onLog: ctx.onLog,
    });

    try {
      deviceIdentity = disableDeviceAuth ? null : resolveDeviceIdentity(parseObject(ctx.config));
      if (deviceIdentity) {
        await ctx.onLog(
          "stdout",
          `[openclaw-gateway] device auth enabled keySource=${deviceIdentity.source} deviceId=${deviceIdentity.deviceId}\n`,
        );
      } else {
        await ctx.onLog("stdout", "[openclaw-gateway] device auth disabled\n");
      }

      await ctx.onLog("stdout", `[openclaw-gateway] connecting to ${parsedUrl.toString()}\n`);

      const hello = await client.connect((nonce) => {
        const signedAtMs = Date.now();
        const connectParams: Record<string, unknown> = {
          minProtocol: PROTOCOL_VERSION,
          maxProtocol: PROTOCOL_VERSION,
          client: {
            id: clientId,
            version: clientVersion,
            platform: process.platform,
            ...(deviceFamily ? { deviceFamily } : {}),
            mode: clientMode,
          },
          role,
          scopes,
          auth:
            authToken || password || deviceToken
              ? {
                  ...(authToken ? { token: authToken } : {}),
                  ...(deviceToken ? { deviceToken } : {}),
                  ...(password ? { password } : {}),
                }
              : undefined,
        };

        if (deviceIdentity) {
          const payload = buildDeviceAuthPayloadV3({
            deviceId: deviceIdentity.deviceId,
            clientId,
            clientMode,
            role,
            scopes,
            signedAtMs,
            token: authToken,
            nonce,
            platform: process.platform,
            deviceFamily,
          });
          connectParams.device = {
            id: deviceIdentity.deviceId,
            publicKey: deviceIdentity.publicKeyRawBase64Url,
            signature: signDevicePayload(deviceIdentity.privateKeyPem, payload),
            signedAt: signedAtMs,
            nonce,
          };
        }
        return connectParams;
      }, connectTimeoutMs);

      await ctx.onLog(
        "stdout",
        `[openclaw-gateway] connected protocol=${asNumber(asRecord(hello)?.protocol, PROTOCOL_VERSION)}\n`,
      );

      // NORA function-calls native — Phase 2.2 : inject plugin tools as
      // OpenAI-style clientTools so the LLM can use native function-calling
      // instead of emitting `<tool_call>` text or shelling out to curl.
      // Falls back gracefully if the claim file is missing or the API is
      // unreachable (preserves the legacy behaviour).
      // The API key was already resolved up top (so the wake text could
      // drop the curl-procedure preamble), reuse it here.
      const fcEnabled = fcUseNativeFunctionCalls;
      const fcApiKey = fcPreloadedApiKey;
      let fcApiUrl: string | null = null;
      if (fcEnabled) {
        if (fcApiKey) {
          fcApiUrl = resolvePaperclipApiUrlForFetch(ctx);
          const toolFilter = resolveAgentToolFilter(ctx);
          try {
            const tools = await fetchAvailableTools(fcApiUrl, fcApiKey, toolFilter);
            if (tools.length > 0) {
              agentParams.clientTools = toClientTools(tools);
              // NORA Phase 4 — pass a synchronous executor descriptor so
              // OpenClaw fork (>= bb7022c2 / patch 7) executes plugin tools
              // INLINE during the LLM turn instead of returning a sentinel
              // that Qwen-class models ignore. With this in place there is
              // no need for the roundtrip loop below — tool results land
              // back in the same turn and the LLM produces a grounded
              // final answer in one shot.
              agentParams.clientToolExecutor = {
                url: new URL("/api/plugins/tools/execute", fcApiUrl).toString(),
                apiKey: fcApiKey,
                runId: ctx.runId,
                timeoutMs: 30_000,
              };
              await ctx.onLog(
                "stdout",
                `[openclaw-gateway] injected ${tools.length} plugin tool(s) as clientTools + sync executor (function-calling native)\n`,
              );
            } else {
              await ctx.onLog(
                "stdout",
                "[openclaw-gateway] no plugin tools available, skipping clientTools injection\n",
              );
            }
          } catch (err) {
            await ctx.onLog(
              "stdout",
              `[openclaw-gateway] failed to inject clientTools (continuing without): ${err instanceof Error ? err.message : String(err)}\n`,
            );
          }
        } else {
          await ctx.onLog(
            "stdout",
            "[openclaw-gateway] claim API key not found, skipping clientTools injection\n",
          );
        }
      }

      // When clientTools are injected we need the FINAL gateway frame
      // (status="ok" with `result.meta.stopReason` populated), not the
      // intermediate `accepted` ack — otherwise the roundtrip loop never
      // sees `pendingToolCalls`. expectFinal: true makes the WS client
      // skip the `accepted` ack frame and wait for the second frame
      // (same RPC id) that the gateway sends once
      // `agentCommandFromIngress` resolves
      // (server-methods/agent.ts:328-345).
      const expectFinalForRun = fcEnabled && fcApiKey !== null;
      let acceptedPayload = await client.request<Record<string, unknown>>("agent", agentParams, {
        timeoutMs: expectFinalForRun ? waitTimeoutMs : connectTimeoutMs,
        expectFinal: expectFinalForRun,
      });

      latestResultPayload = acceptedPayload;

      const acceptedStatus = nonEmpty(acceptedPayload?.status)?.toLowerCase() ?? "";
      const acceptedRunId = nonEmpty(acceptedPayload?.runId) ?? ctx.runId;
      trackedRunIds.add(acceptedRunId);

      await ctx.onLog(
        "stdout",
        `[openclaw-gateway] agent accepted runId=${acceptedRunId} status=${acceptedStatus || "unknown"}\n`,
      );

      if (acceptedStatus === "error") {
        const errorMessage =
          nonEmpty(acceptedPayload?.summary) ?? lifecycleError ?? "OpenClaw gateway agent request failed";
        return {
          exitCode: 1,
          signal: null,
          timedOut: false,
          errorMessage,
          errorCode: "openclaw_gateway_agent_error",
          resultJson: acceptedPayload,
        };
      }

      if (acceptedStatus !== "ok") {
        const waitPayload = await client.request<Record<string, unknown>>(
          "agent.wait",
          { runId: acceptedRunId, timeoutMs: waitTimeoutMs },
          { timeoutMs: waitTimeoutMs + connectTimeoutMs },
        );

        latestResultPayload = waitPayload;

        const waitStatus = nonEmpty(waitPayload?.status)?.toLowerCase() ?? "";
        if (waitStatus === "timeout") {
          return {
            exitCode: 1,
            signal: null,
            timedOut: true,
            errorMessage: `OpenClaw gateway run timed out after ${waitTimeoutMs}ms`,
            errorCode: "openclaw_gateway_wait_timeout",
            resultJson: waitPayload,
          };
        }

        if (waitStatus === "error") {
          return {
            exitCode: 1,
            signal: null,
            timedOut: false,
            errorMessage:
              nonEmpty(waitPayload?.error) ??
              lifecycleError ??
              "OpenClaw gateway run failed",
            errorCode: "openclaw_gateway_wait_error",
            resultJson: waitPayload,
          };
        }

        if (waitStatus && waitStatus !== "ok") {
          return {
            exitCode: 1,
            signal: null,
            timedOut: false,
            errorMessage: `Unexpected OpenClaw gateway agent.wait status: ${waitStatus}`,
            errorCode: "openclaw_gateway_wait_status_unexpected",
            resultJson: waitPayload,
          };
        }

        acceptedPayload = waitPayload;
      }

      // NORA function-calls native — Phase 2.2 : roundtrip loop. When the LLM
      // emits tool_calls (stopReason="tool_calls"), execute each pending tool
      // via /api/plugins/tools/execute and re-issue agent.run with the result
      // embedded in the next message. Bounded to MAX_FUNCTION_CALL_ROUNDTRIPS
      // to guard against runaway loops; gracefully exits if any tool fails.
      // NORA Phase 5 — when the sync executor is wired (patch 7), tool calls
      // are executed inline by the runner during the LLM turn. The runtime
      // may still terminate with stopReason="tool_calls" (Qwen / Olares emit
      // that natively whenever a function-call is in the assistant message),
      // but we MUST NOT re-execute via the legacy roundtrip path — that
      // would duplicate every tool call and double the latency. Skip the
      // loop entirely when the sync executor is in use.
      if (fcEnabled && fcApiKey && fcApiUrl && !agentParams.clientToolExecutor) {
        // Diagnostic: dump meta so we can see why pendingToolCalls might be
        // empty (stopReason mismatch, struct shape change, etc.). Look in
        // both `payload.meta` (legacy) and `payload.result.meta` (current
        // OpenClaw WS shape — see server-methods/agent.ts).
        const _diagRoot = asRecord(acceptedPayload);
        const _diagMeta =
          asRecord(asRecord(_diagRoot?.result)?.meta) ?? asRecord(_diagRoot?.meta);
        await ctx.onLog(
          "stdout",
          `[openclaw-gateway] post-run meta dump: stopReason=${nonEmpty(_diagMeta?.stopReason) ?? "(none)"} pendingToolCalls=${JSON.stringify(_diagMeta?.pendingToolCalls ?? null).slice(0, 500)}\n`,
        );
        let roundtrips = 0;
        let pendingToolCalls = extractPendingToolCalls(acceptedPayload);
        while (pendingToolCalls.length > 0 && roundtrips < MAX_FUNCTION_CALL_ROUNDTRIPS) {
          await ctx.onLog(
            "stdout",
            `[openclaw-gateway] tool_calls roundtrip ${roundtrips + 1}/${MAX_FUNCTION_CALL_ROUNDTRIPS} — executing ${pendingToolCalls.length} tool(s)\n`,
          );

          const toolResults: Array<{ id: string; name: string; content: string }> = [];
          for (const call of pendingToolCalls) {
            try {
              const args = JSON.parse(call.arguments) as unknown;
              const exec = await executePluginTool(fcApiUrl, fcApiKey, ctx.runId, call.name, args);
              const content = JSON.stringify(exec.result ?? {});
              toolResults.push({ id: call.id, name: call.name, content });
              await ctx.onLog(
                "stdout",
                `[openclaw-gateway] tool ${call.name} -> ${content.slice(0, 200)}\n`,
              );
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              toolResults.push({ id: call.id, name: call.name, content: JSON.stringify({ error: message }) });
              await ctx.onLog(
                "stderr",
                `[openclaw-gateway] tool ${call.name} failed: ${message}\n`,
              );
            }
          }

          // Build the follow-up message containing tool results. Option A
          // (simple text encoding) — see NORA/19-function-calls-natifs/04-...
          // The agent already has the original user question + assistant
          // tool_calls in its session history (sessionKey is preserved), so
          // this user message is interpreted as "here are the results, now
          // formulate the answer".
          const toolResultsText = toolResults
            .map((t) => `[tool:${t.name}#${t.id}] ${t.content}`)
            .join("\n");
          agentParams.message = `Tool results:\n${toolResultsText}\n\nFormulate the final response to the user using these results.`;
          agentParams.idempotencyKey = randomUUID();

          // Same expectFinal contract as the initial call — wait for the
          // resolved frame so we can read `result.meta` and detect any
          // follow-up tool_calls in this turn.
          const nextPayload = await client.request<Record<string, unknown>>("agent", agentParams, {
            timeoutMs: waitTimeoutMs,
            expectFinal: true,
          });
          latestResultPayload = nextPayload;
          acceptedPayload = nextPayload;

          const nextStatus = nonEmpty(nextPayload?.status)?.toLowerCase() ?? "";
          const nextRunId = nonEmpty(nextPayload?.runId) ?? acceptedRunId;
          trackedRunIds.add(nextRunId);

          if (nextStatus === "error") {
            return {
              exitCode: 1,
              signal: null,
              timedOut: false,
              errorMessage:
                nonEmpty(nextPayload?.summary) ??
                lifecycleError ??
                "OpenClaw gateway agent request failed during tool roundtrip",
              errorCode: "openclaw_gateway_tool_roundtrip_error",
              resultJson: nextPayload,
            };
          }

          if (nextStatus !== "ok") {
            const waitPayload = await client.request<Record<string, unknown>>(
              "agent.wait",
              { runId: nextRunId, timeoutMs: waitTimeoutMs },
              { timeoutMs: waitTimeoutMs + connectTimeoutMs },
            );
            latestResultPayload = waitPayload;
            acceptedPayload = waitPayload;
            const waitStatus = nonEmpty(waitPayload?.status)?.toLowerCase() ?? "";
            if (waitStatus === "timeout") {
              return {
                exitCode: 1,
                signal: null,
                timedOut: true,
                errorMessage: `OpenClaw gateway run timed out after ${waitTimeoutMs}ms during tool roundtrip`,
                errorCode: "openclaw_gateway_wait_timeout",
                resultJson: waitPayload,
              };
            }
            if (waitStatus === "error" || (waitStatus && waitStatus !== "ok")) {
              return {
                exitCode: 1,
                signal: null,
                timedOut: false,
                errorMessage:
                  nonEmpty(waitPayload?.error) ??
                  lifecycleError ??
                  `OpenClaw gateway run failed during tool roundtrip (status=${waitStatus})`,
                errorCode: "openclaw_gateway_wait_error",
                resultJson: waitPayload,
              };
            }
          }

          roundtrips++;
          pendingToolCalls = extractPendingToolCalls(acceptedPayload);
        }

        if (pendingToolCalls.length > 0) {
          await ctx.onLog(
            "stderr",
            `[openclaw-gateway] tool_calls roundtrip exhausted (${MAX_FUNCTION_CALL_ROUNDTRIPS}), giving up with ${pendingToolCalls.length} tool(s) still pending\n`,
          );
        }
      }

      const summaryFromEvents = assistantChunks.join("").trim();
      const summaryFromPayload =
        extractResultText(asRecord(acceptedPayload?.result)) ??
        extractResultText(acceptedPayload) ??
        extractResultText(asRecord(latestResultPayload)) ??
        null;
      const summary = summaryFromEvents || summaryFromPayload || null;

      const acceptedResult = asRecord(acceptedPayload?.result);
      const latestPayload = asRecord(latestResultPayload);
      const latestResult = asRecord(latestPayload?.result);
      const acceptedMeta = asRecord(acceptedResult?.meta) ?? asRecord(acceptedPayload?.meta);
      const latestMeta = asRecord(latestResult?.meta) ?? asRecord(latestPayload?.meta);
      const mergedMeta = {
        ...(acceptedMeta ?? {}),
        ...(latestMeta ?? {}),
      };
      const agentMeta =
        asRecord(mergedMeta.agentMeta) ??
        asRecord(acceptedMeta?.agentMeta) ??
        asRecord(latestMeta?.agentMeta);
      const usage = parseUsage(agentMeta?.usage ?? mergedMeta.usage);
      const runtimeServices = extractRuntimeServicesFromMeta(agentMeta ?? mergedMeta);
      const provider = nonEmpty(agentMeta?.provider) ?? nonEmpty(mergedMeta.provider) ?? "openclaw";
      const model = nonEmpty(agentMeta?.model) ?? nonEmpty(mergedMeta.model) ?? null;
      const costUsd = asNumber(agentMeta?.costUsd ?? mergedMeta.costUsd, 0);

      await ctx.onLog(
        "stdout",
        `[openclaw-gateway] run completed runId=${Array.from(trackedRunIds).join(",")} status=ok\n`,
      );

      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        provider,
        ...(model ? { model } : {}),
        ...(usage ? { usage } : {}),
        ...(costUsd > 0 ? { costUsd } : {}),
        resultJson: asRecord(latestResultPayload),
        ...(runtimeServices.length > 0 ? { runtimeServices } : {}),
        ...(summary ? { summary } : {}),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const lower = message.toLowerCase();
      const timedOut = lower.includes("timeout");
      const pairingRequired = lower.includes("pairing required");

      if (
        pairingRequired &&
        !disableDeviceAuth &&
        autoPairOnFirstConnect &&
        !autoPairAttempted &&
        (authToken || password)
      ) {
        autoPairAttempted = true;
        const pairResult = await autoApproveDevicePairing({
          url: parsedUrl.toString(),
          headers,
          connectTimeoutMs,
          clientId,
          clientMode,
          clientVersion,
          role,
          scopes,
          authToken,
          password,
          requestId: extractPairingRequestId(err),
          deviceId: deviceIdentity?.deviceId ?? null,
          onLog: ctx.onLog,
        });
        if (pairResult.ok) {
          await ctx.onLog(
            "stdout",
            `[openclaw-gateway] auto-approved pairing request ${pairResult.requestId}; retrying\n`,
          );
          continue;
        }
        await ctx.onLog(
          "stderr",
          `[openclaw-gateway] auto-pairing failed: ${pairResult.reason}\n`,
        );
      }

      const detailedMessage = pairingRequired
        ? `${message}. Approve the pending device in OpenClaw (for example: openclaw devices approve --latest --url <gateway-ws-url> --token <gateway-token>) and retry. Ensure this agent has a persisted adapterConfig.devicePrivateKeyPem so approvals are reused.`
        : message;

      await ctx.onLog("stderr", `[openclaw-gateway] request failed: ${detailedMessage}\n`);

      return {
        exitCode: 1,
        signal: null,
        timedOut,
        errorMessage: detailedMessage,
        errorCode: timedOut
          ? "openclaw_gateway_timeout"
          : pairingRequired
            ? "openclaw_gateway_pairing_required"
            : "openclaw_gateway_request_failed",
        resultJson: asRecord(latestResultPayload),
      };
    } finally {
      client.close();
    }
  }
}
