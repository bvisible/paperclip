/**
 * Email subsystem types — kept in a dedicated module so tools, jobs and
 * the (future) IMAP poller share a single source of truth.
 */

export interface EmailAccountData {
  /** Mailbox address, e.g. "melvyn@neocompany.ch". */
  address: string;
  /** Friendly label for the operator UI. */
  label?: string;
  /** IMAP host (e.g. imap.gmail.com). */
  imapHost: string;
  /** IMAP port (993 for SSL). */
  imapPort: number;
  /** IMAP username (often the same as address). */
  imapUser: string;
  /** Secret reference for the IMAP password / app password. */
  imapPassRef: string;
  /** Whether IMAP polling is enabled for this account. */
  pollingEnabled: boolean;
  /** Cron-style poll interval in minutes (default 5). */
  pollIntervalMin?: number;
  /** Last UID seen on the IMAP side — used as the lower bound for the next poll. */
  lastSeenUid?: number;
  /** Optional list of agent IDs that may consume mail from this account. */
  allowedAgents?: string[];
  /** Activation status. */
  status?: "active" | "paused" | "error";
  /** Last error message captured by the poller. */
  lastError?: string | null;
}

export interface IncomingEmailData {
  /** Plugin entity ID of the parent email_account. */
  accountId: string;
  /** IMAP UID inside the source mailbox. */
  uid: number;
  /** RFC822 Message-ID header, if any. */
  messageId?: string;
  /** Display name of the sender. */
  fromName?: string;
  /** Sender address. */
  fromAddress: string;
  /** Recipient address (To: header). */
  toAddress: string;
  /** Subject line. */
  subject: string;
  /** Plain text body, truncated to ~16 KB. */
  bodyText?: string;
  /** HTML body, truncated to ~32 KB. */
  bodyHtml?: string;
  /** ISO timestamp. */
  receivedAt: string;
  /** Processing state. */
  status: "pending" | "processed" | "ignored";
  /** Agent that handled (or will handle) this message. */
  assignedAgentId?: string;
  /** Optional Paperclip session id once the agent picks it up. */
  threadId?: string;
}
