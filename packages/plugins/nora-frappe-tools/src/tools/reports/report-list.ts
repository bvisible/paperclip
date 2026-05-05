import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  module: z.string().optional(),
});

interface ReportListResponse {
  success?: boolean;
  data?: { reports?: Array<{ name: string; module?: string; report_type?: string }> };
  error?: string;
}

export const frappeReportList: RegisteredToolEntry = {
  name: "frappeReportList",
  declaration: {
    displayName: "List Reports",
    description:
      "List Frappe Reports available on the instance. Optional module filter " +
      "(e.g. 'Accounts', 'Selling'). Returns name + report_type so you can " +
      "discover useful reports before running them via frappeReportRun.",
    parametersSchema: {
      type: "object",
      properties: {
        module: {
          type: "string",
          description: "Optional module filter (e.g. 'Accounts').",
        },
      },
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const body: Record<string, unknown> = {};
    if (input.module) body.module = input.module;

    const res = await frappeFetch<ReportListResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.list_reports",
      body,
    );

    let parsed: ReportListResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as ReportListResponse;
      } catch {
        return { error: `Could not parse list_reports response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "List reports failed" };

    const data = parsed.data ?? parsed;
    const reports = (data as { reports?: unknown[] }).reports ?? [];
    return {
      content: `${reports.length} rapport(s) disponibles${input.module ? ` dans ${input.module}` : ""}.`,
      data,
    };
  },
};
