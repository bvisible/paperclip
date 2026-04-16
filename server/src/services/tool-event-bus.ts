/**
 * In-process event bus that lets the tool dispatcher notify active
 * adapter sessions about tool_use / tool_result events in real time.
 *
 * Keyed by `runId` (the agent run identifier shared between the adapter
 * session and the tool execution route). When no listener is registered
 * for a runId, events are silently dropped — zero overhead for adapters
 * that don't need this (e.g. Claude CLI which already emits tool blocks
 * natively in the LLM stream).
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
}

function createToolEventBus(): ToolEventBus {
  const listeners = new Map<string, Set<ToolStreamListener>>();

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
