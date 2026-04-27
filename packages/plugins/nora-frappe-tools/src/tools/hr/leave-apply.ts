import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  employee: z.string().min(1),
  leave_type: z.string().min(1),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  half_day: z.boolean().optional(),
  half_day_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().optional(),
});

interface LeaveApplyResponse {
  success: boolean;
  name?: string;
  employee?: string;
  from_date?: string;
  to_date?: string;
  total_leave_days?: number;
  status?: string;
  error?: string;
}

export const frappeLeaveApply: RegisteredToolEntry = {
  name: "frappeLeaveApply",
  declaration: {
    displayName: "Apply for Leave",
    description:
      "Create a Leave Application for an employee (status=Open, awaiting approver). " +
      "Use noraWorkItemRequestApproval BEFORE if the leave impacts payroll or critical " +
      "operational dates. After this tool, the leave is visible to HR for approval.",
    parametersSchema: {
      type: "object",
      properties: {
        employee: { type: "string", description: "Employee name or ID." },
        leave_type: { type: "string", description: "e.g. 'Annual Leave', 'Sick Leave'." },
        from_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        to_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        half_day: { type: "boolean", description: "True if it's a half-day leave." },
        half_day_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Required if half_day=true." },
        reason: { type: "string" },
      },
      required: ["employee", "leave_type", "from_date", "to_date"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const res = await frappeFetch<LeaveApplyResponse>(
      config,
      "nora.api.frappe_tools_whitelist.frappe_leave_apply",
      input as unknown as Record<string, unknown>,
    );

    if (!res.success) {
      return { error: res.error || "Leave application failed" };
    }
    return {
      content:
        `Demande de congé ${res.name} créée pour ${res.employee} : ` +
        `${res.from_date} → ${res.to_date} (${res.total_leave_days} jour(s), statut ${res.status}).`,
      data: res,
    };
  },
};
