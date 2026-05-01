// NORA debug toggle — symmetric with openclaw/src/agents/nora-debug.ts.
//
// All NORA-specific diagnostic traces from Paperclip adapters go through
// `noraDiag()`. The function is a no-op unless the `NORA_DEBUG` environment
// variable is set at process start.
//
// Activation:
//   systemctl --user edit paperclip
//   # add: Environment="NORA_DEBUG=1"
//   systemctl --user restart paperclip
//
// Deactivation: drop the env var and restart. No rebuild required.
//
// Output goes through the adapter's `ctx.onLog` so it lands in the Paperclip
// run log (~/.paperclip/instances/default/data/run-logs/<co>/<agent>/<run>.ndjson).
// Use the lazy `() => string` form for expensive payloads.

const NORA_DEBUG_FLAG: boolean =
  process.env.NORA_DEBUG === "1" ||
  process.env.NORA_DEBUG === "true" ||
  process.env.NORA_DEBUG === "yes" ||
  process.env.NORA_DEBUG === "on";

export function isNoraDebugEnabled(): boolean {
  return NORA_DEBUG_FLAG;
}

export type NoraDiagSink = (line: string) => void | Promise<void>;

/**
 * Emit a diagnostic line via the supplied sink (typically
 * `(line) => ctx.onLog("stdout", line + "\n")`). When the toggle is off,
 * `messageFactory` isn't even invoked.
 */
export async function noraDiag(
  sink: NoraDiagSink,
  scope: string,
  message: string | (() => string),
): Promise<void> {
  if (!NORA_DEBUG_FLAG) return;
  let text: string;
  try {
    text = typeof message === "function" ? message() : message;
  } catch (err) {
    text = `<noraDiag formatter threw: ${err instanceof Error ? err.message : String(err)}>`;
  }
  await sink(`[NORA-DIAG][${scope}] ${text}`);
}
