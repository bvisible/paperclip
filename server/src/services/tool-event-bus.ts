/**
 * In-process event bus that lets the tool dispatcher notify active
 * adapter sessions about tool_use / tool_result events in real time.
 *
 * Keyed by `runId` (the agent run identifier shared between the adapter
 * session and the tool execution route). When no listener is registered
 * for a runId, events are silently dropped — zero overhead for adapters
 * that don't need this (e.g. Claude CLI which already emits tool blocks
 * natively in the LLM stream).
 *
 * Because the OpenClaw gateway assigns its own internal runId to agent
 * runs (different from the Paperclip heartbeat runId), the bus also
 * maintains an `agentId → heartbeat runId` mapping. When `emit(runId)`
 * finds no direct subscribers, the dispatcher can use
 * `emitForAgent(agentId)` as a fallback — it resolves the active
 * heartbeat runId and forwards the event there.
 */

export interface ToolUseEvent {
  type: "tool_use";
  name: string;
  input: unknown;
  id: string;
}

export interface ToolResultEvent {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError: boolean;
}

export type ToolStreamEvent = ToolUseEvent | ToolResultEvent;

export type ToolStreamListener = (event: ToolStreamEvent) => void;

export interface ToolEventBus {
  subscribe(runId: string, listener: ToolStreamListener): () => void;
  emit(runId: string, event: ToolStreamEvent): void;
  /** Emit to the active heartbeat run for this agent (fallback). */
  emitForAgent(agentId: string, event: ToolStreamEvent): void;
  /** Register a heartbeat run as the active run for an agent. */
  trackAgent(agentId: string, heartbeatRunId: string): () => void;
}

function createToolEventBus(): ToolEventBus {
  const listeners = new Map<string, Set<ToolStreamListener>>();
  const agentToRunId = new Map<string, string>();

  return {
    subscribe(runId: string, listener: ToolStreamListener): () => void {
      let set = listeners.get(runId);
      if (!set) {
        set = new Set();
        listeners.set(runId, set);
      }
      set.add(listener);
      return () => {
        set!.delete(listener);
        if (set!.size === 0) listeners.delete(runId);
      };
    },

    emit(runId: string, event: ToolStreamEvent): void {
      const set = listeners.get(runId);
      if (!set) return;
      for (const listener of set) {
        try {
          listener(event);
        } catch {
          // Listener errors must not break the dispatcher
        }
      }
    },

    emitForAgent(agentId: string, event: ToolStreamEvent): void {
      const heartbeatRunId = agentToRunId.get(agentId);
      if (!heartbeatRunId) return;
      this.emit(heartbeatRunId, event);
    },

    trackAgent(agentId: string, heartbeatRunId: string): () => void {
      agentToRunId.set(agentId, heartbeatRunId);
      return () => {
        if (agentToRunId.get(agentId) === heartbeatRunId) {
          agentToRunId.delete(agentId);
        }
      };
    },
  };
}

// Singleton — same pattern as globalPluginToolDispatcher
let globalToolEventBus: ToolEventBus | null = null;

export function setGlobalToolEventBus(bus: ToolEventBus): void {
  globalToolEventBus = bus;
}

export function getGlobalToolEventBus(): ToolEventBus | null {
  return globalToolEventBus;
}

export { createToolEventBus };
