//// Neoffice Modification — pure addition (Neocompany fork on top of paperclipai/paperclip)
//// This file does not exist upstream. Safe across upstream merges.

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Palette,
  Images,
  Share2,
  Target,
  CheckSquare,
  CalendarDays,
  TrendingUp,
  Clock,
  AlertCircle,
  Send,
} from "lucide-react";
import { Link } from "@/lib/router";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { pluginsApi } from "@/api/plugins";

interface Channel {
  provider: "linkedin" | "facebook" | "instagram";
  accountId: string;
  accountName: string;
  expiresAt: number | null;
}

interface LibraryImage {
  id: string;
  status: "pending" | "approved" | "rejected";
  source?: "generated" | "upload";
}

interface Template {
  id: string;
  isDefault: boolean;
}

interface SocialPost {
  id: string;
  status:
    | "draft"
    | "pending_review"
    | "approved"
    | "rejected"
    | "scheduled"
    | "publishing"
    | "published"
    | "failed";
  scheduledAt?: string;
  publishedAt?: string;
}

interface Strategy {
  postsPerWeek: Record<string, number>;
  queueSize: number;
  leadTimeWeeks: number;
}

export function ContentDashboard() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Content" }, { label: "Overview" }]);
  }, [setBreadcrumbs]);

  const pluginsQuery = useQuery({ queryKey: ["plugins"], queryFn: () => pluginsApi.list() });
  const neoPlugin = (pluginsQuery.data ?? []).find(
    (p: { pluginKey: string }) => p.pluginKey === "neocompany-tools",
  );
  const pluginId = neoPlugin?.id;

  const channelsQuery = useQuery({
    queryKey: ["dash-channels", selectedCompanyId],
    queryFn: async (): Promise<Channel[]> => {
      if (!pluginId || !selectedCompanyId) return [];
      const res = await pluginsApi.bridgeGetData(
        pluginId,
        "channelsList",
        { companyId: selectedCompanyId },
        selectedCompanyId,
      );
      return (res as { data: { channels: Channel[] } }).data?.channels ?? [];
    },
    enabled: !!pluginId && !!selectedCompanyId,
  });

  const templatesQuery = useQuery({
    queryKey: ["dash-templates", selectedCompanyId],
    queryFn: async (): Promise<Template[]> => {
      if (!pluginId || !selectedCompanyId) return [];
      const res = await pluginsApi.bridgeGetData(
        pluginId,
        "templateList",
        { companyId: selectedCompanyId },
        selectedCompanyId,
      );
      return (res as { data: { templates: Template[] } }).data?.templates ?? [];
    },
    enabled: !!pluginId && !!selectedCompanyId,
  });

  const imagesQuery = useQuery({
    queryKey: ["dash-images", selectedCompanyId],
    queryFn: async (): Promise<LibraryImage[]> => {
      if (!pluginId || !selectedCompanyId) return [];
      const res = await pluginsApi.bridgeGetData(
        pluginId,
        "imageList",
        { companyId: selectedCompanyId, limit: 500, includeImages: false },
        selectedCompanyId,
      );
      return (res as { data: { images: LibraryImage[] } }).data?.images ?? [];
    },
    enabled: !!pluginId && !!selectedCompanyId,
  });

  const postsQuery = useQuery({
    queryKey: ["dash-posts", selectedCompanyId],
    queryFn: async (): Promise<SocialPost[]> => {
      if (!pluginId || !selectedCompanyId) return [];
      const res = await pluginsApi.bridgeGetData(
        pluginId,
        "socialPostsList",
        { companyId: selectedCompanyId, limit: 500 },
        selectedCompanyId,
      );
      return (res as { data: { posts: SocialPost[] } }).data?.posts ?? [];
    },
    enabled: !!pluginId && !!selectedCompanyId,
  });

  const strategyQuery = useQuery({
    queryKey: ["dash-strategy", selectedCompanyId],
    queryFn: async (): Promise<Strategy | null> => {
      if (!pluginId || !selectedCompanyId) return null;
      const res = await pluginsApi.bridgeGetData(
        pluginId,
        "strategyGet",
        { companyId: selectedCompanyId },
        selectedCompanyId,
      );
      return ((res as { data: { strategy: Strategy | null } }).data?.strategy) ?? null;
    },
    enabled: !!pluginId && !!selectedCompanyId,
  });

  const channels = channelsQuery.data ?? [];
  const templates = templatesQuery.data ?? [];
  const images = imagesQuery.data ?? [];
  const posts = postsQuery.data ?? [];
  const strategy = strategyQuery.data ?? null;

  const stats = useMemo(() => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const publishedThisMonth = posts.filter(
      (p) => p.status === "published" && p.publishedAt && new Date(p.publishedAt) >= startOfMonth,
    ).length;
    return {
      channels: channels.length,
      tokenExpiringSoon: channels.filter(
        (c) => c.expiresAt != null && c.expiresAt < Date.now() + 7 * 24 * 60 * 60 * 1000,
      ).length,
      templates: templates.length,
      defaultTemplate: templates.find((t) => t.isDefault),
      libraryApproved: images.filter((i) => i.status === "approved").length,
      libraryGenerated: images.filter((i) => i.source !== "upload").length,
      libraryUploaded: images.filter((i) => i.source === "upload").length,
      pendingReview: posts.filter((p) => p.status === "pending_review").length,
      scheduled: posts.filter((p) => p.status === "scheduled").length,
      failed: posts.filter((p) => p.status === "failed").length,
      publishedThisMonth,
    };
  }, [channels, templates, images, posts]);

  const weeklyTarget = useMemo(() => {
    if (!strategy) return 0;
    return Object.values(strategy.postsPerWeek).reduce((a, b) => a + b, 0);
  }, [strategy]);

  if (pluginsQuery.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!neoPlugin) {
    return (
      <div className="max-w-3xl p-6">
        <p className="text-muted-foreground">
          Install the <strong>neocompany-tools</strong> plugin to use content features.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Content overview</h1>
        <p className="text-sm text-muted-foreground">
          A bird's-eye view of your content pipeline: channels, library, drafts, and the calendar.
        </p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          to="/content/channels"
          icon={Share2}
          label="Channels"
          value={stats.channels}
          hint={stats.tokenExpiringSoon > 0 ? `${stats.tokenExpiringSoon} expiring soon` : undefined}
          hintTone={stats.tokenExpiringSoon > 0 ? "amber" : undefined}
        />
        <Tile
          to="/content/templates"
          icon={Palette}
          label="Templates"
          value={stats.templates}
          hint={stats.defaultTemplate ? "default set" : "no default"}
          hintTone={stats.defaultTemplate ? undefined : "amber"}
        />
        <Tile
          to="/content/stock"
          icon={Images}
          label="Library"
          value={images.length}
          hint={`${stats.libraryApproved} approved`}
        />
        <Tile
          to="/content/approvals"
          icon={CheckSquare}
          label="To approve"
          value={stats.pendingReview}
          hint={stats.pendingReview > 0 ? "drafts awaiting review" : "all clear"}
          hintTone={stats.pendingReview > 0 ? "amber" : undefined}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile to="/content/calendar" icon={Clock} label="Scheduled" value={stats.scheduled} />
        <Tile
          to="/content/calendar"
          icon={Send}
          label="Published this month"
          value={stats.publishedThisMonth}
        />
        <Tile
          to="/content/strategy"
          icon={Target}
          label="Weekly target"
          value={weeklyTarget}
          hint={strategy ? `queue ${strategy.queueSize}` : "no strategy yet"}
          hintTone={strategy ? undefined : "amber"}
        />
        <Tile
          to="/content/calendar"
          icon={AlertCircle}
          label="Failed"
          value={stats.failed}
          hintTone={stats.failed > 0 ? "red" : undefined}
          hint={stats.failed > 0 ? "need attention" : "none"}
        />
      </div>

      {/* Quick links */}
      <section className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Jump into</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <QuickLink to="/content/templates" icon={Palette} label="Templates" />
          <QuickLink to="/content/stock" icon={Images} label="Image library" />
          <QuickLink to="/content/channels" icon={Share2} label="Channels" />
          <QuickLink to="/content/strategy" icon={Target} label="Editorial strategy" />
          <QuickLink to="/content/approvals" icon={CheckSquare} label="Approvals" />
          <QuickLink to="/content/calendar" icon={CalendarDays} label="Calendar" />
        </div>
      </section>

      {/* Health */}
      <section className="rounded-xl border border-border bg-card p-4 space-y-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <TrendingUp className="h-4 w-4" /> Pipeline health
        </h2>
        <ul className="text-sm space-y-1 text-muted-foreground">
          <li>
            {stats.channels === 0 ? (
              <span className="text-amber-700 dark:text-amber-400">
                No channel connected yet — connect at least one in Channels.
              </span>
            ) : (
              <>You have {stats.channels} connected channel{stats.channels > 1 ? "s" : ""}.</>
            )}
          </li>
          <li>
            {stats.defaultTemplate ? (
              <>A default brand overlay template is set.</>
            ) : (
              <span className="text-amber-700 dark:text-amber-400">
                No default template — generated images won't get branding applied.
              </span>
            )}
          </li>
          <li>
            {strategy ? (
              <>
                Editorial strategy: {weeklyTarget} posts / week, {strategy.queueSize} posts awaiting
                review at any time.
              </>
            ) : (
              <span className="text-amber-700 dark:text-amber-400">
                No editorial strategy defined — Pixel won't auto-prepare posts.
              </span>
            )}
          </li>
          <li>
            {stats.pendingReview > 0 ? (
              <>
                {stats.pendingReview} draft{stats.pendingReview > 1 ? "s" : ""} waiting for your
                approval.
              </>
            ) : (
              <>No drafts awaiting approval.</>
            )}
          </li>
          {stats.failed > 0 ? (
            <li className="text-red-700 dark:text-red-400">
              {stats.failed} post{stats.failed > 1 ? "s" : ""} failed to publish. Check Calendar for
              details.
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}

function Tile({
  to,
  icon: Icon,
  label,
  value,
  hint,
  hintTone,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  hint?: string;
  hintTone?: "amber" | "red";
}) {
  const hintColor =
    hintTone === "amber"
      ? "text-amber-700 dark:text-amber-400"
      : hintTone === "red"
      ? "text-red-700 dark:text-red-400"
      : "text-muted-foreground";
  return (
    <Link
      to={to}
      className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-primary/5"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className={`text-[11px] ${hintColor}`}>{hint}</div> : null}
    </Link>
  );
}

function QuickLink({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:border-primary/50 hover:bg-primary/5 transition-colors"
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span>{label}</span>
    </Link>
  );
}
