import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { AgentSessionEvent, PluginContext } from "@paperclipai/plugin-sdk";
import type {
  ChatThread,
  ChatMessage,
  ChatStreamEvent,
  ChatAdapterInfo,
} from "./types.js";
//// Neocompany Modification — accumulateText + createStreamJsonParser extracted
//// to dedicated modules so the streaming-defense logic and multi-format parser
//// can be unit-tested without spinning up the whole plugin worker.
//// createHermesPlainTextParser added for hermes_local agents (Hermes prints
//// plain text streamed by Codex, not Claude stream-json).
import { accumulateText } from "./text-accumulation.js";
import { createStreamJsonParser, createHermesPlainTextParser } from "./stream-parser.js";
//// End Neocompany Modification

const PLUGIN_NAME = "paperclip-chat";

//// Neocompany Modification — accumulateText moved to ./text-accumulation.ts
//// (see import at the top of this file). Body removed here to avoid a
//// duplicate-binding error; behaviour is identical.
//// End Neocompany Modification

// ---------------------------------------------------------------------------
// Claude stream-json parser
// ---------------------------------------------------------------------------

//// Neocompany Modification — createStreamJsonParser moved to ./stream-parser.ts
//// (see import at the top of this file). Body removed here to avoid a
//// duplicate-binding error; behaviour is identical.
//// End Neocompany Modification

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
  //// Neocompany Modification — hermes_local adapter label (Hermes migration)
  hermes_local: "Hermes Agent",
  //// End Neocompany Modification
};

//// Neocompany Modification — chat default adapter follows PAPERCLIP_SEED_ADAPTER
// Keeps the chat surface coherent with seed-agents.ts: when the fleet is
// seeded on hermes_local, new chat threads default to hermes_local too;
// otherwise the legacy openclaw_gateway default is unchanged. sendMessage
// matches agents by adapterType, so a mismatch here would mean "no agent
// found" — this keeps the two in lockstep behind a single flag.
function defaultChatAdapterType(): string {
  return process.env.PAPERCLIP_SEED_ADAPTER === "hermes_local"
    ? "hermes_local"
    : "openclaw_gateway";
}
//// End Neocompany Modification

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
          //// Neocompany Modification — fallback adapter follows PAPERCLIP_SEED_ADAPTER
          { type: defaultChatAdapterType(), label: adapterTypeLabel(defaultChatAdapterType()), available: true, models: [] },
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
          //// Neocompany Modification — fallback adapter follows PAPERCLIP_SEED_ADAPTER
          { type: defaultChatAdapterType(), label: adapterTypeLabel(defaultChatAdapterType()), available: true, models: [] },
        ];
      } catch {
        return [
          //// Neocompany Modification — fallback adapter follows PAPERCLIP_SEED_ADAPTER
          { type: defaultChatAdapterType(), label: adapterTypeLabel(defaultChatAdapterType()), available: true, models: [] },
        ] as ChatAdapterInfo[];
      }
    });

    // ── Action: create thread ───────────────────────────────────────
    ctx.actions.register("createThread", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      //// Neocompany Modification — default adapter follows PAPERCLIP_SEED_ADAPTER
      const adapterType = (params.adapterType as string) ?? defaultChatAdapterType();
      //// End Neocompany Modification
      const model = (params.model as string) ?? "";
      const title = (params.title as string) ?? "New Chat";
      // Optional: callers (e.g. NORA bridge) can target a specific agent by id
      // instead of relying on the default CEO-pattern fallback in sendMessage.
      // When provided, we validate it exists on the company and pin it on the
      // thread so every sendMessage on this thread routes to that agent.
      const explicitAgentId = typeof params.agentId === "string" && params.agentId.length > 0
        ? params.agentId
        : null;
      // Wave 7.1b — optional upsert key. Backend channels (NORA WhatsApp,
      // Webmail, Collabora, mobile-legacy) pass an opaque identifier here
      // (e.g. `nora:channel:whatsapp_+41...`) so we reuse the same thread
      // across messages rather than spawning a fresh one each turn. The
      // tuple matched on is (companyId, createdBy, agentId, externalId);
      // including agentId means a Sophie thread and a Marc thread for the
      // same user+channel stay separated, which matches the per-agent
      // session isolation already enforced at the openclaw-gateway layer.
      const externalId = typeof params.externalId === "string" && params.externalId.length > 0
        ? params.externalId
        : null;
      if (!companyId) throw new Error("companyId is required");

      // The bridge route injects `_actor: { userId }` into params when the
      // HTTP caller is an authenticated board user. Persist that as
      // `createdBy` so sendMessage can later forward it to the adapter
      // for per-user session key scoping.
      const actor = (params._actor ?? params.actor) as { userId?: string } | null | undefined;
      const actorUserId = (actor && typeof actor.userId === "string" && actor.userId.length > 0)
        ? actor.userId
        : null;

      let pinnedAgentId: string | null = null;
      let pinnedAgentName: string | null = null;
      if (explicitAgentId) {
        const agents = await ctx.agents.list({ companyId });
        const found = agents.find((a) => a.id === explicitAgentId);
        if (!found) {
          throw new Error(
            `agentId "${explicitAgentId}" not found on company "${companyId}"`,
          );
        }
        pinnedAgentId = found.id;
        pinnedAgentName = found.name;
      }

      // Upsert by externalId — Wave 7.1b. We scan the company's thread
      // list (small, capped by retention) and reuse the first match on the
      // (createdBy, agentId, externalId) tuple. Linear scan is acceptable
      // because the typical company has ≤ a few hundred threads; if that
      // ever becomes a hot path we can index by externalId in plugin_state
      // (key like `chat:thread-by-external:{companyId}:{externalId}`).
      if (externalId) {
        const ids = await getThreadList(ctx, companyId);
        for (const id of ids) {
          const existing = await getThread(ctx, id);
          if (!existing) continue;
          if (existing.externalId !== externalId) continue;
          if (existing.createdBy !== actorUserId) continue;
          if ((existing.agentId ?? null) !== pinnedAgentId) continue;
          // Bump updatedAt so the recency-ordered thread list reflects this
          // turn; otherwise we'd keep returning a stale "first thread".
          existing.updatedAt = new Date().toISOString();
          await saveThread(ctx, existing);
          return existing;
        }
      }

      const thread: ChatThread = {
        id: generateId(),
        companyId,
        title,
        sessionId: null,
        adapterType,
        model,
        agentId: pinnedAgentId,
        agentName: pinnedAgentName,
        status: "idle",
        createdBy: actorUserId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        externalId,
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

      // Structured trace emitter (same JSON shape as nora/utils/trace.py).
      // Each line is prefixed with [trace=<id>] so journalctl scraping from
      // nora.api.trace.show picks it up and extracts the JSON body. Silent
      // no-op when no trace id is propagated (non-chat/paperclip runs).
      const traceService = "paperclip-chat";
      const emitTrace = (
        event: string,
        phase: "start" | "end" | "error",
        extra: Record<string, unknown> = {},
      ) => {
        if (!noraTraceId) return;
        const payload = {
          ts: new Date().toISOString(),
          trace_id: noraTraceId,
          thread_id: threadId,
          service: traceService,
          event,
          phase,
          ...extra,
        };
        // `ctx.logger` goes to the plugin-host log; route through it and
        // tag with the prefix so the `[trace=<id>]` regex in trace.show
        // matches the line.
        ctx.logger.info(`[trace=${noraTraceId}] ${JSON.stringify(payload)}`);
      };

      const traceSendStart = Date.now();
      emitTrace("chat.sendMessage", "start", {
        newSession: isNewSession,
        msg_len: message.length,
      });

      // Create or resume agent session
      let sessionId = thread.sessionId;
      if (!sessionId) {
        // If the thread was created with a pinned agentId (NORA bridge),
        // honor it and skip the CEO-pattern selection entirely. Otherwise
        // fall back to the default preference order.
        const agents = await ctx.agents.list({ companyId });
        const matching = agents.filter((a) => a.adapterType === thread.adapterType);
        let agent = thread.agentId
          ? matching.find((a) => a.id === thread.agentId)
          : undefined;
        if (!agent) {
          // Preference order:
          //   1. Explicit "Chat Assistant" named agent (NeoCompany convention)
          //   2. CEO role (Neoffice CEO pattern — chat always routes to the coordinator)
          //   3. Generic "general" role
          //   4. First matching agent
          agent =
            matching.find((a) => a.name === "Chat Assistant") ??
            matching.find((a) => a.role === "ceo") ??
            matching.find((a) => a.role === "general") ??
            matching[0];
        }
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
          emitTrace("chat.follow_up_turn", "end", {
            status: "ok",
            response_len: rebuilt.length,
            segment_count: followUp.segments.segments.length,
          });
        } catch (saveErr) {
          ctx.logger.error("failed to persist follow-up message", {
            threadId,
            error: String(saveErr),
          });
          emitTrace("chat.follow_up_turn", "error", {
            status: "error",
            error: String(saveErr).slice(0, 160),
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
              last.content = accumulateText(last.content, evt.text);
              const pending = fu.pendingText[fu.pendingText.length - 1];
              if (pending && pending.index === fu.segments.segments.length - 1) {
                pending.content = accumulateText(pending.content, evt.text);
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

        //// Neocompany Modification — adapter-aware parser selection
        // hermes_local prints plain text on stdout; every other adapter we
        // wire is Claude/OpenClaw stream-json. Picking the right parser per
        // thread lets the UI see live token-by-token text on hermes runs
        // instead of waiting for the done-event resultJson harvest below.
        const pickParser = (handler: (evt: ChatStreamEvent) => void) =>
          thread.adapterType === "hermes_local"
            ? createHermesPlainTextParser(handler)
            : createStreamJsonParser(handler);
        //// End Neocompany Modification

        const followUpParser = pickParser(handleFollowUpParsed);

        // Helper to process parsed stream events in primary phase
        const handleParsedEvent = (chatEvent: ChatStreamEvent) => {
          // Accumulate for persistence
          if (chatEvent.type === "text" && chatEvent.text) {
            const last = segments.segments[segments.segments.length - 1];
            if (last && last.kind === "text") {
              last.content = accumulateText(last.content, chatEvent.text);
              const pending = pendingText[pendingText.length - 1];
              if (pending && pending.index === segments.segments.length - 1) {
                pending.content = accumulateText(pending.content, chatEvent.text);
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
              last.content = accumulateText(last.content, chatEvent.text);
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
            const toolStart = Date.now();
            segments.segments.push({
              kind: "tool",
              name: chatEvent.name ?? "tool",
              input: chatEvent.input,
              startedAt: toolStart,
            });
            emitTrace("chat.tool_use", "start", {
              tool: chatEvent.name ?? "tool",
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
                emitTrace("chat.tool_use", "end", {
                  tool: seg.name,
                  duration_ms: seg.finishedAt - (seg.startedAt ?? seg.finishedAt),
                  status: chatEvent.isError ? "error" : "ok",
                });
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
            const toolCount = segments.segments.filter((s) => s.kind === "tool").length;
            emitTrace("chat.primary", "end", {
              duration_ms: Date.now() - traceSendStart,
              status: chatEvent.type === "error" ? "error" : "ok",
              tool_count: toolCount,
            });
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

        //// Neocompany Modification — adapter-aware parser (Hermes plain text vs Claude json)
        // See pickParser() comment near followUpParser above.
        const parser = pickParser(handleParsedEvent);
        //// End Neocompany Modification

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
              //// Neocompany Modification — fallback harvest if the stream
              //// produced no text. Originally added because Hermes plain text
              //// wasn't parsed (Claude json parser ignored it), so the only
              //// way to get the final response was payload.resultJson.result.
              //// With createHermesPlainTextParser now wired (stream-parser.ts),
              //// the stream usually fills text segments live — only fall back
              //// when nothing was captured (e.g. the SSE stream raced ahead
              //// of the done event and was lost, or a future adapter format
              //// we haven't taught the parser yet).
              const activeSegments = phase === "primary" ? segments.segments : (followUp?.segments.segments ?? []);
              const streamGotText = activeSegments.some(
                (seg) => seg.kind === "text" && typeof seg.content === "string" && seg.content.trim().length > 0,
              );
              if (!streamGotText) {
                const adapterResult =
                  (event.payload?.resultJson as Record<string, unknown> | undefined)?.result ??
                  (event.payload?.resultJson as Record<string, unknown> | undefined)?.summary ??
                  event.payload?.summary;
                if (typeof adapterResult === "string" && adapterResult.trim().length > 0) {
                  activeHandler({ type: "text", text: adapterResult });
                }
              }
              //// End Neocompany Modification
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
        emitTrace("chat.persist", "end", {
          status: "ok",
          response_len: fullResponse.length,
          segment_count: segments.segments.length,
        });
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
