/**
 * Email poller — scheduled job handler that walks every enabled
 * `email_account` entity and pulls new messages via IMAP.
 *
 * For each enabled account:
 *   1. Resolve the IMAP password from `ctx.secrets`.
 *   2. Open an IMAP session via `imapflow`, fetch messages with UID >
 *      `lastSeenUid`, parse them with `mailparser`.
 *   3. Persist each new message as an `incoming_email` plugin entity
 *      scoped to the company that owns the account.
 *   4. Update the parent `email_account` entity with the new `lastSeenUid`
 *      and emit a `email.received` plugin event the chat plugin can wake
 *      on (separate handler — out of scope for this file).
 */

import type { PluginContext, PluginJobContext } from "@paperclipai/plugin-sdk";
import type { EmailAccountData, IncomingEmailData } from "./types.js";
import { pollImapAccount } from "./imap-client.js";

const ENTITY_EMAIL_ACCOUNT = "email_account";
const ENTITY_INCOMING_EMAIL = "incoming_email";

export async function runImapPollJob(
  ctx: PluginContext,
  _job: PluginJobContext,
): Promise<void> {
  let accounts;
  try {
    accounts = await ctx.entities.list({ entityType: ENTITY_EMAIL_ACCOUNT, limit: 200 });
  } catch (err) {
    ctx.logger.warn("imap-poll: unable to list email_account entities", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (accounts.length === 0) {
    ctx.logger.debug("imap-poll: no email accounts configured");
    return;
  }

  let polled = 0;
  let skipped = 0;
  let totalNew = 0;

  for (const accountRecord of accounts) {
    const data = (accountRecord.data ?? {}) as unknown as EmailAccountData;
    if (!data.pollingEnabled) {
      skipped++;
      continue;
    }
    if (!data.imapHost || !data.imapUser || !data.imapPassRef) {
      ctx.logger.warn("imap-poll: account misconfigured, skipping", {
        accountId: accountRecord.id,
        address: data.address,
      });
      skipped++;
      continue;
    }
    if (!accountRecord.scopeId) {
      ctx.logger.warn("imap-poll: account has no company scope, skipping", {
        accountId: accountRecord.id,
      });
      skipped++;
      continue;
    }

    let password: string;
    try {
      password = await ctx.secrets.resolve(data.imapPassRef);
    } catch (err) {
      ctx.logger.warn("imap-poll: secret resolution failed", {
        accountId: accountRecord.id,
        error: err instanceof Error ? err.message : String(err),
      });
      skipped++;
      continue;
    }

    let result;
    try {
      result = await pollImapAccount({
        host: data.imapHost,
        port: data.imapPort,
        user: data.imapUser,
        password,
        lastSeenUid: data.lastSeenUid ?? 0,
        maxMessages: 50,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.logger.error("imap-poll: IMAP fetch failed", {
        accountId: accountRecord.id,
        address: data.address,
        error: message,
      });
      // Mark the error on the account so it shows up in the Settings UI
      try {
        await ctx.entities.upsert({
          entityType: ENTITY_EMAIL_ACCOUNT,
          scopeKind: accountRecord.scopeKind,
          scopeId: accountRecord.scopeId,
          externalId: accountRecord.externalId ?? data.address,
          title: accountRecord.title ?? data.address,
          status: "error",
          data: { ...data, status: "error", lastError: message } as unknown as Record<string, unknown>,
        });
      } catch { /* best-effort */ }
      skipped++;
      continue;
    }

    // Persist each new message
    for (const partial of result.messages) {
      const incoming: IncomingEmailData = {
        ...partial,
        accountId: accountRecord.id,
        assignedAgentId: data.allowedAgents?.[0],
      };
      try {
        await ctx.entities.upsert({
          entityType: ENTITY_INCOMING_EMAIL,
          scopeKind: "company",
          scopeId: accountRecord.scopeId,
          externalId: incoming.messageId ?? `${accountRecord.id}:${incoming.uid}`,
          title: incoming.subject,
          status: incoming.status,
          data: incoming as unknown as Record<string, unknown>,
        });
        totalNew++;
      } catch (err) {
        ctx.logger.warn("imap-poll: failed to persist incoming_email", {
          accountId: accountRecord.id,
          uid: incoming.uid,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Update the account's lastSeenUid + clear any prior error
    if (result.newLastSeenUid > (data.lastSeenUid ?? 0)) {
      try {
        await ctx.entities.upsert({
          entityType: ENTITY_EMAIL_ACCOUNT,
          scopeKind: accountRecord.scopeKind,
          scopeId: accountRecord.scopeId,
          externalId: accountRecord.externalId ?? data.address,
          title: accountRecord.title ?? data.address,
          status: "active",
          data: {
            ...data,
            status: "active",
            lastError: null,
            lastSeenUid: result.newLastSeenUid,
          } as unknown as Record<string, unknown>,
        });
      } catch { /* best-effort */ }
    }

    // Emit a plugin event so other plugins (e.g. paperclip-chat) can react.
    if (result.messages.length > 0) {
      try {
        await ctx.events.emit("email.received", accountRecord.scopeId, {
          accountId: accountRecord.id,
          count: result.messages.length,
        });
      } catch { /* best-effort — capability may be missing */ }
    }

    polled++;
  }

  ctx.logger.info("imap-poll: cycle finished", {
    polled,
    skipped,
    totalAccounts: accounts.length,
    newMessages: totalNew,
  });
}
