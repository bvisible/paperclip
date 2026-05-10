/**
 * emailSendMessage — send an outbound email via SMTP or Resend.
 *
 * MVP: uses a raw fetch call to Resend when `config.provider === "resend"`,
 * or a simple SMTP relay via a local worker-owned nodemailer instance.
 * In this first scaffold we only implement Resend (no extra dependencies);
 * SMTP support is added in Phase 6 when the full email subsystem ships.
 */

import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";

export interface EmailSendParams {
  to: string | string[];
  subject: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  html?: boolean;
}

export interface EmailSendConfig {
  provider: "resend";
  apiKey: string;
  defaultFrom: string;
}

function asArray(v: string | string[] | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
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
  if (params.html) {
    payload.html = params.body;
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
    },
    required: ["to", "subject", "body"],
  } as const,
};
