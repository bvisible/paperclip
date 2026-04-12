/**
 * Static metadata registry for NeoCompany tools — adapted from the legacy
 * Postiz `tool.registry.ts`. Drives both the manifest tool declarations and
 * the per-company / per-agent access control surface.
 *
 * Each entry maps a tool name to its category, default enabled state,
 * visibility flag, and (optionally) the agent roles that should see it.
 */

export enum ToolCategory {
  SEO = "seo",
  CONTENT = "content",
  WORDPRESS = "wordpress",
  BLOG = "blog",
  SOCIAL = "social",
  AD_CAMPAIGN = "ad_campaign",
  POST_MANAGEMENT = "post_management",
  ANALYTICS = "analytics",
  MEDIA = "media",
  CRAWLER = "crawler",
  EMAIL = "email",
  DESIGN = "design",
  INTERNAL = "internal",
}

export interface ToolMetadata {
  name: string;
  label: string;
  category: ToolCategory;
  defaultEnabled: boolean;
  internal: boolean;
  connectionTrigger?: "wordpress" | "google" | null;
  allowedRoles?: string[];
}

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  [ToolCategory.SEO]: "SEO & Analytics",
  [ToolCategory.CONTENT]: "Content Writing",
  [ToolCategory.WORDPRESS]: "WordPress",
  [ToolCategory.BLOG]: "Blog",
  [ToolCategory.SOCIAL]: "Social Media",
  [ToolCategory.AD_CAMPAIGN]: "Ad Campaigns",
  [ToolCategory.POST_MANAGEMENT]: "Post Management",
  [ToolCategory.ANALYTICS]: "Analytics",
  [ToolCategory.MEDIA]: "Media & Video",
  [ToolCategory.CRAWLER]: "Website Crawler",
  [ToolCategory.EMAIL]: "Email",
  [ToolCategory.DESIGN]: "Design Studio",
  [ToolCategory.INTERNAL]: "Internal (Admin)",
};

export const TOOL_REGISTRY: Record<string, ToolMetadata> = {
  // ─── SEO (MVP: GSC keywords is the first tool we port) ───────────────
  seoGscKeywords: {
    name: "seoGscKeywords",
    label: "GSC keywords performance",
    category: ToolCategory.SEO,
    defaultEnabled: true,
    internal: false,
    connectionTrigger: "google",
    allowedRoles: ["seo", "main"],
  },

  // ─── Email (MVP: send is the second tool we port) ────────────────────
  emailSendMessage: {
    name: "emailSendMessage",
    label: "Send email",
    category: ToolCategory.EMAIL,
    defaultEnabled: false,
    internal: true,
    allowedRoles: ["support", "commercial", "main"],
  },
};

export type ToolName = keyof typeof TOOL_REGISTRY;
