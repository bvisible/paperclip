import type { CompanyStatus, PauseReason } from "../constants.js";

export interface Company {
  id: string;
  name: string;
  description: string | null;
  status: CompanyStatus;
  pauseReason: PauseReason | null;
  pausedAt: Date | null;
  issuePrefix: string;
  issueCounter: number;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  attachmentMaxBytes: number;
  requireBoardApprovalForNewAgents: boolean;
  feedbackDataSharingEnabled: boolean;
  feedbackDataSharingConsentAt: Date | null;
  feedbackDataSharingConsentByUserId: string | null;
  feedbackDataSharingTermsVersion: string | null;
  brandColor: string | null;
  //// Neocompany Modification — is_test flag for hidden dev/test companies
  // True for companies tagged as test (__TEST_E2E__ etc.). Filtered out of
  // client boards; visible only on /admin surfaces for instance admins.
  // Optional in the type for back-compat with payloads predating the migration;
  // server default is `false`.
  isTest?: boolean;
  //// End Neocompany Modification
  logoAssetId: string | null;
  logoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}
