import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { AgentSessionEvent, PluginContext } from "@paperclipai/plugin-sdk";
import type {
  ChatThread,
  ChatMessage,
  ChatStreamEvent,
  ChatAdapterInfo,
} from "./types.js";

const PLUGIN_NAME = "paperclip-chat";

// ---------------------------------------------------------------------------
// Claude stream-json parser
// ---------------------------------------------------------------------------

/**
 * Buffers raw stdout chunks and emits parsed ChatStreamEvents for each
 * complete JSON line from Claude CLI's `--output-format stream-json`.
 */
function createStreamJsonParser(emit: (event: ChatStreamEvent) => void) {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      // Keep the last (possibly incomplete) line in the buffer
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // ── OpenClaw Gateway event format ────────────────────────
        // Lines look like: [openclaw-gateway:event] run=<id> stream=<name> data=<json>
        const ocgMatch = trimmed.match(/^\[openclaw-gateway:event\]\s+.*?stream=(\S+)\s+data=(\{.*\})\s*$/);
        if (ocgMatch) {
          const stream = ocgMatch[1];
          try {
            const data = JSON.parse(ocgMatch[2]) as Record<string, unknown>;
            if (stream === "assistant") {
              const text = (data.delta as string | undefined) ?? (data.text as string | undefined);
              if (typeof text === "string" && text.length > 0) {
                emit({ type: "text", text });
              }
            } else if (stream === "tool_use") {
              const name = (data.name as string) ?? "tool";
              emit({ type: "tool_use", name, input: data.input });
            } else if (stream === "tool_result") {
              const content = typeof data.content === "string" ? data.content : JSON.stringify(data.content ?? "");
              emit({ type: "tool_result", content, isError: data.isError === true || data.is_error === true });
            } else if (stream === "item") {
              // OpenClaw Gateway emits `stream=item` for its native tool
              // calls (sessions_spawn, read, write, exec, edit, …). Map
              // them to the same tool_use / tool_result events so the
              // retry-narration filter and the UI tool-call rendering
              // both react correctly.
              const kind = data.kind as string | undefined;
              const phase = data.phase as string | undefined;
              if (kind === "tool" || kind === "command") {
                const name = (data.name as string) ?? (kind === "command" ? "exec" : "tool");
                if (phase === "start") {
                  emit({ type: "tool_use", name, input: data.meta ?? data.title });
                } else if (phase === "end") {
                  const out = (data.output as string | undefined) ?? (data.result as string | undefined) ?? "";
                  const failed =
                    data.status === "error" ||
                    data.status === "failed" ||
                    (typeof data.exitCode === "number" && data.exitCode !== 0);
                  emit({ type: "tool_result", content: out, isError: failed });
                }
                // `update` / `delta` phases stream progress; we ignore them
                // here because the tool call is already open in the segment
                // list and the UI does not need every keystroke.
              }
            } else if (stream === "error") {
              const msg = (data.error as string | undefined) ?? (data.message as string | undefined) ?? "error";
              emit({ type: "error", text: msg });
            }
          } catch { /* skip malformed JSON */ }
          continue;
        }

        try {
          const obj = JSON.parse(trimmed) as Record<string, unknown>;
          const type = obj.type as string | undefined;

          // ── Claude CLI stream-json format ──────────────────────────
          // The CLI emits: system (init), assistant (full message),
          // user (tool_result), and result (final summary).
          if (type === "assistant") {
            const message = obj.message as Record<string, unknown> | undefined;
            const content = Array.isArray(message?.content) ? message!.content : [];
            for (const blockRaw of content) {
              if (typeof blockRaw !== "object" || blockRaw === null || Array.isArray(blockRaw)) continue;
              const block = blockRaw as Record<string, unknown>;
              const blockType = block.type as string | undefined;
              if (blockType === "text" && typeof block.text === "string") {
                emit({ type: "text", text: block.text });
              } else if (blockType === "thinking" && typeof block.thinking === "string") {
                emit({ type: "thinking", text: block.thinking });
              } else if (blockType === "tool_use") {
                emit({
                  type: "tool_use",
                  name: (block.name as string) ?? "tool",
                  input: block.input,
                });
              }
            }
          } else if (type === "user") {
            // Tool results come back as user messages with tool_result blocks
            const message = obj.message as Record<string, unknown> | undefined;
            const content = Array.isArray(message?.content) ? message!.content : [];
            for (const blockRaw of content) {
              if (typeof blockRaw !== "object" || blockRaw === null || Array.isArray(blockRaw)) continue;
              const block = blockRaw as Record<string, unknown>;
              if ((block.type as string) === "tool_result") {
                let resultContent = "";
                if (typeof block.content === "string") {
                  resultContent = block.content;
                } else if (Array.isArray(block.content)) {
                  resultContent = block.content
                    .map((p: unknown) => {
                      if (typeof p === "string") return p;
                      if (typeof p === "object" && p !== null && (p as Record<string, unknown>).type === "text") {
                        return (p as Record<string, unknown>).text as string;
                      }
                      return "";
                    })
                    .filter(Boolean)
                    .join("\n");
                }
                emit({
                  type: "tool_result",
                  content: resultContent,
                  isError: block.is_error === true,
                });
              }
            }
          } else if (type === "system" && obj.subtype === "init") {
            if (typeof obj.session_id === "string") {
              emit({ type: "session_init", sessionId: obj.session_id });
            }
          } else if (type === "result") {
            const usage = obj.usage as Record<string, unknown> | undefined;
            emit({
              type: "result",
              usage: usage ? {
                input_tokens: (usage.input_tokens as number) ?? 0,
                output_tokens: (usage.output_tokens as number) ?? 0,
              } : undefined,
              costUsd: typeof obj.total_cost_usd === "number" ? obj.total_cost_usd
                : typeof obj.cost_usd === "number" ? obj.cost_usd
                : undefined,
            });
          }

          // ── Anthropic API streaming format (fallback) ──────────────
          // In case the adapter emits raw API events instead of CLI format.
          if (type === "content_block_delta") {
            const delta = obj.delta as Record<string, unknown> | undefined;
            if (delta?.type === "text_delta" && typeof delta.text === "string") {
              emit({ type: "text", text: delta.text });
            }
            if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
              emit({ type: "thinking", text: delta.thinking });
            }
          }
        } catch {
          // Not valid JSON — skip
        }
      }
    },
    /** Flush any remaining buffer content */
    flush() {
      if (buffer.trim()) {
        this.push("\n");
      }
    },
  };
}

// ---------------------------------------------------------------------------
// State key helpers — all chat data lives in plugin.state
// ---------------------------------------------------------------------------

function threadListKey(companyId: string) {
  return `threads:${companyId}`;
}

function threadKey(threadId: string) {
  return `thread:${threadId}`;
}

function messagesKey(threadId: string) {
  return `messages:${threadId}`;
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

async function getThread(ctx: PluginContext, threadId: string): Promise<ChatThread | null> {
  const raw = await ctx.state.get({
    scopeKind: "instance",
    scopeId: "global",
    stateKey: threadKey(threadId),
  });
  return (raw as ChatThread) ?? null;
}

async function saveThread(ctx: PluginContext, thread: ChatThread): Promise<void> {
  await ctx.state.set({
    scopeKind: "instance",
    scopeId: "global",
    stateKey: threadKey(thread.id),
  }, thread as unknown);
}

async function getThreadList(ctx: PluginContext, companyId: string): Promise<string[]> {
  const raw = await ctx.state.get({
    scopeKind: "company",
    scopeId: companyId,
    stateKey: threadListKey(companyId),
  });
  return (raw as string[]) ?? [];
}

async function saveThreadList(ctx: PluginContext, companyId: string, ids: string[]): Promise<void> {
  await ctx.state.set({
    scopeKind: "company",
    scopeId: companyId,
    stateKey: threadListKey(companyId),
  }, ids as unknown);
}

async function getMessages(ctx: PluginContext, threadId: string): Promise<ChatMessage[]> {
  const raw = await ctx.state.get({
    scopeKind: "instance",
    scopeId: "global",
    stateKey: messagesKey(threadId),
  });
  return (raw as ChatMessage[]) ?? [];
}

async function saveMessages(ctx: PluginContext, threadId: string, msgs: ChatMessage[]): Promise<void> {
  await ctx.state.set({
    scopeKind: "instance",
    scopeId: "global",
    stateKey: messagesKey(threadId),
  }, msgs as unknown);
}

function generateId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Adapter type → human-readable label
// ---------------------------------------------------------------------------

const ADAPTER_LABELS: Record<string, string> = {
  openclaw_gateway: "OpenClaw",
  claude_local: "Claude",
  openai: "OpenAI",
  codex: "Codex",
  opencode: "OpenCode",
};

function adapterTypeLabel(adapterType: string): string {
  return ADAPTER_LABELS[adapterType] ?? adapterType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info(`${PLUGIN_NAME} plugin setup`);

    // ── Data: list threads ──────────────────────────────────────────
    ctx.data.register("threads", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      if (!companyId) return [];
      const ids = await getThreadList(ctx, companyId);
      const threads: ChatThread[] = [];
      for (const id of ids) {
        const thread = await getThread(ctx, id);
        if (thread) threads.push(thread);
      }
      // Sort by updatedAt descending
      threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return threads;
    });

    // ── Data: get messages for a thread ─────────────────────────────
    ctx.data.register("messages", async (params: Record<string, unknown>) => {
      const threadId = params.threadId as string;
      if (!threadId) return [];
      return getMessages(ctx, threadId);
    });

    // ── Data: list available adapters ───────────────────────────────
    ctx.data.register("adapters", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      if (!companyId) {
        return [
          { type: "openclaw_gateway", label: "OpenClaw", available: true, models: [] },
        ] as ChatAdapterInfo[];
      }
      try {
        const agents = await ctx.agents.list({ companyId });

        // Deduplicate by adapterType — show distinct adapter types, not individual agents
        // Mark available if ANY agent of that type is not terminated
        const adapterMap = new Map<string, ChatAdapterInfo>();
        for (const a of agents) {
          const existing = adapterMap.get(a.adapterType);
          if (existing) {
            // If any agent of this type is available, mark the adapter available
            if (a.status !== "terminated") existing.available = true;
            continue;
          }
          adapterMap.set(a.adapterType, {
            type: a.adapterType,
            label: adapterTypeLabel(a.adapterType),
            available: a.status !== "terminated",
            models: [],
          });
        }
        const adapters = Array.from(adapterMap.values());
        return adapters.length > 0 ? adapters : [
          { type: "openclaw_gateway", label: "OpenClaw", available: true, models: [] },
        ];
      } catch {
        return [
          { type: "openclaw_gateway", label: "OpenClaw", available: true, models: [] },
        ] as ChatAdapterInfo[];
      }
    });

    // ── Action: create thread ───────────────────────────────────────
    ctx.actions.register("createThread", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const adapterType = (params.adapterType as string) ?? "openclaw_gateway";
      const model = (params.model as string) ?? "";
      const title = (params.title as string) ?? "New Chat";
      if (!companyId) throw new Error("companyId is required");

      // The bridge route injects `_actor: { userId }` into params when the
      // HTTP caller is an authenticated board user. Persist that as
      // `createdBy` so sendMessage can later forward it to the adapter
      // for per-user session key scoping.
      const actor = (params._actor ?? params.actor) as { userId?: string } | null | undefined;
      const actorUserId = (actor && typeof actor.userId === "string" && actor.userId.length > 0)
        ? actor.userId
        : null;

      const thread: ChatThread = {
        id: generateId(),
        companyId,
        title,
        sessionId: null,
        adapterType,
        model,
        status: "idle",
        createdBy: actorUserId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await saveThread(ctx, thread);
      const ids = await getThreadList(ctx, companyId);
      ids.unshift(thread.id);
      await saveThreadList(ctx, companyId, ids);

      return thread;
    });

    // ── Action: delete thread ───────────────────────────────────────
    ctx.actions.register("deleteThread", async (params: Record<string, unknown>) => {
      const threadId = params.threadId as string;
      const companyId = params.companyId as string;
      if (!threadId || !companyId) throw new Error("threadId and companyId required");

      // Remove from thread list
      const ids = await getThreadList(ctx, companyId);
      const filtered = ids.filter((id) => id !== threadId);
      await saveThreadList(ctx, companyId, filtered);

      // Delete thread and messages state
      await ctx.state.delete({
        scopeKind: "instance",
        scopeId: "global",
        stateKey: threadKey(threadId),
      });
      await ctx.state.delete({
        scopeKind: "instance",
        scopeId: "global",
        stateKey: messagesKey(threadId),
      });

      return { ok: true };
    });

    // ── Action: update thread title ─────────────────────────────────
    ctx.actions.register("updateThreadTitle", async (params: Record<string, unknown>) => {
      const threadId = params.threadId as string;
      const title = params.title as string;
      if (!threadId || !title) throw new Error("threadId and title required");

      const thread = await getThread(ctx, threadId);
      if (!thread) throw new Error("Thread not found");

      thread.title = title;
      thread.updatedAt = new Date().toISOString();
      await saveThread(ctx, thread);
      return thread;
    });

    // ── Action: send message (starts streaming) ─────────────────────
    ctx.actions.register("sendMessage", async (params: Record<string, unknown>) => {
      const threadId = params.threadId as string;
      const message = params.message as string;
      const companyId = params.companyId as string;
      if (!threadId || !message || !companyId) {
        throw new Error("threadId, message, and companyId required");
      }

      const thread = await getThread(ctx, threadId);
      if (!thread) throw new Error("Thread not found");

      // Save user message
      const msgs = await getMessages(ctx, threadId);
      const userMsg: ChatMessage = {
        id: generateId(),
        threadId,
        role: "user",
        content: message,
        metadata: null,
        createdAt: new Date().toISOString(),
      };
      msgs.push(userMsg);
      await saveMessages(ctx, threadId, msgs);

      // Mark thread as running
      thread.status = "running";
      thread.updatedAt = new Date().toISOString();

      // Auto-generate title from first user message
      if (thread.title === "New Chat") {
        const shortTitle = message.length > 60
          ? message.slice(0, 57).replace(/\s+\S*$/, "") + "..."
          : message;
        const titleLine = shortTitle.split("\n")[0] ?? shortTitle;
        thread.title = titleLine;
        // TODO: emit title_updated via stream
      }
      await saveThread(ctx, thread);

      // Track whether this is the first message in the thread (new session)
      const isNewSession = !thread.sessionId;

      // NORA propagates a trace id through the Paperclip bridge
      // (`params._noraTraceId` comes from the `X-Nora-Trace-Id` header the
      // Quick Chat JS stamps on every user turn). Carry it into the
      // sendMessage opts so the adapter can add it to every log line.
      const noraTraceIdRaw = (params as Record<string, unknown>)._noraTraceId;
      const noraTraceId =
        typeof noraTraceIdRaw === "string" && noraTraceIdRaw.length > 0
          ? noraTraceIdRaw
          : undefined;
      if (noraTraceId) {
        ctx.logger.info("chat.sendMessage:start", {
          threadId,
          runId: undefined,
          noraTraceId,
          newSession: isNewSession,
        });
      }

      // Create or resume agent session
      let sessionId = thread.sessionId;
      if (!sessionId) {
        // Look up a chat-suitable agent by adapter type
        // Prefer agents with role "assistant" (dedicated chat agents) over task-oriented agents
        const agents = await ctx.agents.list({ companyId });
        const matching = agents.filter((a) => a.adapterType === thread.adapterType);
        // Preference order:
        //   1. Explicit "Chat Assistant" named agent (NeoCompany convention)
        //   2. CEO role (Neoffice CEO pattern — chat always routes to the coordinator)
        //   3. Generic "general" role
        //   4. First matching agent
        const agent =
          matching.find((a) => a.name === "Chat Assistant") ??
          matching.find((a) => a.role === "ceo") ??
          matching.find((a) => a.role === "general") ??
          matching[0];
        if (!agent) {
          throw new Error(`No agent found with adapter type "${thread.adapterType}". Available: ${agents.map((a) => `${a.name}(${a.adapterType})`).join(", ") || "none"}`);
        }
        const session = await ctx.agents.sessions.create(agent.id, companyId, {
          reason: "Chat plugin: new conversation",
        });
        sessionId = session.sessionId;
        thread.sessionId = sessionId;
        // Remember which agent we are actually talking to so the UI can display
        // the real name (e.g. "Melvyn") instead of a generic "Paperclip" label.
        thread.agentId = agent.id;
        thread.agentName = agent.name;
        await saveThread(ctx, thread);
      }

      // Build agent context for the first message so the copilot knows about
      // available agents and can reference them for handoff.
      let enrichedMessage = message;
      if (isNewSession) {
        const allAgents = await ctx.agents.list({ companyId });
        const agentContext = allAgents.length > 0
          ? `[Available Agents]\n${allAgents.map(a => `- @${a.name} (Role: ${a.role ?? "general"}, Title: ${a.title ?? "N/A"}, Status: ${a.status ?? "unknown"})`).join("\n")}\n\n`
          : "";
        enrichedMessage = agentContext + message;
      }

      // Open SSE stream channel for this thread so the UI gets real-time events
      const streamChannel = `chat:${threadId}`;
      ctx.streams.open(streamChannel, companyId);

      // Collect response segments for persistence
      const segments: ChatMessage["metadata"] = { segments: [] };
      let fullResponse = "";

      // Emit title update if it changed
      if (thread.title !== "New Chat") {
        ctx.streams.emit(streamChannel, { type: "title_updated", title: thread.title });
      }

      // Send message and stream events.
      // ctx.agents.sessions.sendMessage returns immediately once the run is
      // queued — the onEvent callback fires asynchronously via JSON-RPC
      // notifications.  We must wait for the terminal event before saving.
      const RUN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
      const FOLLOW_UP_WINDOW_MS = 90 * 1000; // 90s after primary terminal
      let runId: string | undefined;

      // Multi-phase state machine:
      //  - "primary"   : first run; feeds the `segments` container above and
      //                  resolves the main Promise at its terminal event.
      //  - "follow-up" : OpenClaw may fire additional heartbeat runs on the
      //                  same agent session (subagent_announce → second turn
      //                  with the real result). We keep listening, parse
      //                  their events into a fresh `followUp` container, and
      //                  persist each terminated follow-up run as a NEW
      //                  assistant message in the same thread. A 90 s
      //                  inactivity timer finalises the session.
      //  - "done"      : terminal — further events are ignored.
      let phase: "primary" | "follow-up" | "done" = "primary";
      let followUp: {
        segments: NonNullable<ChatMessage["metadata"]>;
        fullResponse: string;
        pendingText: Array<{ index: number; content: string }>;
        runId: string | null;
      } | null = null;
      let followUpTimer: NodeJS.Timeout | null = null;

      const armFollowUpTimer = () => {
        if (followUpTimer) clearTimeout(followUpTimer);
        followUpTimer = setTimeout(() => {
          phase = "done";
        }, FOLLOW_UP_WINDOW_MS);
      };

      const resetFollowUp = () => {
        followUp = {
          segments: { segments: [] },
          fullResponse: "",
          pendingText: [],
          runId: null,
        };
      };

      const persistFollowUpMessage = async () => {
        if (!followUp) return;
        const rebuilt = followUp.segments.segments
          .filter((seg): seg is { kind: "text"; content: string } =>
            seg.kind === "text" && typeof seg.content === "string" && seg.content.length > 0,
          )
          .map((seg) => seg.content)
          .join("");
        followUp.fullResponse = rebuilt;
        if (!rebuilt.trim() && followUp.segments.segments.length === 0) return;

        try {
          const latestMsgs = await getMessages(ctx, threadId);
          const msg: ChatMessage = {
            id: generateId(),
            threadId,
            role: "assistant",
            content: rebuilt,
            metadata: followUp.segments,
            createdAt: new Date().toISOString(),
          };
          latestMsgs.push(msg);
          await saveMessages(ctx, threadId, latestMsgs);
          ctx.logger.info("follow-up assistant turn persisted", {
            threadId,
            followUpRunId: followUp.runId,
            len: rebuilt.length,
          });
        } catch (saveErr) {
          ctx.logger.error("failed to persist follow-up message", {
            threadId,
            error: String(saveErr),
          });
        }
      };

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("Chat response timed out"));
        }, RUN_TIMEOUT_MS);

        // Text emitted BEFORE a tool call is a retry narration ("Let me
        // try...", "That didn't work, let me..."), not part of the final
        // answer. We only keep text that arrived after the last tool use
        // or tool result — i.e. once the agent has stopped retrying and
        // is producing the answer.
        let pendingText: Array<{ index: number; content: string }> = [];

        const discardPendingText = () => {
          for (const entry of pendingText) {
            const seg = segments.segments[entry.index];
            if (seg && seg.kind === "text") {
              // Neutralise the segment so the UI does not render it.
              seg.content = "";
            }
          }
          pendingText = [];
        };

        const discardFollowUpPending = () => {
          const fu = followUp;
          if (!fu) return;
          for (const entry of fu.pendingText) {
            const seg = fu.segments.segments[entry.index];
            if (seg && seg.kind === "text") seg.content = "";
          }
          fu.pendingText = [];
        };

        const handleFollowUpParsed = (evt: ChatStreamEvent) => {
          if (!followUp) resetFollowUp();
          const fu = followUp;
          if (!fu) return;

          if (evt.type === "text" && evt.text) {
            const last = fu.segments.segments[fu.segments.segments.length - 1];
            if (last && last.kind === "text") {
              last.content += evt.text;
              const pending = fu.pendingText[fu.pendingText.length - 1];
              if (pending && pending.index === fu.segments.segments.length - 1) {
                pending.content += evt.text;
              }
            } else {
              fu.segments.segments.push({ kind: "text", content: evt.text });
              fu.pendingText.push({
                index: fu.segments.segments.length - 1,
                content: evt.text,
              });
            }
            ctx.streams.emit(streamChannel, evt);
            return;
          }
          if (evt.type === "tool_use") {
            discardFollowUpPending();
            fu.segments.segments.push({
              kind: "tool",
              name: evt.name ?? "tool",
              input: evt.input,
              startedAt: Date.now(),
            });
            ctx.streams.emit(streamChannel, evt);
            return;
          }
          if (evt.type === "tool_result") {
            for (let i = fu.segments.segments.length - 1; i >= 0; i--) {
              const seg = fu.segments.segments[i];
              if (seg && seg.kind === "tool" && seg.result === undefined) {
                seg.result = evt.content ?? "";
                seg.isError = evt.isError ?? false;
                seg.finishedAt = Date.now();
                break;
              }
            }
            ctx.streams.emit(streamChannel, evt);
            return;
          }
          if (evt.type === "result" || evt.type === "error") {
            // Persist this follow-up turn as a new assistant message,
            // then reset state and keep the window armed so cascading
            // runs (spawn → announce → spawn → …) all get their own
            // message.
            persistFollowUpMessage().finally(() => {
              followUp = null;
              armFollowUpTimer();
            });
            return;
          }
          ctx.streams.emit(streamChannel, evt);
        };

        const followUpParser = createStreamJsonParser(handleFollowUpParsed);

        // Helper to process parsed stream events in primary phase
        const handleParsedEvent = (chatEvent: ChatStreamEvent) => {
          // Accumulate for persistence
          if (chatEvent.type === "text" && chatEvent.text) {
            const last = segments.segments[segments.segments.length - 1];
            if (last && last.kind === "text") {
              last.content += chatEvent.text;
              const pending = pendingText[pendingText.length - 1];
              if (pending && pending.index === segments.segments.length - 1) {
                pending.content += chatEvent.text;
              }
            } else {
              segments.segments.push({ kind: "text", content: chatEvent.text });
              pendingText.push({
                index: segments.segments.length - 1,
                content: chatEvent.text,
              });
            }
          }
          if (chatEvent.type === "thinking" && chatEvent.text) {
            const last = segments.segments[segments.segments.length - 1];
            if (last && last.kind === "thinking") {
              last.content += chatEvent.text;
            } else {
              segments.segments.push({ kind: "thinking", content: chatEvent.text });
            }
          }
          if (chatEvent.type === "tool_use") {
            // Any text that accumulated before this tool call is retry
            // narration ("Let me try..."). Drop it from persistence.
            // Only tool_use resets the window — tool_result alone does
            // NOT, because a clean final answer after a tool_result (no
            // further tool_use) is legitimate and must survive the filter.
            discardPendingText();
            segments.segments.push({
              kind: "tool",
              name: chatEvent.name ?? "tool",
              input: chatEvent.input,
              startedAt: Date.now(),
            });
          }
          if (chatEvent.type === "tool_result") {
            // Attach the result to the most recent open tool segment.
            // Intentionally do NOT discard pendingText: text emitted AFTER
            // a tool result (with no following tool_use) is the final
            // answer and must be kept.
            for (let i = segments.segments.length - 1; i >= 0; i--) {
              const seg = segments.segments[i];
              if (seg && seg.kind === "tool" && seg.result === undefined) {
                seg.result = chatEvent.content ?? "";
                seg.isError = chatEvent.isError ?? false;
                seg.finishedAt = Date.now();
                break;
              }
            }
          }
          if (chatEvent.type === "session_init" && chatEvent.sessionId) {
            thread.sessionId = chatEvent.sessionId;
          }

          // Terminal events: run completed or errored — resolve the wait.
          // Whatever text is still pending at this point IS the final
          // answer (no tool call followed it), so keep it.
          if (chatEvent.type === "result" || chatEvent.type === "error") {
            // Rebuild fullResponse from the retained text segments so it
            // matches what the UI will render.
            fullResponse = segments.segments
              .filter((seg): seg is { kind: "text"; content: string } =>
                seg.kind === "text" && typeof seg.content === "string" && seg.content.length > 0)
              .map((seg) => seg.content)
              .join("");
            pendingText = [];
            // Fallback when the filter discarded everything and the model
            // produced no final text — keep the UI from rendering an empty bubble.
            if (!fullResponse.trim()) {
              fullResponse =
                "Je n'ai pas réussi à traiter cette demande. Peux-tu reformuler ou préciser ce que tu attends ?";
              segments.segments.push({ kind: "text", content: fullResponse });
            }
            clearTimeout(timer);
            phase = "follow-up";
            armFollowUpTimer();
            resolve();
          }

          // Push event to UI via SSE stream in real-time.
          // We intentionally still emit intermediate text to the live
          // stream so users see something is happening — the filtering
          // above only applies to the persisted message that survives
          // after the run completes.
          ctx.streams.emit(streamChannel, chatEvent);
        };

        // Parse raw stdout chunks (Claude stream-json format) into events
        const parser = createStreamJsonParser(handleParsedEvent);

        ctx.agents.sessions.sendMessage(sessionId, companyId, {
          prompt: enrichedMessage,
          reason: "Chat plugin: user message",
          // Forward the Frappe/Neoffice session user so the adapter scopes
          // the engine-side session key per user. Threads with a null
          // createdBy (legacy / system-invoked) fall back to thread-only
          // scoping, which is still isolated enough — it just doesn't
          // cloister MEMORY across users sharing the same thread id space.
          actorUserId: thread.createdBy ?? undefined,
          // Distributed trace id — see block above.
          noraTraceId,
          onEvent: (event: AgentSessionEvent) => {
            // Reject everything after the follow-up window closes.
            if (phase === "done") return;

            const activeParser = phase === "primary" ? parser : followUpParser;
            const activeHandler = phase === "primary" ? handleParsedEvent : handleFollowUpParsed;

            // The host forwards raw output chunks as "chunk" events.
            // Claude CLI uses stdout, OpenClaw Gateway routes its events through
            // the adapter log channel (stderr/system). We feed every stream to
            // the parser; the per-line regex matchers decide what to do.
            if (event.eventType === "chunk") {
              if (event.message) activeParser.push(event.message);
              return;
            }

            // Terminal events from the host (run status changes)
            if (event.eventType === "done") {
              activeParser.flush();
              activeHandler({
                type: "result",
                usage: event.payload?.usage as ChatStreamEvent["usage"],
                costUsd: event.payload?.costUsd as number | undefined,
              });
              return;
            }
            if (event.eventType === "error") {
              activeParser.flush();
              activeHandler({ type: "error", text: event.message ?? "Unknown error" });
              return;
            }
            if (event.eventType === "status" && event.payload?.sessionId) {
              handleParsedEvent({ type: "session_init", sessionId: event.payload.sessionId as string });
            }
          },
        }).then((result) => {
          runId = result.runId;
        }).catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      // Stream complete — save assistant message
      if (fullResponse || segments.segments.length > 0) {
        const assistantMsg: ChatMessage = {
          id: generateId(),
          threadId,
          role: "assistant",
          content: fullResponse,
          metadata: segments,
          createdAt: new Date().toISOString(),
        };
        const updatedMsgs = await getMessages(ctx, threadId);
        updatedMsgs.push(assistantMsg);
        await saveMessages(ctx, threadId, updatedMsgs);
      }

      // Mark thread idle
      thread.status = "idle";
      thread.updatedAt = new Date().toISOString();
      await saveThread(ctx, thread);

      // Signal stream completion and close the channel
      ctx.streams.emit(streamChannel, { type: "done" });
      ctx.streams.close(streamChannel);

      ctx.logger.info(`Chat message completed`, { threadId, runId });

      return { ok: true, runId };
    });

    // ── Action: stop a running response ─────────────────────────────
    ctx.actions.register("stopThread", async (params: Record<string, unknown>) => {
      const threadId = params.threadId as string;
      const companyId = params.companyId as string;
      if (!threadId || !companyId) throw new Error("threadId and companyId required");

      const thread = await getThread(ctx, threadId);
      if (!thread || !thread.sessionId) return { ok: true, stopped: false };

      await ctx.agents.sessions.close(thread.sessionId, companyId);
      thread.status = "idle";
      thread.sessionId = null; // Force new session on next message
      thread.updatedAt = new Date().toISOString();
      await saveThread(ctx, thread);

      return { ok: true, stopped: true };
    });
  },

  async onHealth() {
    return { status: "ok", message: `${PLUGIN_NAME} ready` };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
