import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";
import {
  asString,
  asNumber,
  asStringArray,
  parseObject,
  buildPaperclipEnv,
  buildInvocationEnvForLogs,
  ensurePathInEnv,
  resolveCommandForLogs,
  runChildProcess,
} from "../utils.js";

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, config, context, onLog, onMeta } = ctx;
  const command = asString(config.command, "");
  if (!command) throw new Error("Process adapter missing command");

  const args = asStringArray(config.args);
  const cwd = asString(config.cwd, process.cwd());
  const envConfig = parseObject(config.env);
  const env: Record<string, string> = { ...buildPaperclipEnv(agent) };
  for (const [k, v] of Object.entries(envConfig)) {
    if (typeof v === "string") env[k] = v;
  }

  //// Neoffice Modification: pass-issue-id-to-process-runner
  //// Why: avoids the 2.5s findActiveIssue listing for agents with many
  //// historical issues (NORA main: 60 issues → 2.5s p50 vs specialists with
  //// 1-2 issues → 228ms). The scheduler already pre-resolves the issue and
  //// stores it on ctx.context.paperclipIssue, but the built-in process
  //// adapter doesn't expose it as env. We forward it so subprocess runners
  //// can fetch /api/issues/<id> directly instead of paginating the assignee
  //// list. Placed AFTER config.env merge so configured env cannot override
  //// the scheduler's canonical issue id.
  //// Date: 2026-05-04
  //// Refs: NORA [[NORA/25-perf-optimization/05-execution-plan#Phase D]]
  const currentIssue = parseObject(context?.paperclipIssue);
  if (typeof currentIssue.id === "string" && currentIssue.id) {
    env.PAPERCLIP_ISSUE_ID = currentIssue.id;
  }
  //// End Neoffice Modification: pass-issue-id-to-process-runner

  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
  const resolvedCommand = await resolveCommandForLogs(command, cwd, runtimeEnv);
  const loggedEnv = buildInvocationEnvForLogs(env, {
    runtimeEnv,
    includeRuntimeKeys: ["HOME"],
    resolvedCommand,
  });

  const timeoutSec = asNumber(config.timeoutSec, 0);
  const graceSec = asNumber(config.graceSec, 15);

  if (onMeta) {
    await onMeta({
      adapterType: "process",
      command: resolvedCommand,
      cwd,
      commandArgs: args,
      env: loggedEnv,
    });
  }

  const proc = await runChildProcess(runId, command, args, {
    cwd,
    env,
    timeoutSec,
    graceSec,
    onLog,
  });

  if (proc.timedOut) {
    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: true,
      errorMessage: `Timed out after ${timeoutSec}s`,
    };
  }

  if ((proc.exitCode ?? 0) !== 0) {
    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: false,
      errorMessage: `Process exited with code ${proc.exitCode ?? -1}`,
      resultJson: {
        stdout: proc.stdout,
        stderr: proc.stderr,
      },
    };
  }

  return {
    exitCode: proc.exitCode,
    signal: proc.signal,
    timedOut: false,
    resultJson: {
      stdout: proc.stdout,
      stderr: proc.stderr,
    },
  };
}
