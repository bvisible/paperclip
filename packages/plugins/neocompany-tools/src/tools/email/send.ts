/**
 * emailSendMessage — send an outbound email via SMTP or Resend.
 *
 * MVP: uses a raw fetch call to Resend when `config.provider === "resend"`,
 * or a simple SMTP relay via a local worker-owned nodemailer instance.
 * In this first scaffold we only implement Resend (no extra dependencies);
 * SMTP support is added in Phase 6 when the full email subsystem ships.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import {
  bodyAlreadyHasSignature,
  stripHtmlToText,
  wrapSignatureHtml,
} from "../../email/signature.js";
import { smtpSendMail } from "../../email/smtp.js";

export interface EmailSendParams {
  to: string | string[];
  subject: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  html?: boolean;
  //// Neocompany Modification — signature controls.
  //// When the worker resolves `EmailSendConfig.signatureHtml` (from the
  //// agent's emailIdentity / company default), it's appended to outbound
  //// HTML bodies inside a sentinel wrapper. The agent can:
  ////   - override with `signatureId` to pick a specific company signature
  ////   - opt out with `appendSignature: false` for a reply inside a thread
  ////     that already carries one.
  //// End Neocompany Modification
  signatureId?: string;
  appendSignature?: boolean;
}

//// Neocompany Modification — provider union (Resend OR direct SMTP).
//// `getEmailSendConfig` returns the SMTP variant when the sending mailbox
//// has an `email_account` with `smtpHost` set (e.g. an Infomaniak box),
//// otherwise the Resend variant (platform default). `signatureHtml` is the
//// pre-resolved + interpolated signature; undefined when the agent has no
//// signature attached AND the company has no default signature.
//// End Neocompany Modification
export interface EmailSmtpTransport {
  host: string;
  port: number;
  user: string;
  password: string;
}

export type EmailSendConfig =
  | { provider: "resend"; apiKey: string; defaultFrom: string; signatureHtml?: string }
  | { provider: "smtp"; smtp: EmailSmtpTransport; defaultFrom: string; signatureHtml?: string };

/** Parse "Display Name <addr@x>" or a bare "addr@x" into parts. */
function parseFromAddress(value: string): { address: string; name?: string } {
  const m = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || undefined, address: m[2].trim() };
  return { address: value.trim() };
}

function asArray(v: string | string[] | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function runEmailSendMessage(
  params: EmailSendParams,
  config: EmailSendConfig,
  _runCtx: ToolRunContext,
): Promise<ToolResult> {
  if (!params.to) return { error: "`to` is required" };
  if (!params.subject) return { error: "`subject` is required" };
  if (!params.body) return { error: "`body` is required" };

  //// Neocompany Modification — compute the HTML/text bodies once (with
  //// signature) then dispatch to the configured transport (SMTP or Resend).
  //// Signature is skipped when the agent opted out, or when the body already
  //// carries a sentinel-wrapped signature (thread anti-duplication).
  //// End Neocompany Modification
  const sig = config.signatureHtml;
  const wantsSignature = params.appendSignature !== false && Boolean(sig);
  const skipForDuplicate = sig && params.html && bodyAlreadyHasSignature(params.body);
  const applySignature = wantsSignature && !skipForDuplicate ? sig : undefined;

  let htmlBody: string | undefined;
  let textBody: string | undefined;
  if (params.html) {
    htmlBody = applySignature
      ? `${params.body}<br><br>${wrapSignatureHtml(applySignature)}`
      : params.body;
    if (applySignature) {
      // Multipart text alternative: strip the signature HTML for clients
      // that won't render HTML.
      textBody = `${stripHtmlToText(params.body)}\n\n${stripHtmlToText(applySignature)}`;
    }
  } else if (applySignature) {
    // Plain-text body but keep the (HTML) signature visible → promote to
    // multipart: text keeps the plain body + stripped sig, html wraps the
    // plain body in <pre> and appends the signature.
    textBody = `${params.body}\n\n${stripHtmlToText(applySignature)}`;
    htmlBody =
      `<pre style="font-family:inherit;white-space:pre-wrap;margin:0">${escapeHtml(params.body)}</pre>` +
      `<br><br>${wrapSignatureHtml(applySignature)}`;
  } else {
    textBody = params.body;
  }

  const toList = asArray(params.to)!;
  const ccList = asArray(params.cc);

  // ── SMTP transport (the sending mailbox's own server, e.g. Infomaniak) ──
  if (config.provider === "smtp") {
    const from = parseFromAddress(config.defaultFrom);
    try {
      const result = await smtpSendMail(config.smtp, {
        from: from.address,
        fromName: from.name,
        to: toList,
        cc: ccList,
        replyTo: params.replyTo,
        subject: params.subject,
        text: textBody,
        html: htmlBody,
      });
      return {
        content: `Email sent to ${toList.join(", ")} (id: ${result.messageId})`,
        data: { id: result.messageId, to: params.to, subject: params.subject },
      };
    } catch (err) {
      return { error: `SMTP send failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // ── Resend transport (platform default) ─────────────────────────────────
  const payload: Record<string, unknown> = {
    from: config.defaultFrom,
    to: toList,
    subject: params.subject,
  };
  if (ccList) payload.cc = ccList;
  if (params.bcc) payload.bcc = asArray(params.bcc);
  if (params.replyTo) payload.reply_to = params.replyTo;
  if (htmlBody) payload.html = htmlBody;
  if (textBody) payload.text = textBody;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    return { error: `Resend API error (${res.status}): ${text}` };
  }

  const data = (await res.json()) as { id?: string };
  return {
    content: `Email sent to ${toList.join(", ")} (id: ${data.id ?? "unknown"})`,
    data: { id: data.id, to: params.to, subject: params.subject },
  };
}

export const emailSendMessageDeclaration = {
  displayName: "Send email",
  description:
    "Send an outbound email to one or more recipients. The `From:` address is derived from the plugin config or the caller agent's email identity if set. Use plain text by default; set `html: true` to send an HTML body.",
  parametersSchema: {
    type: "object",
    properties: {
      to: {
        oneOf: [
          { type: "string", description: "Single recipient address." },
          { type: "array", items: { type: "string" }, description: "Multiple recipient addresses." },
        ],
      },
      subject: { type: "string", description: "Subject line." },
      body: { type: "string", description: "Email body. Plain text unless `html` is true." },
      cc: {
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } },
        ],
      },
      bcc: {
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } },
        ],
      },
      replyTo: { type: "string", description: "Reply-To address override." },
      html: { type: "boolean", description: "If true, body is sent as HTML.", default: false },
      signatureId: {
        type: "string",
        description: "Optional company signature externalId (see emailListSignatures). Overrides the agent's default signature for this send only.",
      },
      appendSignature: {
        type: "boolean",
        description: "Set false to skip appending the agent's signature (e.g. when replying inside a thread that already carries one). Default true.",
        default: true,
      },
    },
    required: ["to", "subject", "body"],
  } as const,
};
