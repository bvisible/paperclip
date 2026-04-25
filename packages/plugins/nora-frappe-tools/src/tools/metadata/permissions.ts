import { z } from "zod";
import { frappeFetch } from "../../adapters/frappe.js";
import type { RegisteredToolEntry } from "../types.js";

const InputSchema = z.object({
  doctype: z.string().min(1),
});

interface PermissionsResponse {
  success?: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export const frappePermissions: RegisteredToolEntry = {
  name: "frappePermissions",
  declaration: {
    displayName: "DocType Permissions",
    description:
      "Inspect role/user permissions configured on a DocType. Useful when " +
      "the user reports 'I can't see X' to debug permission issues — but " +
      "DON'T call this proactively; only when a permission denial actually " +
      "happens.",
    parametersSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "DocType name." },
      },
      required: ["doctype"],
    },
  },
  async run(params, runCtx, access) {
    const input = InputSchema.parse(params);
    const config = await access.getFrappeConfig(runCtx.companyId);

    const res = await frappeFetch<PermissionsResponse | string>(
      config,
      "nora.api.frappe_tools_whitelist.get_permissions",
      { doctype: input.doctype },
    );

    let parsed: PermissionsResponse;
    if (typeof res === "string") {
      try {
        parsed = JSON.parse(res) as PermissionsResponse;
      } catch {
        return { error: `Could not parse get_permissions response: ${res.slice(0, 200)}` };
      }
    } else {
      parsed = res;
    }

    if (parsed.success === false) return { error: parsed.error || "Permissions failed" };

    const data = parsed.data ?? parsed;
    return {
      content: `Permissions de ${input.doctype} récupérées.`,
      data,
    };
  },
};
