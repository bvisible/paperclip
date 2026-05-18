//// Neocompany Modification — extracted createStreamJsonParser for testability
//// Previously inlined in worker.ts. Moved here verbatim — no behaviour change.
//// Handles three input formats:
////   1. [openclaw-gateway:event] lines (OCG native format)
////   2. Claude CLI --output-format stream-json (system/assistant/user/result)
////   3. Anthropic API streaming fallback (content_block_delta)
//// Also exports createHermesPlainTextParser for hermes-paperclip-adapter
//// (plain-text stdout, no JSON framing).
//// End Neocompany Modification

import type { ChatStreamEvent } from "./types.js";

/**
 * Buffers raw stdout chunks and emits parsed ChatStreamEvents for each
 * complete JSON line from Claude CLI's `--output-format stream-json`,
 * plus the OpenClaw Gateway and Anthropic streaming fallbacks.
 */
export function createStreamJsonParser(emit: (event: ChatStreamEvent) => void) {
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

//// Neocompany Modification — Hermes plain-text streaming parser
//
// hermes-paperclip-adapter (used by every hermes_local agent) doesn't emit
// Claude stream-json. Its CLI (`hermes chat -q ... -Q --yolo`) writes plain
// text streamed by Codex token-by-token, interleaved with bracketed meta
// lines and a final `session_id: <id>`. The Claude json parser above can't
// make sense of any of it, so without this parser the UI never sees the
// progressive response — only the final post-run harvest from
// payload.resultJson.result (added in worker.ts at the done event) makes
// the message appear, and only after Hermes finishes.
//
// This parser tails stdout line by line, filters the same meta the upstream
// adapter strips in cleanResponse() (execute.js:185-220 — see
// `HERMES_META_PREFIXES` below), and forwards everything else as
// `{ type: "text", text: line + "\n" }`. The handler in worker.ts pushes
// each text event into the UI stream channel via ctx.streams.emit, so the
// chat bubble fills in live.
//
// Skip list mirrors the upstream cleanResponse precisely:
//   - blank lines        → kept (paragraph separators)
//   - "[tool]" prefix    → skip (subagent calls)
//   - "[hermes]"         → skip (adapter setup logs)
//   - "[paperclip]"      → skip (PAPERCLIP_API_KEY guard messages)
//   - "session_id:"      → skip (Hermes prints this last; persisted via
//                                resultJson.session_id by the adapter)
//   - ISO timestamps     → skip (log decorations: `[2026-05-18T...]`)
//   - `[done] ┊` line    → skip (CLI run-end marker)
//   - lone emoji status  → skip (`✅ Completed`, `⏳ Running`, etc.)
//   - `┊ 💬` decoration  → stripped (keep the chat content, drop the bullet)
const HERMES_META_PREFIXES = ["[tool]", "[hermes]", "[paperclip]", "session_id:"] as const;
const HERMES_ISO_TIMESTAMP = /^\[\d{4}-\d{2}-\d{2}T/;
const HERMES_DONE_DECORATION = /^\[done\]\s*┊/;
const HERMES_EMOJI_STATUS = /^\p{Emoji_Presentation}\s*(Completed|Running|Error)?\s*$/u;
const HERMES_BUBBLE_DECORATION = /^[\s]*┊\s*💬\s*/;

function cleanHermesLine(line: string): string | null {
  const trimmed = line.trim();
  // Keep blank lines so paragraph breaks survive in the UI rendering.
  if (!trimmed) return "";
  for (const prefix of HERMES_META_PREFIXES) {
    if (trimmed.startsWith(prefix)) return null;
  }
  if (HERMES_ISO_TIMESTAMP.test(trimmed)) return null;
  if (HERMES_DONE_DECORATION.test(trimmed)) return null;
  if (HERMES_EMOJI_STATUS.test(trimmed)) return null;
  // Strip the `┊ 💬` bullet but keep whatever followed it (the actual reply).
  return line.replace(HERMES_BUBBLE_DECORATION, "");
}

/**
 * Buffers raw stdout chunks from hermes-paperclip-adapter and emits a
 * `{ type: "text" }` event per non-meta line. Pairs with worker.ts's
 * adapter-aware parser selection so hermes_local threads stream live while
 * claude_local / openclaw_gateway keep using `createStreamJsonParser`.
 */
export function createHermesPlainTextParser(emit: (event: ChatStreamEvent) => void) {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      // Keep the last (possibly incomplete) line in the buffer
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const cleaned = cleanHermesLine(line);
        if (cleaned === null) continue;
        // Re-add the newline that split consumed so paragraphs survive
        // once the handler concatenates all text events into fullResponse.
        emit({ type: "text", text: cleaned + "\n" });
      }
    },
    /** Flush any remaining buffer content (final unterminated line) */
    flush() {
      if (buffer.length === 0) return;
      const cleaned = cleanHermesLine(buffer);
      if (cleaned !== null && cleaned.length > 0) {
        emit({ type: "text", text: cleaned });
      }
      buffer = "";
    },
  };
}
//// End Neocompany Modification
