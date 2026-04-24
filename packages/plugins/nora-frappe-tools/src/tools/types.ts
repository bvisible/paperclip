import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { ToolContextAccess } from "../context.js";

/** Minimal JSON Schema shape accepted by the Paperclip plugin manifest. */
export type JsonSchema = Record<string, unknown>;

export interface ToolDeclaration {
  displayName: string;
  description: string;
  /** JSON Schema (draft-07 compatible). */
  parametersSchema: JsonSchema;
}

export interface RegisteredToolEntry {
  /** Identifier used by the agent. Convention: frappe<Camel>. */
  name: string;
  declaration: ToolDeclaration;
  /** Main handler. Returns ToolResult or throws. */
  run: (
    params: unknown,
    runCtx: ToolRunContext,
    ctx: ToolContextAccess,
  ) => Promise<ToolResult>;
}

/** Build a human-readable message from an arbitrary Frappe response. */
export function frappeResultOrError<
  TData extends { success?: boolean; error?: string },
>(res: TData, successFormatter: (data: TData) => string): ToolResult {
  if (
    res &&
    typeof res === "object" &&
    "success" in res &&
    res.success === false
  ) {
    return { error: res.error || "Unknown Frappe error" };
  }
  return { content: successFormatter(res), data: res };
}
