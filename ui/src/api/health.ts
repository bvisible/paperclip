export type DevServerHealthStatus = {
  enabled: true;
  restartRequired: boolean;
  reason: "backend_changes" | "pending_migrations" | "backend_changes_and_pending_migrations" | null;
  lastChangedAt: string | null;
  changedPathCount: number;
  changedPathsSample: string[];
  pendingMigrations: string[];
  autoRestartEnabled: boolean;
  activeRunCount: number;
  waitingForIdle: boolean;
  lastRestartAt: string | null;
};

export type HealthStatus = {
  status: "ok";
  version?: string;
  deploymentMode?: "local_trusted" | "authenticated";
  deploymentExposure?: "private" | "public";
  authReady?: boolean;
  bootstrapStatus?: "ready" | "bootstrap_pending";
  bootstrapInviteActive?: boolean;
  features?: {
    companyDeletionEnabled?: boolean;
  };
  devServer?: DevServerHealthStatus;
};

//// Neoffice Modification: vite-base-paperclip-prefix
//// Why: Health endpoint must be prefixed with API_BASE so it hits
////      /paperclip/health on Neoffice tenants instead of /health (which
////      404s through nginx routing). See ui/src/lib/deployment.ts for
////      the IS_NEOFFICE flag rationale.
//// Date: 2026-05-04
//// Refs: NORA #26 [[NORA/26-quickchat-mobile-paperclip]], NORA #27 Phase R-V6
import { API_BASE } from "./client";
//// End Neoffice Modification: vite-base-paperclip-prefix

export const healthApi = {
  get: async (): Promise<HealthStatus> => {
    const res = await fetch(`${API_BASE}/health`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error ?? `Failed to load health (${res.status})`);
    }
    return res.json();
  },
};
