/**
 * Thin wrapper around `imapflow` + `mailparser` that fetches new messages
 * from a single IMAP account starting from `lastSeenUid`. Returns a list
 * of normalised `IncomingEmailData` records (without the `accountId`,
 * which the caller fills in).
 *
 * Designed for the scheduled `imap-poll` job — opens a fresh connection
 * every call, drains it, then closes it. No long-lived state.
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { IncomingEmailData } from "./types.js";

export interface ImapPollInput {
  host: string;
  port: number;
  user: string;
  password: string;
  /** Lower bound for UID. Only messages with UID > lastSeenUid are fetched. */
  lastSeenUid?: number;
  /** Optional cap on how many messages to pull per poll cycle. */
  maxMessages?: number;
  /** Mailbox to open (default: INBOX). */
  mailbox?: string;
  /** Whether to use TLS (default: true, port 993). */
  secure?: boolean;
}

export interface ImapPollResult {
  /** New messages parsed from the mailbox. `accountId` is left undefined. */
  messages: Omit<IncomingEmailData, "accountId">[];
  /** Highest UID seen during this poll — caller persists it as the new floor. */
  newLastSeenUid: number;
}

const MAX_BODY_TEXT = 16 * 1024;
const MAX_BODY_HTML = 32 * 1024;

function truncate(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length > max ? value.slice(0, max) + "\n…[truncated]" : value;
}

export async function pollImapAccount(input: ImapPollInput): Promise<ImapPollResult> {
  const client = new ImapFlow({
    host: input.host,
    port: input.port,
    secure: input.secure ?? true,
    auth: { user: input.user, pass: input.password },
    logger: false,
  });

  const messages: Omit<IncomingEmailData, "accountId">[] = [];
  let highestUid = input.lastSeenUid ?? 0;

  await client.connect();
  try {
    const lock = await client.getMailboxLock(input.mailbox ?? "INBOX");
    try {
      const lowerBound = (input.lastSeenUid ?? 0) + 1;
      const range = `${lowerBound}:*`;
      const maxMessages = input.maxMessages ?? 100;
      let processed = 0;

      for await (const msg of client.fetch(range, { uid: true, envelope: true, source: true })) {
        if (processed >= maxMessages) break;
        if (typeof msg.uid !== "number") continue;

        // The IMAP server can echo back lastSeenUid itself when range is "N:*"
        // and there are no newer messages. Skip anything we already saw.
        if (msg.uid <= (input.lastSeenUid ?? 0)) continue;

        let parsed;
        try {
          parsed = await simpleParser(msg.source as Buffer);
        } catch {
          // Malformed message — skip but advance the UID floor so we don't
          // get stuck on it forever.
          if (msg.uid > highestUid) highestUid = msg.uid;
          continue;
        }

        const fromAddress =
          parsed.from?.value?.[0]?.address ?? msg.envelope?.from?.[0]?.address ?? "";
        const fromName =
          parsed.from?.value?.[0]?.name ?? msg.envelope?.from?.[0]?.name ?? undefined;
        const toAddress =
          parsed.to && "value" in parsed.to
            ? parsed.to.value?.[0]?.address ?? ""
            : msg.envelope?.to?.[0]?.address ?? "";

        const subject = parsed.subject ?? msg.envelope?.subject ?? "(no subject)";
        const receivedAt = (parsed.date ?? msg.envelope?.date ?? new Date()).toISOString();
        const bodyText = truncate(parsed.text, MAX_BODY_TEXT);
        const bodyHtml = truncate(typeof parsed.html === "string" ? parsed.html : undefined, MAX_BODY_HTML);

        messages.push({
          uid: msg.uid,
          messageId: parsed.messageId ?? undefined,
          fromName,
          fromAddress,
          toAddress,
          subject,
          bodyText,
          bodyHtml,
          receivedAt,
          status: "pending",
        });

        if (msg.uid > highestUid) highestUid = msg.uid;
        processed++;
      }
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch {
      // best-effort
    }
  }

  return { messages, newLastSeenUid: highestUid };
}
