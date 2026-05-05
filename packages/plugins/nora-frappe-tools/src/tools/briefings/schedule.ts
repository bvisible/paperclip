// NORA #27 Phase R-V12.4 — briefings tools (Neoffice patch).
import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  briefing_title: z.string().min(1).max(255),
  prompt: z.string().min(1).max(4000),
  time_hh_mm: z.string().regex(/^[0-2]\d:[0-5]\d$/),
  days: z.enum(["daily", "weekdays", "weekly_monday", "monthly_first"]).default("daily"),
  channel: z.enum(["raven", "whatsapp", "email"]).default("raven"),
  delivery_target: z.string().optional(),
  timezone: z.string().default("Europe/Zurich"),
});

interface ScheduleResponse {
  ok?: boolean;
  briefing_id?: number;
  error?: string;
}

export const noraScheduleBriefing: RegisteredToolEntry = {
  name: "noraScheduleBriefing",
  declaration: {
    displayName: "Schedule a NORA briefing",
    description:
      "Persist a recurring NORA briefing for the current user. The briefing fires " +
      "at the configured local time and Nora's response is delivered through the " +
      "chosen channel. Always call noraUserHasWhatsapp first to decide whether " +
      "to offer WhatsApp as an option, then ask the user for time, topic, and channel.",
    parametersSchema: {
      type: "object",
      properties: {
        briefing_title: {
          type: "string",
          description: "Short label, e.g. 'Briefing matinal'.",
          maxLength: 255,
        },
        prompt: {
          type: "string",
          description:
            "What the briefing must cover, phrased like a user message Nora will receive: 'donne-moi mes factures impayées'.",
          maxLength: 4000,
        },
        time_hh_mm: {
          type: "string",
          description: "Local delivery time HH:MM (24h).",
          pattern: "^[0-2]\\d:[0-5]\\d$",
        },
        days: {
          type: "string",
          enum: ["daily", "weekdays", "weekly_monday", "monthly_first"],
          default: "daily",
          description:
            "When to fire: every day, weekdays Mon-Fri, every Monday, or 1st of the month.",
        },
        channel: {
          type: "string",
          enum: ["raven", "whatsapp", "email"],
          default: "raven",
          description:
            "Where to deliver. Use 'raven' (in-app) by default. Only propose 'whatsapp' if noraUserHasWhatsapp returned true.",
        },
        delivery_target: {
          type: "string",
          description:
            "Email address for 'email' channel. For 'whatsapp' it's auto-resolved from NORA User Settings; only set when overriding.",
        },
        timezone: {
          type: "string",
          default: "Europe/Zurich",
        },
      },
      required: ["briefing_title", "prompt", "time_hh_mm"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);
    const res = await frappeFetch<ScheduleResponse>(
      config,
      "nora.api.v2.briefings.schedule",
      input as unknown as Record<string, unknown>,
    );
    if (res?.ok === false) return { error: res.error || "schedule failed" };
    return {
      content: `Briefing programmé (#${res?.briefing_id ?? "?"}) — ${input.briefing_title} à ${input.time_hh_mm}, ${input.days}, via ${input.channel}.`,
      data: res,
    };
  },
};
