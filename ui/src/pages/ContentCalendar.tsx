import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Linkedin, Facebook, Instagram } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { Button } from "@/components/ui/button";
import { pluginsApi } from "@/api/plugins";

type ProviderKey = "linkedin" | "facebook" | "instagram";
type Status =
  | "draft"
  | "pending_review"
  | "approved"
  | "rejected"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed";

interface SocialPost {
  id: string;
  text: string;
  imageId?: string;
  channel: { provider: ProviderKey; channelKey: string };
  proposedAt: string;
  scheduledAt?: string;
  publishedAt?: string;
  providerPostId?: string;
  status: Status;
  lastError?: string;
  createdAt: string;
}

interface LibraryImage {
  id: string;
  finalImageUrl?: string;
}

const PROVIDER_ICON: Record<ProviderKey, React.ComponentType<{ className?: string }>> = {
  linkedin: Linkedin,
  facebook: Facebook,
  instagram: Instagram,
};

const STATUS_COLOR: Record<Status, string> = {
  draft: "bg-muted text-foreground",
  pending_review: "bg-amber-100 text-amber-900 border border-amber-300",
  approved: "bg-emerald-100 text-emerald-900 border border-emerald-300",
  rejected: "bg-red-100 text-red-900 border border-red-300",
  scheduled: "bg-sky-100 text-sky-900 border border-sky-300",
  publishing: "bg-violet-100 text-violet-900 border border-violet-300",
  published: "bg-emerald-500 text-white",
  failed: "bg-red-500 text-white",
};

const DAY_LABELS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfMonth(d: Date): Date {
  const out = new Date(d);
  out.setDate(1);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + n);
  return out;
}

/** Return 42 dates covering full weeks that contain `month`. ISO week (Mon=0). */
function monthGridDates(month: Date): Date[] {
  const start = startOfMonth(month);
  // JS getDay returns 0 (Sun) .. 6 (Sat). We want Mon=0 .. Sun=6.
  const jsDow = start.getDay();
  const isoDow = (jsDow + 6) % 7;
  const firstCell = new Date(start);
  firstCell.setDate(start.getDate() - isoDow);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(firstCell);
    d.setDate(firstCell.getDate() + i);
    cells.push(d);
  }
  return cells;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  );
}

function formatMonthLabel(d: Date, locale: string = "en-US"): string {
  return d.toLocaleDateString(locale, { month: "long", year: "numeric" });
}

export function ContentCalendar() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [cursor, setCursor] = useState<Date>(startOfMonth(new Date()));

  useEffect(() => {
    setBreadcrumbs([{ label: "Content" }, { label: "Calendar" }]);
  }, [setBreadcrumbs]);

  const pluginsQuery = useQuery({ queryKey: ["plugins"], queryFn: () => pluginsApi.list() });
  const neoPlugin = (pluginsQuery.data ?? []).find(
    (p: { pluginKey: string }) => p.pluginKey === "neocompany-tools",
  );
  const pluginId = neoPlugin?.id;

  const postsQuery = useQuery({
    queryKey: ["social-posts-calendar", selectedCompanyId],
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
    refetchOnWindowFocus: false,
  });

  const imagesQuery = useQuery({
    queryKey: ["calendar-library", selectedCompanyId],
    queryFn: async (): Promise<LibraryImage[]> => {
      if (!pluginId || !selectedCompanyId) return [];
      const res = await pluginsApi.bridgeGetData(
        pluginId,
        "imageList",
        { companyId: selectedCompanyId, limit: 500, includeImages: true },
        selectedCompanyId,
      );
      return (res as { data: { images: LibraryImage[] } }).data?.images ?? [];
    },
    enabled: !!pluginId && !!selectedCompanyId,
    refetchOnWindowFocus: false,
  });

  const imageById = useMemo(() => {
    const map = new Map<string, LibraryImage>();
    for (const img of imagesQuery.data ?? []) map.set(img.id, img);
    return map;
  }, [imagesQuery.data]);

  const gridDates = useMemo(() => monthGridDates(cursor), [cursor]);

  const postsByDay = useMemo(() => {
    const map = new Map<string, SocialPost[]>();
    for (const post of postsQuery.data ?? []) {
      const when = post.publishedAt ?? post.scheduledAt ?? post.proposedAt;
      if (!when) continue;
      if (post.status === "rejected" || post.status === "pending_review" || post.status === "draft") continue;
      const d = new Date(when);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const list = map.get(key) ?? [];
      list.push(post);
      map.set(key, list);
    }
    return map;
  }, [postsQuery.data]);

  const today = new Date();
  const monthLabel = formatMonthLabel(cursor);

  if (pluginsQuery.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!neoPlugin) {
    return (
      <div className="max-w-3xl p-6">
        <p className="text-muted-foreground">Install <strong>neocompany-tools</strong> to use the calendar.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Calendar</h1>
          <p className="text-sm text-muted-foreground">
            Scheduled &amp; published social posts. Click a post to see details.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => setCursor((d) => addMonths(d, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="w-40 text-center text-sm font-medium capitalize">{monthLabel}</div>
          <Button size="sm" variant="outline" onClick={() => setCursor((d) => addMonths(d, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCursor(startOfMonth(new Date()))}>
            Today
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {DAY_LABELS_SHORT.map((d) => (
          <div key={d} className="px-2 py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px rounded-xl border border-border bg-border overflow-hidden">
        {gridDates.map((d, idx) => {
          const isToday = sameDay(d, today);
          const outOfMonth = d.getMonth() !== cursor.getMonth();
          const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
          const posts = postsByDay.get(key) ?? [];
          return (
            <div
              key={idx}
              className={`min-h-[96px] bg-card p-1.5 ${outOfMonth ? "opacity-50" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-[11px] tabular-nums ${
                    isToday ? "rounded-full bg-primary px-1.5 py-0.5 text-primary-foreground font-semibold" : "text-muted-foreground"
                  }`}
                >
                  {d.getDate()}
                </span>
              </div>
              <div className="mt-1 space-y-1">
                {posts.slice(0, 3).map((p) => (
                  <PostPill key={p.id} post={p} image={p.imageId ? imageById.get(p.imageId) : undefined} />
                ))}
                {posts.length > 3 && (
                  <div className="text-[10px] text-muted-foreground">+{posts.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Legend />
    </div>
  );
}

function PostPill({ post, image }: { post: SocialPost; image?: LibraryImage }) {
  const Icon = PROVIDER_ICON[post.channel.provider];
  const color = STATUS_COLOR[post.status];
  const label = post.text.length > 0 ? post.text : "(empty)";
  const title = `${post.status}${post.lastError ? ` · ${post.lastError}` : ""}\n${label}`;
  return (
    <div className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] ${color}`} title={title}>
      {image?.finalImageUrl ? (
        <img src={image.finalImageUrl} alt="" className="h-3 w-3 rounded-sm object-cover shrink-0" />
      ) : null}
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </div>
  );
}

function Legend() {
  const items: { status: Status; label: string }[] = [
    { status: "scheduled", label: "Scheduled" },
    { status: "publishing", label: "Publishing" },
    { status: "published", label: "Published" },
    { status: "failed", label: "Failed" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      {items.map((it) => (
        <div key={it.status} className="flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 rounded-sm ${STATUS_COLOR[it.status]}`} />
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}
