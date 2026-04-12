/**
 * Email poller — scheduled job handler that walks every enabled
 * `email_account` entity and pulls new messages via IMAP.
 *
 * **Status**: scaffold only. The real IMAP fetch lives in a next iteration
 * (depends on adding `imapflow` to the plugin and exposing
 * `ctx.secrets.resolve` for the IMAP password). Right now the handler
 * iterates accounts, validates the configuration, and logs whether each
 * one is ready to be polled — useful as an end-to-end sanity check.
 */

import type { PluginContext, PluginJobContext } from "@paperclipai/plugin-sdk";
import type { EmailAccountData } from "./types.js";

const ENTITY_EMAIL_ACCOUNT = "email_account";

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

    // Resolve the password to make sure the secret reference is valid;
    // we don't fetch mail yet, we just confirm the credentials would work.
    try {
      await ctx.secrets.resolve(data.imapPassRef);
    } catch (err) {
      ctx.logger.warn("imap-poll: secret resolution failed", {
        accountId: accountRecord.id,
        error: err instanceof Error ? err.message : String(err),
      });
      skipped++;
      continue;
    }

    ctx.logger.info("imap-poll: account ready (real fetch not implemented yet)", {
      accountId: accountRecord.id,
      address: data.address,
      lastSeenUid: data.lastSeenUid ?? 0,
    });
    polled++;
  }

  ctx.logger.info("imap-poll: cycle finished", { polled, skipped, total: accounts.length });
}
