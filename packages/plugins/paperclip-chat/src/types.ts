/** A chat thread stored in plugin state */
export interface ChatThread {
  id: string;
  companyId: string;
  title: string;
  /** Agent session ID for resume */
  sessionId: string | null;
  /** Adapter type locked at creation */
  adapterType: string;
  /** Model used for this thread */
  model: string;
  /** Resolved agent identity for this thread (shown in the UI). */
  agentId?: string | null;
  agentName?: string | null;
  status: "idle" | "running" | "error";
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Optional caller-supplied external identifier used for upsert semantics.
   *
   * When `createThread` is called with a non-empty `externalId`, the action
   * looks for an existing thread on the same `(companyId, createdBy,
   * agentId, externalId)` tuple and returns it instead of creating a new
   * one. Lets backend channels (e.g. NORA WhatsApp/Webmail relay) keep a
   * single long-lived Paperclip thread per (real user, channel) tuple
   * without having to track threadIds on the caller side.
   *
   * The id is treated as opaque — Paperclip never parses it. Threads
   * created by the standard UI path (without externalId) keep this field
   * unset and behave like before.
   */
  externalId?: string | null;
}

/** A single chat message */
export interface ChatMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: ChatMessageMetadata | null;
  createdAt: string;
}

/** Structured metadata stored with assistant messages */
export interface ChatMessageMetadata {
  segments: ChatSegment[];
}

export type ChatSegment =
  | { kind: "text"; content: string }
  | { kind: "thinking"; content: string }
  | {
      kind: "tool";
      name: string;
      input: unknown;
      result?: string;
      isError?: boolean;
      /** Millisecond timestamp when the `tool_use` block was emitted. */
      startedAt?: number;
      /** Millisecond timestamp when the matching `tool_result` arrived. */
      finishedAt?: number;
    };

/** Available adapter info returned to the UI */
export interface ChatAdapterInfo {
  type: string;
  label: string;
  available: boolean;
  models: { id: string; label: string }[];
}

/** Stream event pushed from worker to UI via SSE bridge */
export interface ChatStreamEvent {
  type:
    | "text"
    | "thinking"
    | "tool_use"
    | "tool_result"
    | "session_init"
    | "result"
    | "error"
    | "title_updated"
    | "done";
  text?: string;
  name?: string;
  input?: unknown;
  content?: string;
  isError?: boolean;
  sessionId?: string;
  toolUseId?: string;
  usage?: { input_tokens: number; output_tokens: number };
  costUsd?: number;
  title?: string;
}
