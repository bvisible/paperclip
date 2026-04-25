import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  instruction: z.string().min(1),
  date: z.string().min(1),
  time: z.string().optional(),
});

interface ReminderResponse {
  success?: boolean;
  data?: { name?: string; date?: string; time?: string };
  name?: string;
  error?: string;
}

export const frappeReminderCreate: RegisteredToolEntry = {
  name: "frappeReminderCreate",
  declaration: {
    displayName: "Schedule Reminder",
    description:
      "Schedule a one-shot reminder for the current user — fires a " +
      "notification on date/time. Use for 'rappelle-moi de X demain', " +
      "'rappelle-moi d'appeler Swisscom mardi à 10h', etc.",
    parametersSchema: {
      type: "object",
      properties: {
        instruction: { type: "string", description: "What to remind about." },
        date: {
          type: "string",
          description: "ISO date YYYY-MM-DD (e.g. '2026-05-12').",
        },
        time: {
          type: "string",
          description: "HH:MM (24h). Default 09:00.",
        },
      },
      required: ["instruction", "date"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const body: Record<string, unknown> = {
      instruction: input.instruction,
      date: input.date,
    };
    if (input.time) body.time = input.time;

    const res = await frappeFetch<ReminderResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.frappe_reminder_create",
      body,
    );

    let parsed: ReminderResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as ReminderResponse;
      } catch {
        return { error: `Could not parse frappe_reminder_create response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "Reminder creation failed" };

    const data = parsed.data ?? parsed;
    const name = (data as { name?: string }).name;
    return {
      content: `Rappel programmé pour ${input.date} ${input.time ?? "09:00"} (${name ?? "?"}).`,
      data,
    };
  },
};
