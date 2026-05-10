//// Neocompany Modification — pure addition (Neocompany fork on top of paperclipai/paperclip)
//// This file does not exist upstream. Safe across upstream merges.

/**
 * Admin-specific API functions for the /admin dashboard.
 * These wrap existing backend routes that don't have dedicated
 * client functions in the companies/access/plugins API modules.
 */

import { api } from "./client";
import type { Agent } from "@paperclipai/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminIsAdminResponse {
  isAdmin: boolean;
}

export interface CompanyMember {
  id: string;
  companyId: string;
  principalType: "user" | "agent";
  principalId: string;
  status: "active" | "pending" | "suspended";
  membershipRole: string | null;
  createdAt: string;
  updatedAt: string;
  // Hydrated fields (may come from a join)
  userName?: string | null;
  userEmail?: string | null;
  isInstanceAdmin?: boolean;
}

export interface CompanyAccessResponse {
  companyIds: string[];
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const adminApi = {
  /** Check if the current session user is an instance admin. */
  checkIsAdmin: () =>
    api.get<AdminIsAdminResponse>("/plugins/neocompany-tools/bridge/am-i-admin"),

  /** List members (users + agents) of a company. */
  listCompanyMembers: (companyId: string) =>
    api.get<CompanyMember[]>(`/companies/${companyId}/members`),

  /** List agents belonging to a company. */
  listCompanyAgents: (companyId: string) =>
    api.get<Agent[]>(`/companies/${companyId}/agents`),

  /** Promote a user to instance admin. */
  promoteAdmin: (userId: string) =>
    api.post(`/admin/users/${userId}/promote-instance-admin`, {}),

  /** Demote an instance admin. */
  demoteAdmin: (userId: string) =>
    api.post(`/admin/users/${userId}/demote-instance-admin`, {}),

  /** Get a user's company access list. */
  getUserCompanyAccess: (userId: string) =>
    api.get<CompanyAccessResponse>(`/admin/users/${userId}/company-access`),

  /** Set which companies a user can access. */
  setUserCompanyAccess: (userId: string, companyIds: string[]) =>
    api.put(`/admin/users/${userId}/company-access`, { companyIds }),
};
