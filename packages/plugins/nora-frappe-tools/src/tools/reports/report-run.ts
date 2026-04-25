import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  report_name: z.string().min(1),
  filters: z.record(z.unknown()).optional(),
});

interface ReportRunResponse {
  success?: boolean;
  data?: {
    columns?: Array<{ label?: string; fieldname?: string; fieldtype?: string }>;
    result?: unknown[];
    chart?: unknown;
    summary?: unknown;
  };
  result?: unknown[];
  error?: string;
}

export const frappeReportRun: RegisteredToolEntry = {
  name: "frappeReportRun",
  declaration: {
    displayName: "Run Frappe Report",
    description:
      "Run a named Frappe Report (Query Report or Script Report) and return " +
      "its rows + columns. Filters depend on the report — use " +
      "frappeReportRequirements first to know which to pass. Use this for " +
      "Aged Receivables, Trial Balance, Sales Register, and other ERPNext " +
      "standard reports.",
    parametersSchema: {
      type: "object",
      properties: {
        report_name: {
          type: "string",
          description: "Exact report name (e.g. 'Accounts Receivable').",
        },
        filters: {
          type: "object",
          description:
            "Filters object matching the report's filter definitions. " +
            "Common: {company, from_date, to_date, posting_date}.",
          additionalProperties: true,
        },
      },
      required: ["report_name"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const body: Record<string, unknown> = { report_name: input.report_name };
    if (input.filters) body.filters = JSON.stringify(input.filters);

    const res = await frappeFetch<ReportRunResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.generate_report",
      body,
    );

    let parsed: ReportRunResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as ReportRunResponse;
      } catch {
        return { error: `Could not parse generate_report response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "Report run failed" };

    const data = parsed.data ?? parsed;
    const rows = (data as { result?: unknown[] }).result ?? parsed.result ?? [];
    return {
      content: `Rapport ${input.report_name} exécuté — ${rows.length} ligne(s).`,
      data,
    };
  },
};
