//// Neocompany Modification — tests for createStreamJsonParser
//// Covers all three input formats: OpenClaw Gateway events, Claude CLI
//// stream-json, and the Anthropic API streaming fallback. Pins the contract
//// that malformed lines are skipped silently rather than throwing.
//// End Neocompany Modification

import { describe, expect, it } from "vitest";
import { createStreamJsonParser } from "../stream-parser.js";
import type { ChatStreamEvent } from "../types.js";

function collect(): {
  events: ChatStreamEvent[];
  push: (chunk: string) => void;
  flush: () => void;
} {
  const events: ChatStreamEvent[] = [];
  const parser = createStreamJsonParser((event) => {
    events.push(event);
  });
  return { events, push: parser.push.bind(parser), flush: parser.flush.bind(parser) };
}

describe("createStreamJsonParser", () => {
  // ── Buffering / line splitting ────────────────────────────────────
  describe("buffering and line splitting", () => {
    it("emits nothing when buffer holds an incomplete line", () => {
      const { events, push } = collect();
      push('{"type":"assistant","message":{"content":[{"type":"text","text":"hi"');
      expect(events).toEqual([]);
    });

    it("emits when the incomplete line is later terminated by a newline", () => {
      const { events, push } = collect();
      push('{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}');
      expect(events).toEqual([]); // Still no newline yet
      push("\n");
      expect(events).toEqual([{ type: "text", text: "hi" }]);
    });

    it("emits both events when 2 complete lines arrive in one chunk", () => {
      const { events, push } = collect();
      push(
        '{"type":"assistant","message":{"content":[{"type":"text","text":"A"}]}}\n' +
        '{"type":"assistant","message":{"content":[{"type":"text","text":"B"}]}}\n',
      );
      expect(events.map((e) => (e as { text?: string }).text)).toEqual(["A", "B"]);
    });

    it("skips empty / whitespace lines", () => {
      const { events, push } = collect();
      push("\n   \n\n");
      expect(events).toEqual([]);
    });

    it("handles \\r\\n line endings (Windows-style)", () => {
      const { events, push } = collect();
      push(
        '{"type":"assistant","message":{"content":[{"type":"text","text":"A"}]}}\r\n' +
        '{"type":"assistant","message":{"content":[{"type":"text","text":"B"}]}}\r\n',
      );
      expect(events.map((e) => (e as { text?: string }).text)).toEqual(["A", "B"]);
    });

    it("flush() processes the trailing buffer if it isn't empty", () => {
      const { events, push, flush } = collect();
      push('{"type":"assistant","message":{"content":[{"type":"text","text":"X"}]}}');
      // No newline yet → not parsed.
      expect(events).toHaveLength(0);
      flush();
      expect(events).toEqual([{ type: "text", text: "X" }]);
    });
  });

  // ── Malformed input is silently ignored ──────────────────────────
  describe("malformed input resilience", () => {
    it("skips non-JSON garbage lines", () => {
      const { events, push } = collect();
      push("not json at all\n");
      push("{ broken: 'json' \n");
      expect(events).toEqual([]);
    });

    it("skips JSON without a recognised type", () => {
      const { events, push } = collect();
      push('{"hello":"world"}\n');
      expect(events).toEqual([]);
    });

    it("does not throw when an OCG line carries malformed JSON in the data field", () => {
      const { events, push } = collect();
      expect(() => {
        push("[openclaw-gateway:event] run=r1 stream=assistant data={broken json}\n");
      }).not.toThrow();
      expect(events).toEqual([]);
    });
  });

  // ── OpenClaw Gateway format ──────────────────────────────────────
  describe("OpenClaw Gateway event format", () => {
    it("emits text from a stream=assistant with `delta`", () => {
      const { events, push } = collect();
      push('[openclaw-gateway:event] run=r1 stream=assistant data={"delta":"Hello"}\n');
      expect(events).toEqual([{ type: "text", text: "Hello" }]);
    });

    it("falls back to `text` when `delta` is absent", () => {
      const { events, push } = collect();
      push('[openclaw-gateway:event] run=r1 stream=assistant data={"text":"Bonjour"}\n');
      expect(events).toEqual([{ type: "text", text: "Bonjour" }]);
    });

    it("ignores stream=assistant with empty text", () => {
      const { events, push } = collect();
      push('[openclaw-gateway:event] run=r1 stream=assistant data={"text":""}\n');
      expect(events).toEqual([]);
    });

    it("emits tool_use from stream=tool_use", () => {
      const { events, push } = collect();
      push('[openclaw-gateway:event] run=r1 stream=tool_use data={"name":"sessions_spawn","input":{"agent":"nora"}}\n');
      expect(events).toEqual([
        { type: "tool_use", name: "sessions_spawn", input: { agent: "nora" } },
      ]);
    });

    it("emits tool_result from stream=tool_result with isError flag (camelCase + snake_case)", () => {
      const { events, push } = collect();
      push('[openclaw-gateway:event] run=r1 stream=tool_result data={"content":"done","isError":false}\n');
      push('[openclaw-gateway:event] run=r1 stream=tool_result data={"content":"oops","is_error":true}\n');
      expect(events).toEqual([
        { type: "tool_result", content: "done", isError: false },
        { type: "tool_result", content: "oops", isError: true },
      ]);
    });

    it("stringifies non-string tool_result content", () => {
      const { events, push } = collect();
      push('[openclaw-gateway:event] run=r1 stream=tool_result data={"content":{"k":"v"},"isError":false}\n');
      const evt = events[0] as { content: string };
      expect(JSON.parse(evt.content)).toEqual({ k: "v" });
    });

    it("emits error from stream=error using `error` or `message`", () => {
      const { events, push } = collect();
      push('[openclaw-gateway:event] run=r1 stream=error data={"error":"oh no"}\n');
      push('[openclaw-gateway:event] run=r1 stream=error data={"message":"oh dear"}\n');
      push('[openclaw-gateway:event] run=r1 stream=error data={}\n');
      expect(events).toEqual([
        { type: "error", text: "oh no" },
        { type: "error", text: "oh dear" },
        { type: "error", text: "error" },
      ]);
    });

    // ── stream=item (native OCG tool calls) ────────────────────────
    describe("stream=item native tool/command calls", () => {
      it("kind=tool phase=start → tool_use with meta", () => {
        const { events, push } = collect();
        push('[openclaw-gateway:event] run=r1 stream=item data={"kind":"tool","phase":"start","name":"read","meta":{"path":"/x"}}\n');
        expect(events).toEqual([{ type: "tool_use", name: "read", input: { path: "/x" } }]);
      });

      it("kind=command phase=start defaults name to 'exec'", () => {
        const { events, push } = collect();
        push('[openclaw-gateway:event] run=r1 stream=item data={"kind":"command","phase":"start","title":"ls -la"}\n');
        expect(events).toEqual([{ type: "tool_use", name: "exec", input: "ls -la" }]);
      });

      it("kind=tool phase=end with output → tool_result", () => {
        const { events, push } = collect();
        push('[openclaw-gateway:event] run=r1 stream=item data={"kind":"tool","phase":"end","name":"read","output":"file contents"}\n');
        expect(events).toEqual([{ type: "tool_result", content: "file contents", isError: false }]);
      });

      it("phase=end with status=error → isError=true", () => {
        const { events, push } = collect();
        push('[openclaw-gateway:event] run=r1 stream=item data={"kind":"tool","phase":"end","status":"error","output":"boom"}\n');
        expect((events[0] as { isError: boolean }).isError).toBe(true);
      });

      it("phase=end with exitCode!=0 → isError=true", () => {
        const { events, push } = collect();
        push('[openclaw-gateway:event] run=r1 stream=item data={"kind":"command","phase":"end","exitCode":1,"output":"err"}\n');
        expect((events[0] as { isError: boolean }).isError).toBe(true);
      });

      it("phase=update / delta on a tool item is silently dropped", () => {
        const { events, push } = collect();
        push('[openclaw-gateway:event] run=r1 stream=item data={"kind":"tool","phase":"update","name":"read"}\n');
        push('[openclaw-gateway:event] run=r1 stream=item data={"kind":"tool","phase":"delta","name":"read"}\n');
        expect(events).toEqual([]);
      });

      it("kind=text or other unknown kind is ignored", () => {
        const { events, push } = collect();
        push('[openclaw-gateway:event] run=r1 stream=item data={"kind":"text","phase":"start"}\n');
        expect(events).toEqual([]);
      });
    });
  });

  // ── Claude CLI stream-json format ────────────────────────────────
  describe("Claude CLI stream-json", () => {
    it("emits session_init from system.subtype=init", () => {
      const { events, push } = collect();
      push('{"type":"system","subtype":"init","session_id":"abc-123"}\n');
      expect(events).toEqual([{ type: "session_init", sessionId: "abc-123" }]);
    });

    it("emits text + thinking + tool_use from assistant.content blocks", () => {
      const { events, push } = collect();
      push(
        '{"type":"assistant","message":{"content":[' +
          '{"type":"thinking","thinking":"let me think..."},' +
          '{"type":"text","text":"Here is the answer."},' +
          '{"type":"tool_use","name":"calculator","input":{"expr":"2+2"}}' +
          ']}}\n',
      );
      expect(events).toEqual([
        { type: "thinking", text: "let me think..." },
        { type: "text", text: "Here is the answer." },
        { type: "tool_use", name: "calculator", input: { expr: "2+2" } },
      ]);
    });

    it("defaults tool_use.name to 'tool' when missing", () => {
      const { events, push } = collect();
      push('{"type":"assistant","message":{"content":[{"type":"tool_use","input":{}}]}}\n');
      expect((events[0] as { name: string }).name).toBe("tool");
    });

    it("parses tool_result from user.message.content (string form)", () => {
      const { events, push } = collect();
      push(
        '{"type":"user","message":{"content":[{"type":"tool_result","content":"result string","is_error":false}]}}\n',
      );
      expect(events).toEqual([{ type: "tool_result", content: "result string", isError: false }]);
    });

    it("parses tool_result with array-of-blocks content", () => {
      const { events, push } = collect();
      push(
        '{"type":"user","message":{"content":[{"type":"tool_result","content":[' +
          '{"type":"text","text":"line 1"},' +
          '{"type":"text","text":"line 2"}' +
          ']}]}}\n',
      );
      expect(events).toEqual([
        { type: "tool_result", content: "line 1\nline 2", isError: false },
      ]);
    });

    it("emits result with usage + costUsd", () => {
      const { events, push } = collect();
      push('{"type":"result","usage":{"input_tokens":100,"output_tokens":50},"total_cost_usd":0.0125}\n');
      expect(events).toEqual([
        {
          type: "result",
          usage: { input_tokens: 100, output_tokens: 50 },
          costUsd: 0.0125,
        },
      ]);
    });

    it("falls back to cost_usd when total_cost_usd is missing", () => {
      const { events, push } = collect();
      push('{"type":"result","cost_usd":0.005}\n');
      expect((events[0] as { costUsd: number }).costUsd).toBe(0.005);
    });

    it("ignores non-object / non-array content gracefully", () => {
      const { events, push } = collect();
      push('{"type":"assistant","message":{"content":"not-an-array"}}\n');
      expect(events).toEqual([]);
    });
  });

  // ── Anthropic API fallback ───────────────────────────────────────
  describe("Anthropic API streaming fallback", () => {
    it("emits text from content_block_delta.text_delta", () => {
      const { events, push } = collect();
      push('{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n');
      expect(events).toEqual([{ type: "text", text: "Hello" }]);
    });

    it("emits thinking from content_block_delta.thinking_delta", () => {
      const { events, push } = collect();
      push('{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"thought"}}\n');
      expect(events).toEqual([{ type: "thinking", text: "thought" }]);
    });

    it("ignores unknown delta types", () => {
      const { events, push } = collect();
      push('{"type":"content_block_delta","delta":{"type":"unknown_delta","text":"nope"}}\n');
      expect(events).toEqual([]);
    });
  });
});
