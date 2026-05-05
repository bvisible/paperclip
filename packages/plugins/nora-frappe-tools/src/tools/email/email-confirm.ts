import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const ModificationsSchema = z.object({
  recipient: z.string().optional(),
  subject: z.string().optional(),
  message: z.string().optional(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
});

const InputSchema = z.object({
  communication_id: z.string().min(1),
  modifications: ModificationsSchema.optional(),
});

interface EmailConfirmResponse {
  success?: boolean;
  data?: { sent?: boolean; recipient?: string; subject?: string };
  error?: string;
}

export const frappeEmailConfirm: RegisteredToolEntry = {
  name: "frappeEmailConfirm",
  declaration: {
    displayName: "Confirm Email Send",
    description:
      "Send a previously-drafted email after the user reviews. Pass the " +
      "communication_id returned by frappeEmailDraft. Optional " +
      "'modifications' applies last-minute edits before sending. " +
      "Call this ONLY after the user has explicitly approved the draft.",
    parametersSchema: {
      type: "object",
      properties: {
        communication_id: {
          type: "string",
          description: "Communication ID from frappeEmailDraft response.",
        },
        modifications: {
          type: "object",
          description: "Optional last-minute edits before sending.",
          properties: {
            recipient: { type: "string" },
            subject: { type: "string" },
            message: { type: "string" },
            cc: { type: "string" },
            bcc: { type: "string" },
          },
        },
      },
      required: ["communication_id"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const body: Record<string, unknown> = {
      communication_id: input.communication_id,
    };
    if (input.modifications) {
      body.modifications = JSON.stringify(input.modifications);
    }

    const res = await frappeFetch<EmailConfirmResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.confirm_send_email",
      body,
    );

    let parsed: EmailConfirmResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as EmailConfirmResponse;
      } catch {
        return { error: `Could not parse confirm_send_email response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "Email send failed" };

    const data = parsed.data ?? {};
    const recipient = (data as { recipient?: string }).recipient;
    const subject = (data as { subject?: string }).subject;

    return {
      content: `Email envoyé${recipient ? ` à ${recipient}` : ""}${subject ? ` — sujet: ${subject}` : ""}.`,
      data,
    };
  },
};
