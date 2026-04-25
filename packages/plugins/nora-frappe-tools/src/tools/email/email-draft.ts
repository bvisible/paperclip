import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  recipient: z.string().min(1),
  subject: z.string().min(1),
  message: z.string().min(1),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  attach_document: z
    .object({
      doctype: z.string(),
      name: z.string(),
      print_format: z.string().optional(),
    })
    .optional(),
});

interface EmailDraftResponse {
  success?: boolean;
  data?: {
    communication_id?: string;
    preview?: string;
    recipient?: string;
    subject?: string;
  };
  communication_id?: string;
  error?: string;
}

export const frappeEmailDraft: RegisteredToolEntry = {
  name: "frappeEmailDraft",
  declaration: {
    displayName: "Draft Email",
    description:
      "Compose an email DRAFT (NEVER sends directly). Returns a communication_id " +
      "the user reviews; once approved, the agent calls frappeEmailConfirm to send. " +
      "Use this for any email — confirmations, reminders, sales replies, " +
      "support responses. Match the user's language. Optional: attach a Frappe " +
      "document like a Sales Invoice via attach_document.",
    parametersSchema: {
      type: "object",
      properties: {
        recipient: {
          type: "string",
          description:
            "Recipient email or name (e.g. 'daniel@example.com' or 'Daniel Moret').",
        },
        subject: { type: "string" },
        message: {
          type: "string",
          description:
            "Email body. HTML allowed. Match the user's language (FR/DE/EN).",
        },
        cc: { type: "string", description: "Optional CC, comma-separated." },
        bcc: { type: "string", description: "Optional BCC, comma-separated." },
        attach_document: {
          type: "object",
          description:
            "Optional: attach a Frappe document (e.g. Sales Invoice).",
          properties: {
            doctype: { type: "string", description: "DocType name." },
            name: { type: "string", description: "Document name/ID." },
            print_format: { type: "string", description: "Optional Print Format." },
          },
          required: ["doctype", "name"],
        },
      },
      required: ["recipient", "subject", "message"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const body: Record<string, unknown> = {
      recipient: input.recipient,
      subject: input.subject,
      message: input.message,
      send_now: false,
    };
    if (input.cc) body.cc = input.cc;
    if (input.bcc) body.bcc = input.bcc;
    if (input.attach_document) {
      body.attach_document = JSON.stringify(input.attach_document);
    }

    const res = await frappeFetch<EmailDraftResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.send_email",
      body,
    );

    let parsed: EmailDraftResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as EmailDraftResponse;
      } catch {
        return { error: `Could not parse send_email response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "Email draft failed" };

    const data = parsed.data ?? parsed;
    const commId =
      (data as { communication_id?: string }).communication_id ?? parsed.communication_id;

    return {
      content:
        `Brouillon créé (${commId ?? "?"}). Présente l'aperçu à l'utilisateur ` +
        `puis appelle frappeEmailConfirm avec ce communication_id pour envoyer.`,
      data: { ...data, communication_id: commId },
    };
  },
};
