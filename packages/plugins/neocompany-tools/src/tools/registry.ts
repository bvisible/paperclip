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
  // ─── SEO — zero-config ───────────────────────────────────────────────
  seoRobotsCheck: {
    name: "seoRobotsCheck",
    label: "Check robots.txt",
    category: ToolCategory.SEO,
    defaultEnabled: true,
    internal: false,
    allowedRoles: ["seo", "main"],
  },
  seoSitemapCheck: {
    name: "seoSitemapCheck",
    label: "Check sitemap.xml",
    category: ToolCategory.SEO,
    defaultEnabled: true,
    internal: false,
    allowedRoles: ["seo", "main"],
  },
  seoPageSpeed: {
    name: "seoPageSpeed",
    label: "PageSpeed audit",
    category: ToolCategory.SEO,
    defaultEnabled: true,
    internal: false,
    allowedRoles: ["seo", "main"],
  },
  seoContentAudit: {
    name: "seoContentAudit",
    label: "On-page SEO audit",
    category: ToolCategory.SEO,
    defaultEnabled: true,
    internal: false,
    allowedRoles: ["seo", "main"],
  },
  seoCompetitorPageRank: {
    name: "seoCompetitorPageRank",
    label: "Competitor PageRank comparison",
    category: ToolCategory.SEO,
    defaultEnabled: true,
    internal: false,
    allowedRoles: ["seo", "main"],
  },
  geoVisibilityCheck: {
    name: "geoVisibilityCheck",
    label: "GEO visibility check",
    category: ToolCategory.SEO,
    defaultEnabled: true,
    internal: false,
    allowedRoles: ["seo", "main"],
  },
  contentGenerateSocialPosts: {
    name: "contentGenerateSocialPosts",
    label: "Social formatting guidelines",
    category: ToolCategory.CONTENT,
    defaultEnabled: true,
    internal: false,
    allowedRoles: ["writer", "community", "main"],
  },
  contentTopicIdeas: {
    name: "contentTopicIdeas",
    label: "Content topic ideas",
    category: ToolCategory.CONTENT,
    defaultEnabled: true,
    internal: false,
    connectionTrigger: "google",
    allowedRoles: ["writer", "community", "main"],
  },
  // ─── WordPress ───────────────────────────────────────────────────────
  wpListPosts: {
    name: "wpListPosts",
    label: "List WordPress posts",
    category: ToolCategory.WORDPRESS,
    defaultEnabled: false,
    internal: false,
    connectionTrigger: "wordpress",
    allowedRoles: ["writer", "main"],
  },
  wpCreatePost: {
    name: "wpCreatePost",
    label: "Create WordPress post",
    category: ToolCategory.WORDPRESS,
    defaultEnabled: false,
    internal: false,
    connectionTrigger: "wordpress",
    allowedRoles: ["writer", "main"],
  },
  wpUpdatePost: {
    name: "wpUpdatePost",
    label: "Update WordPress post",
    category: ToolCategory.WORDPRESS,
    defaultEnabled: false,
    internal: false,
    connectionTrigger: "wordpress",
    allowedRoles: ["writer", "main"],
  },
  wpListCategories: {
    name: "wpListCategories",
    label: "List WordPress categories / tags",
    category: ToolCategory.WORDPRESS,
    defaultEnabled: false,
    internal: false,
    connectionTrigger: "wordpress",
    allowedRoles: ["writer", "main"],
  },
  wpSiteHealth: {
    name: "wpSiteHealth",
    label: "WordPress site health",
    category: ToolCategory.WORDPRESS,
    defaultEnabled: false,
    internal: false,
    connectionTrigger: "wordpress",
    allowedRoles: ["writer", "main"],
  },
  // ─── SEO — Google OAuth required ────────────────────────────────────
  seoGscKeywords: {
    name: "seoGscKeywords",
    label: "GSC keywords performance",
    category: ToolCategory.SEO,
    defaultEnabled: true,
    internal: false,
    connectionTrigger: "google",
    allowedRoles: ["seo", "main"],
  },
  seoGscTopPages: {
    name: "seoGscTopPages",
    label: "GSC top pages",
    category: ToolCategory.SEO,
    defaultEnabled: true,
    internal: false,
    connectionTrigger: "google",
    allowedRoles: ["seo", "main"],
  },
  seoQuickWins: {
    name: "seoQuickWins",
    label: "SEO quick wins",
    category: ToolCategory.SEO,
    defaultEnabled: true,
    internal: false,
    connectionTrigger: "google",
    allowedRoles: ["seo", "main"],
  },
  seoTrendAnalysis: {
    name: "seoTrendAnalysis",
    label: "SEO trend analysis",
    category: ToolCategory.SEO,
    defaultEnabled: true,
    internal: false,
    connectionTrigger: "google",
    allowedRoles: ["seo", "main"],
  },
  seoGa4Traffic: {
    name: "seoGa4Traffic",
    label: "GA4 traffic snapshot",
    category: ToolCategory.SEO,
    defaultEnabled: true,
    internal: false,
    connectionTrigger: "google",
    allowedRoles: ["seo", "main"],
  },
  seoGa4TopPages: {
    name: "seoGa4TopPages",
    label: "GA4 top pages",
    category: ToolCategory.SEO,
    defaultEnabled: true,
    internal: false,
    connectionTrigger: "google",
    allowedRoles: ["seo", "main"],
  },
  // ─── Email ───────────────────────────────────────────────────────────
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
