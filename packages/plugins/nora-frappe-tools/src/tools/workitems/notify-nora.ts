// Wave 4.4 — Bridge realtime: ping NORA after each work-item mutation.
//
// Fire-and-forget POST to nora.api.workitems.notify_update so the Quick
// Chat pastille refreshes instantly when the agent creates or updates an
// issue server-side. Failures are logged and swallowed — the tool's
// primary work (the issue mutation) has already succeeded.

import type { ToolContextAccess } from "../../context.js";

export type NotifyKind =
  | "created"
  | "checked_out"
  | "completed"
  | "comment_added"
  | "approval_requested";

export function notifyNoraWorkItemUpdate(
  ctx: ToolContextAccess,
  companyId: string,
  issueId: string,
  kind: NotifyKind,
): void {
  // Fire-and-forget — never block the agent on the webhook.
  void (async () => {
    try {
      const cfg = await ctx.getFrappeConfig(companyId);
      const cleanBase = cfg.url.replace(/\/+$/, "");
      const url = `${cleanBase}/api/method/nora.api.workitems.notify_update`;
      const headers: Record<string, string> = {
        Authorization: `token ${cfg.apiKey}:${cfg.apiSecret}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (cfg.siteName) headers["X-Frappe-Site-Name"] = cfg.siteName;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ issue_id: issueId, kind, source: "paperclip" }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (_err) {
      // Webhook is best-effort: pastille can still refresh on next QC open
      // or via the next agent_step realtime event the Quick Chat listens to.
    }
  })();
}
