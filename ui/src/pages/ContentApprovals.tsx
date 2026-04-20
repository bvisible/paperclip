import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, Linkedin, Facebook, Instagram, Sparkles, Loader2, Zap } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
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
  dimensions?: { width: number; height: number };
  channel: { provider: ProviderKey; channelKey: string };
  proposedAt: string;
  scheduledAt?: string;
  status: Status;
  rejectionFeedback?: string;
  createdAt: string;
}

interface ChannelRecord {
  provider: ProviderKey;
  accountId: string;
  accountName: string;
}

interface LibraryImage {
  id: string;
  prompt: string;
  finalImageUrl?: string;
  source?: "generated" | "upload";
  status: "pending" | "approved" | "rejected";
  width: number;
  height: number;
}

const PROVIDER_ICON: Record<ProviderKey, React.ComponentType<{ className?: string }>> = {
  linkedin: Linkedin,
  facebook: Facebook,
  instagram: Instagram,
};
const PROVIDER_ACCENT: Record<ProviderKey, string> = {
  linkedin: "text-[#0A66C2]",
  facebook: "text-[#1877F2]",
  instagram: "text-[#E4405F]",
};

export function ContentApprovals() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Content" }, { label: "Approvals" }]);
  }, [setBreadcrumbs]);

  const pluginsQuery = useQuery({ queryKey: ["plugins"], queryFn: () => pluginsApi.list() });
  const neoPlugin = (pluginsQuery.data ?? []).find(
    (p: { pluginKey: string }) => p.pluginKey === "neocompany-tools",
  );
  const pluginId = neoPlugin?.id;

  const postsQuery = useQuery({
    queryKey: ["social-posts-pending", selectedCompanyId],
    queryFn: async (): Promise<SocialPost[]> => {
      if (!pluginId || !selectedCompanyId) return [];
      const res = await pluginsApi.bridgeGetData(
        pluginId,
        "socialPostsList",
        { companyId: selectedCompanyId, status: "pending_review" },
        selectedCompanyId,
      );
      return (res as { data: { posts: SocialPost[] } }).data?.posts ?? [];
    },
    enabled: !!pluginId && !!selectedCompanyId,
    refetchOnWindowFocus: false,
  });

  const channelsQuery = useQuery({
    queryKey: ["social-channels", selectedCompanyId],
    queryFn: async (): Promise<ChannelRecord[]> => {
      if (!pluginId || !selectedCompanyId) return [];
      const res = await pluginsApi.bridgeGetData(
        pluginId,
        "channelsList",
        { companyId: selectedCompanyId },
        selectedCompanyId,
      );
      return (res as { data: { channels: ChannelRecord[] } }).data?.channels ?? [];
    },
    enabled: !!pluginId && !!selectedCompanyId,
    refetchOnWindowFocus: false,
  });

  const imagesQuery = useQuery({
    queryKey: ["approved-library", selectedCompanyId],
    queryFn: async (): Promise<LibraryImage[]> => {
      if (!pluginId || !selectedCompanyId) return [];
      const res = await pluginsApi.bridgeGetData(
        pluginId,
        "imageList",
        { companyId: selectedCompanyId, status: "approved", limit: 50 },
        selectedCompanyId,
      );
      return (res as { data: { images: LibraryImage[] } }).data?.images ?? [];
    },
    enabled: !!pluginId && !!selectedCompanyId,
    refetchOnWindowFocus: false,
  });

  const approveMut = useMutation({
    mutationFn: async (postId: string) => {
      if (!pluginId || !selectedCompanyId) throw new Error("Plugin not available");
      return pluginsApi.bridgePerformAction(
        pluginId,
        "approveDraftPost",
        { companyId: selectedCompanyId, postId },
        selectedCompanyId,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social-posts-pending", selectedCompanyId] });
      qc.invalidateQueries({ queryKey: ["social-posts-calendar", selectedCompanyId] });
      pushToast({ title: "Post scheduled", tone: "success" });
    },
    onError: (err) => pushToast({ title: `Approve failed: ${(err as Error).message}`, tone: "error" }),
  });

  const rejectMut = useMutation({
    mutationFn: async ({ postId, feedback }: { postId: string; feedback?: string }) => {
      if (!pluginId || !selectedCompanyId) throw new Error("Plugin not available");
      return pluginsApi.bridgePerformAction(
        pluginId,
        "rejectDraftPost",
        { companyId: selectedCompanyId, postId, feedback },
        selectedCompanyId,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social-posts-pending", selectedCompanyId] });
      pushToast({ title: "Post rejected", tone: "info" });
    },
    onError: (err) => pushToast({ title: `Reject failed: ${(err as Error).message}`, tone: "error" }),
  });

  // Quick manual batch generation — creates N pending_review posts using the
  // first connected channel and an approved library image, with a placeholder
  // caption. This is a bridge until Pixel's autopilot cron is wired to the
  // claimed-api-key flow.
  const generateBatchMut = useMutation({
    mutationFn: async () => {
      if (!pluginId || !selectedCompanyId) throw new Error("Plugin not available");
      const channels = channelsQuery.data ?? [];
      const images = imagesQuery.data ?? [];
      if (channels.length === 0) throw new Error("No connected channels — set up Channels first");
      if (images.length === 0) throw new Error("No approved library images — upload or generate some first");
      const channel = channels[0]!;
      const n = Math.min(3, images.length);
      setGenerating(true);
      for (let i = 0; i < n; i++) {
        const img = images[i]!;
        const proposedAt = new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000).toISOString();
        await pluginsApi.bridgePerformAction(
          pluginId,
          "draftCreate",
          {
            companyId: selectedCompanyId,
            text:
              img.prompt && img.prompt.length > 0
                ? img.prompt.slice(0, 180)
                : "Pixel prepared this draft. Edit before approving.",
            imageId: img.id,
            dimensions: { width: img.width, height: img.height },
            channel: { provider: channel.provider, channelKey: `${channel.provider}:${channel.accountId}` },
            proposedAt,
          },
          selectedCompanyId,
        );
      }
    },
    onSuccess: () => {
      setGenerating(false);
      qc.invalidateQueries({ queryKey: ["social-posts-pending", selectedCompanyId] });
      pushToast({ title: "Drafts generated", tone: "success" });
    },
    onError: (err) => {
      setGenerating(false);
      pushToast({ title: `Generate failed: ${(err as Error).message}`, tone: "error" });
    },
  });

  const autopilotMut = useMutation({
    mutationFn: async () => {
      if (!pluginId || !selectedCompanyId) throw new Error("Plugin not available");
      return pluginsApi.bridgePerformAction(
        pluginId,
        "runPixelAutopilotNow",
        { companyId: selectedCompanyId },
        selectedCompanyId,
      );
    },
    onSuccess: (res) => {
      const report = (res as { data?: { planned: number; created: number; skipped: number } }).data;
      qc.invalidateQueries({ queryKey: ["social-posts-pending", selectedCompanyId] });
      if (report) {
        pushToast({
          title: `Autopilot: ${report.created} created · ${report.skipped} skipped`,
          tone: report.created > 0 ? "success" : "info",
        });
      }
    },
    onError: (err) => pushToast({ title: `Autopilot failed: ${(err as Error).message}`, tone: "error" }),
  });

  const posts = postsQuery.data ?? [];

  const imageById = useMemo(() => {
    const map = new Map<string, LibraryImage>();
    for (const img of imagesQuery.data ?? []) map.set(img.id, img);
    return map;
  }, [imagesQuery.data]);

  if (pluginsQuery.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!neoPlugin) {
    return (
      <div className="max-w-3xl p-6">
        <p className="text-muted-foreground">Install <strong>neocompany-tools</strong> to use approvals.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">Post approvals</h1>
          <p className="text-sm text-muted-foreground">
            Pixel prepares posts in advance. Approve to schedule, reject to drop.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => autopilotMut.mutate()}
            disabled={autopilotMut.isPending}
            title="Run Pixel autopilot now — generates drafts based on the editorial strategy"
          >
            {autopilotMut.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Zap className="mr-1 h-4 w-4" />
            )}
            Run autopilot
          </Button>
          <Button
            size="sm"
            onClick={() => generateBatchMut.mutate()}
            disabled={generating || generateBatchMut.isPending}
          >
            {generating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
            Generate 3 drafts
          </Button>
        </div>
      </div>

      {posts.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No drafts awaiting approval. Generate a batch or wait for Pixel's next autopilot run.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              image={p.imageId ? imageById.get(p.imageId) : undefined}
              onApprove={() => approveMut.mutate(p.id)}
              onReject={() => {
                const feedback = globalThis.prompt("Reason for rejecting this post? (optional)") ?? undefined;
                rejectMut.mutate({ postId: p.id, feedback });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PostCard({
  post,
  image,
  onApprove,
  onReject,
}: {
  post: SocialPost;
  image?: LibraryImage;
  onApprove: () => void;
  onReject: () => void;
}) {
  const Icon = PROVIDER_ICON[post.channel.provider];
  const accent = PROVIDER_ACCENT[post.channel.provider];
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="relative aspect-square bg-muted">
        {image?.finalImageUrl ? (
          <img src={image.finalImageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground text-xs">
            No image
          </div>
        )}
        <div className="absolute top-2 left-2 rounded-full bg-white/90 p-1.5">
          <Icon className={`h-3.5 w-3.5 ${accent}`} />
        </div>
      </div>
      <div className="p-3 space-y-2 border-t border-border">
        <p className="text-xs text-foreground line-clamp-3">{post.text || "(empty caption)"}</p>
        <p className="text-[10px] text-muted-foreground tabular-nums">
          {new Date(post.proposedAt).toLocaleString()}
        </p>
        <div className="flex gap-1.5 pt-1">
          <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={onApprove}>
            <Check className="mr-1 h-3 w-3" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-7 text-xs text-destructive"
            onClick={onReject}
          >
            <X className="mr-1 h-3 w-3" />
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}
