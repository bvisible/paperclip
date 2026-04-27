import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  posting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  payroll_frequency: z.enum(["Monthly", "Bi-Weekly", "Weekly", "Daily"]).optional(),
  company: z.string().optional(),
  department: z.string().optional(),
  dry_run: z.boolean().optional(),
});

interface PayrollRunResponse {
  success: boolean;
  dry_run?: boolean;
  name?: string;
  period?: { start: string; end: string };
  company?: string;
  employees_count?: number;
  employees?: Array<{ name: string; employee_name: string; department?: string }>;
  status?: number;
  error?: string;
}

export const noraPayrollRun: RegisteredToolEntry = {
  name: "noraPayrollRun",
  declaration: {
    displayName: "Run Payroll",
    description:
      "Trigger a Payroll Entry for a period. **Dry run by default** (returns the list of " +
      "employees that would be processed without creating any doc). To actually create the " +
      "Payroll Entry, set dry_run=false — but you MUST call noraWorkItemRequestApproval first " +
      "(payroll impacts every employee's salary).",
    parametersSchema: {
      type: "object",
      properties: {
        posting_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Default: today." },
        start_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Default: first day of current month." },
        end_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Default: last day of current month." },
        payroll_frequency: { type: "string", enum: ["Monthly", "Bi-Weekly", "Weekly", "Daily"], description: "Default: Monthly." },
        company: { type: "string" },
        department: { type: "string", description: "Optional: filter to one department." },
        dry_run: { type: "boolean", description: "Default true. Set false to create the Payroll Entry." },
      },
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const res = await frappeFetch<PayrollRunResponse>(
      config,
      "nora.api.frappe_tools_whitelist.nora_payroll_run",
      input as unknown as Record<string, unknown>,
    );

    if (!res.success) {
      return { error: res.error || "Payroll run failed" };
    }
    if (res.dry_run) {
      return {
        content:
          `[DRY RUN] Période ${res.period?.start} → ${res.period?.end} : ` +
          `${res.employees_count} employé(s) seraient traité(s). Pas de Payroll Entry créée.`,
        data: res,
      };
    }
    return {
      content: `Payroll Entry ${res.name} créée (période ${res.period?.start} → ${res.period?.end}).`,
      data: res,
    };
  },
};
