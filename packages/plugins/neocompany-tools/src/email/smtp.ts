//// Neocompany Modification — minimal dependency-free SMTP client.
////
//// Why: outbound email for our own mailboxes (e.g. Infomaniak) must go
//// through that mailbox's SMTP server so the From: address is authentic and
//// not rejected (a third-party relay like Resend can only send from a
//// domain it has verified). nodemailer is not a declared dependency of this
//// plugin and pnpm's strict layout makes it unresolvable, so rather than add
//// a dependency + a server-side install we speak SMTP directly over Node's
//// built-in `tls` module. Implicit TLS only (port 465) — the simplest secure
//// variant, no STARTTLS upgrade dance. UTF-8 safe: subject is RFC 2047
//// encoded-word, bodies are base64 with CRLF line folding (which also keeps
//// us clear of SMTP dot-stuffing since base64 never emits a leading ".").
//// End Neocompany Modification

import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { randomBytes } from "node:crypto";

export interface SmtpConfig {
  host: string;
  /** 465 for implicit TLS. Other ports are rejected (STARTTLS unsupported here). */
  port: number;
  user: string;
  password: string;
}

export interface SmtpMessage {
  /** Bare from address, e.g. "nora@noraai.ch". */
  from: string;
  /** Optional display name for the From: header. */
  fromName?: string;
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  /** Plain-text alternative. */
  text?: string;
  /** HTML body. When both text and html are present a multipart/alternative is built. */
  html?: string;
}

export interface SmtpSendResult {
  messageId: string;
  response: string;
}

const CRLF = "\r\n";

function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

/** RFC 2047 encoded-word for a header value that may contain non-ASCII. */
function encodeHeaderWord(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${b64(value)}?=`;
}

/** Fold a base64 string into 76-char CRLF-separated lines (RFC 2045). */
function foldBase64(value: string): string {
  return (value.match(/.{1,76}/g) ?? [value]).join(CRLF);
}

function formatAddress(addr: string, name?: string): string {
  return name ? `${encodeHeaderWord(name)} <${addr}>` : addr;
}

/** One reader/writer over the TLS socket exchanging SMTP command/response. */
class SmtpDialogue {
  private buffer = "";
  private resolvers: Array<(line: string) => void> = [];
  private rejecter: ((err: Error) => void) | null = null;

  constructor(private socket: TLSSocket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.onData(chunk));
    socket.on("error", (err) => this.rejecter?.(err));
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    // A complete SMTP reply ends with a line "NNN <space>...". Multiline
    // replies use "NNN-..." for all but the last line.
    let idx: number;
    while ((idx = this.buffer.indexOf(CRLF)) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      // Only resolve on a final line (4th char is a space, not a dash).
      if (/^\d{3} /.test(line)) {
        const r = this.resolvers.shift();
        r?.(line);
      }
    }
  }

  /** Wait for the next final reply line. */
  read(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.rejecter = reject;
      this.resolvers.push(resolve);
    });
  }

  write(data: string) {
    this.socket.write(data);
  }

  /** Send a command line and assert the reply starts with one of `expect`. */
  async cmd(line: string, expect: string[]): Promise<string> {
    this.write(line + CRLF);
    const reply = await this.read();
    const code = reply.slice(0, 3);
    if (!expect.includes(code)) {
      throw new Error(`SMTP command "${line.split(CRLF)[0].slice(0, 40)}" got "${reply}" (expected ${expect.join("/")})`);
    }
    return reply;
  }
}

function buildMime(msg: SmtpMessage, messageId: string): string {
  const headers: string[] = [];
  headers.push(`From: ${formatAddress(msg.from, msg.fromName)}`);
  headers.push(`To: ${msg.to.join(", ")}`);
  if (msg.cc && msg.cc.length) headers.push(`Cc: ${msg.cc.join(", ")}`);
  if (msg.replyTo) headers.push(`Reply-To: ${msg.replyTo}`);
  headers.push(`Subject: ${encodeHeaderWord(msg.subject)}`);
  headers.push(`Date: ${new Date().toUTCString()}`);
  headers.push(`Message-ID: ${messageId}`);
  headers.push("MIME-Version: 1.0");

  const hasHtml = typeof msg.html === "string" && msg.html.length > 0;
  const hasText = typeof msg.text === "string" && msg.text.length > 0;

  if (hasHtml && hasText) {
    const boundary = `=_pcs_${randomBytes(12).toString("hex")}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const parts = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      foldBase64(b64(msg.text!)),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      foldBase64(b64(msg.html!)),
      `--${boundary}--`,
    ];
    return headers.join(CRLF) + CRLF + CRLF + parts.join(CRLF) + CRLF;
  }

  // Single part.
  const isHtml = hasHtml;
  headers.push(`Content-Type: text/${isHtml ? "html" : "plain"}; charset=UTF-8`);
  headers.push("Content-Transfer-Encoding: base64");
  const body = foldBase64(b64(isHtml ? msg.html! : msg.text ?? ""));
  return headers.join(CRLF) + CRLF + CRLF + body + CRLF;
}

/**
 * Send a single message over implicit-TLS SMTP (port 465) with AUTH LOGIN.
 * Resolves with the generated Message-ID on a 250 to the final DATA payload.
 */
export async function smtpSendMail(config: SmtpConfig, msg: SmtpMessage): Promise<SmtpSendResult> {
  if (config.port !== 465) {
    throw new Error(`smtpSendMail only supports implicit TLS on port 465 (got ${config.port})`);
  }
  if (!msg.to.length) throw new Error("smtpSendMail requires at least one recipient");

  const socket = tlsConnect({ host: config.host, port: config.port, servername: config.host });
  const dialogue = new SmtpDialogue(socket);

  const messageId = `<${randomBytes(16).toString("hex")}@${config.host}>`;

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("secureConnect", () => resolve());
      socket.once("error", reject);
    });

    // Greeting
    const greeting = await dialogue.read();
    if (!greeting.startsWith("220")) throw new Error(`SMTP greeting not 220: ${greeting}`);

    await dialogue.cmd(`EHLO ${config.host}`, ["250"]);
    await dialogue.cmd("AUTH LOGIN", ["334"]);
    await dialogue.cmd(b64(config.user), ["334"]);
    await dialogue.cmd(b64(config.password), ["235"]);

    await dialogue.cmd(`MAIL FROM:<${msg.from}>`, ["250"]);
    for (const rcpt of [...msg.to, ...(msg.cc ?? [])]) {
      await dialogue.cmd(`RCPT TO:<${rcpt}>`, ["250", "251"]);
    }
    await dialogue.cmd("DATA", ["354"]);

    const mime = buildMime(msg, messageId);
    const response = await dialogue.cmd(`${mime}${CRLF}.`, ["250"]);

    try {
      await dialogue.cmd("QUIT", ["221"]);
    } catch {
      // Some servers drop the connection right after QUIT — ignore.
    }
    return { messageId, response };
  } finally {
    socket.destroy();
  }
}

/**
 * Verify SMTP connectivity + credentials WITHOUT sending a message:
 * implicit-TLS connect → EHLO → AUTH LOGIN → QUIT. A 235 on the password step
 * proves the host + mailbox credentials accept outbound mail. Used by the
 * "Test" button so the operator knows sending works before an agent tries.
 */
export async function smtpVerify(config: SmtpConfig): Promise<{ ok: true; greeting: string }> {
  if (config.port !== 465) {
    throw new Error(`smtpVerify only supports implicit TLS on port 465 (got ${config.port})`);
  }
  const socket = tlsConnect({ host: config.host, port: config.port, servername: config.host });
  const dialogue = new SmtpDialogue(socket);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("secureConnect", () => resolve());
      socket.once("error", reject);
    });
    const greeting = await dialogue.read();
    if (!greeting.startsWith("220")) throw new Error(`SMTP greeting not 220: ${greeting}`);
    await dialogue.cmd(`EHLO ${config.host}`, ["250"]);
    await dialogue.cmd("AUTH LOGIN", ["334"]);
    await dialogue.cmd(b64(config.user), ["334"]);
    await dialogue.cmd(b64(config.password), ["235"]);
    try {
      await dialogue.cmd("QUIT", ["221"]);
    } catch {
      // Some servers drop the connection right after QUIT — ignore.
    }
    return { ok: true, greeting: greeting.slice(0, 80) };
  } finally {
    socket.destroy();
  }
}
