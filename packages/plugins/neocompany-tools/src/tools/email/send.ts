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

export interface EmailSendConfig {
  provider: "resend";
  apiKey: string;
  defaultFrom: string;
  //// Neocompany Modification — pre-resolved + interpolated signature HTML
  //// from the worker's `getEmailSendConfig`. Undefined when the agent has
  //// no signature attached AND the company has no default signature.
  signatureHtml?: string;
  //// End Neocompany Modification
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

  if (config.provider !== "resend") {
    return { error: `Unsupported email provider "${config.provider}"` };
  }

  const payload: Record<string, unknown> = {
    from: config.defaultFrom,
    to: asArray(params.to),
    subject: params.subject,
  };
  if (params.cc) payload.cc = asArray(params.cc);
  if (params.bcc) payload.bcc = asArray(params.bcc);
  if (params.replyTo) payload.reply_to = params.replyTo;

  //// Neocompany Modification — signature append (HTML + text fallback).
  //// Skip when the agent explicitly opted out, or when the body already
  //// carries a sentinel-wrapped signature (thread anti-duplication).
  //// End Neocompany Modification
  const sig = config.signatureHtml;
  const wantsSignature = params.appendSignature !== false && Boolean(sig);
  const skipForDuplicate = sig && params.html && bodyAlreadyHasSignature(params.body);
  const applySignature = wantsSignature && !skipForDuplicate && sig;

  if (params.html) {
    payload.html = applySignature
      ? `${params.body}<br><br>${wrapSignatureHtml(applySignature)}`
      : params.body;
    if (applySignature) {
      // Multipart text alternative: strip the signature HTML for clients
      // that won't render HTML. The text body itself stays raw HTML when
      // params.html is true (Resend accepts both alongside).
      payload.text = `${stripHtmlToText(params.body)}\n\n${stripHtmlToText(applySignature)}`;
    }
  } else if (applySignature) {
    // Plain-text body but we still want the (HTML) signature visible:
    // promote to multipart — `text` keeps the plain body + stripped sig,
    // `html` wraps the plain body in <pre> and appends the signature.
    payload.text = `${params.body}\n\n${stripHtmlToText(applySignature)}`;
    payload.html =
      `<pre style="font-family:inherit;white-space:pre-wrap;margin:0">${escapeHtml(params.body)}</pre>` +
      `<br><br>${wrapSignatureHtml(applySignature)}`;
  } else {
    payload.text = params.body;
  }

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
    content: `Email sent to ${Array.isArray(params.to) ? params.to.join(", ") : params.to} (id: ${data.id ?? "unknown"})`,
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
