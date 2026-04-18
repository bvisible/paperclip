import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Image as ImageIcon, Loader2, Plus, Sparkles, X, Trash2 } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pluginsApi } from "@/api/plugins";

interface GeneratedImage {
  id: string;
  prompt: string;
  provider: "openai" | "gemini";
  rawImageUrl?: string;
  finalImageUrl?: string;
  templateId?: string;
  width: number;
  height: number;
  status: "pending" | "approved" | "rejected";
  batchId?: string;
  feedback?: string;
  createdAt: string;
}

type StatusFilter = "all" | "pending" | "approved" | "rejected";

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved (stock)" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

export function ContentStock() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<StatusFilter>("pending");
  const [showGenerate, setShowGenerate] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Content" }, { label: "Stock" }]);
  }, [setBreadcrumbs]);

  const pluginsQuery = useQuery({
    queryKey: ["plugins"],
    queryFn: () => pluginsApi.list(),
  });
  const neoPlugin = (pluginsQuery.data ?? []).find(
    (p: { pluginKey: string }) => p.pluginKey === "neocompany-tools",
  );
  const pluginId = neoPlugin?.id;

  const imagesQuery = useQuery({
    queryKey: ["generated-images", selectedCompanyId],
    queryFn: async (): Promise<GeneratedImage[]> => {
      if (!pluginId || !selectedCompanyId) return [];
      const res = await pluginsApi.bridgeGetData(
        pluginId, "imageList",
        { companyId: selectedCompanyId, limit: 200, includeImages: true },
        selectedCompanyId,
      );
      return (res as { data: { images: GeneratedImage[] } }).data?.images ?? [];
    },
    enabled: !!pluginId && !!selectedCompanyId,
    refetchOnWindowFocus: false,
  });

  const approveMut = useMutation({
    mutationFn: async ({ imageId, status, feedback }: { imageId: string; status: "approved" | "rejected" | "pending"; feedback?: string }) => {
      if (!pluginId || !selectedCompanyId) throw new Error("Plugin not available");
      return pluginsApi.bridgePerformAction(pluginId, "imageApprove", {
        companyId: selectedCompanyId, imageId, status, feedback,
      }, selectedCompanyId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["generated-images", selectedCompanyId] });
    },
    onError: (err) => pushToast({ title: `Update failed: ${(err as Error).message}`, tone: "error" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (imageId: string) => {
      if (!pluginId || !selectedCompanyId) throw new Error("Plugin not available");
      return pluginsApi.bridgePerformAction(pluginId, "imageDelete", {
        companyId: selectedCompanyId, imageId,
      }, selectedCompanyId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["generated-images", selectedCompanyId] });
      pushToast({ title: "Image deleted", tone: "success" });
    },
    onError: (err) => pushToast({ title: `Delete failed: ${(err as Error).message}`, tone: "error" }),
  });

  const filtered = (imagesQuery.data ?? []).filter((img) => tab === "all" || img.status === tab);
  const counts = {
    pending: (imagesQuery.data ?? []).filter((i) => i.status === "pending").length,
    approved: (imagesQuery.data ?? []).filter((i) => i.status === "approved").length,
    rejected: (imagesQuery.data ?? []).filter((i) => i.status === "rejected").length,
  };

  if (pluginsQuery.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!neoPlugin) {
    return (
      <div className="max-w-3xl p-6">
        <p className="text-muted-foreground">Install the <strong>neocompany-tools</strong> plugin to use the image stock.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">Image Stock</h1>
          <p className="text-sm text-muted-foreground">
            AI-generated images with optional template overlay. Approve them to enter the publishing pool.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowGenerate(true)}>
          <Sparkles className="mr-1 h-4 w-4" />
          Generate image
        </Button>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm border-b-2 transition-colors -mb-px ${
              tab === t.key
                ? "border-primary text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {t.key !== "all" && (
              <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
                {counts[t.key as "pending" | "approved" | "rejected"]}
              </span>
            )}
          </button>
        ))}
      </div>

      {showGenerate && (
        <GenerateDialog
          companyId={selectedCompanyId ?? undefined}
          pluginId={pluginId}
          onClose={() => setShowGenerate(false)}
          onSuccess={() => {
            setShowGenerate(false);
            qc.invalidateQueries({ queryKey: ["generated-images", selectedCompanyId] });
            setTab("pending");
          }}
        />
      )}

      {imagesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading images…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-muted-foreground mb-3">
            {tab === "pending"
              ? "No pending images. Generate one to get started."
              : tab === "approved"
              ? "No approved images yet. Approve pending ones first."
              : tab === "rejected"
              ? "Nothing rejected here."
              : "No images yet."}
          </p>
          {tab === "pending" && (
            <Button size="sm" onClick={() => setShowGenerate(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Generate first image
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((img) => (
            <ImageCard
              key={img.id}
              img={img}
              onApprove={() => approveMut.mutate({ imageId: img.id, status: "approved" })}
              onReject={() => approveMut.mutate({ imageId: img.id, status: "rejected" })}
              onRestore={() => approveMut.mutate({ imageId: img.id, status: "pending" })}
              onDelete={() => {
                if (globalThis.confirm("Delete this image permanently?")) {
                  deleteMut.mutate(img.id);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image card
// ---------------------------------------------------------------------------

function ImageCard({
  img,
  onApprove,
  onReject,
  onRestore,
  onDelete,
}: {
  img: GeneratedImage;
  onApprove: () => void;
  onReject: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden group">
      <div className="relative aspect-square bg-muted">
        {img.finalImageUrl ? (
          <img
            src={img.finalImageUrl}
            alt={img.prompt}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-8 w-8 opacity-40" />
          </div>
        )}
        <div className="absolute top-2 right-2">
          <StatusPill status={img.status} />
        </div>
      </div>

      <div className="p-3 space-y-2 border-t border-border">
        <p className="text-xs text-foreground line-clamp-2" title={img.prompt}>
          {img.prompt}
        </p>
        <p className="text-[10px] text-muted-foreground tabular-nums">
          {img.width} × {img.height} · {img.provider} · {new Date(img.createdAt).toLocaleDateString()}
        </p>

        <div className="flex gap-1.5">
          {img.status === "pending" && (
            <>
              <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={onApprove}>
                <Check className="mr-1 h-3 w-3" /> Approve
              </Button>
              <Button size="sm" variant="outline" className="flex-1 h-7 text-xs text-destructive" onClick={onReject}>
                <X className="mr-1 h-3 w-3" /> Reject
              </Button>
            </>
          )}
          {img.status === "approved" && (
            <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={onRestore}>
              Return to pending
            </Button>
          )}
          {img.status === "rejected" && (
            <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={onRestore}>
              Re-review
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-destructive hover:text-destructive shrink-0"
            onClick={onDelete}
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: "pending" | "approved" | "rejected" }) {
  const styles =
    status === "approved"
      ? "bg-emerald-500/90 text-white"
      : status === "rejected"
      ? "bg-red-500/90 text-white"
      : "bg-amber-500/90 text-white";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${styles}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Generate dialog
// ---------------------------------------------------------------------------

interface GenerateDialogProps {
  companyId: string | undefined;
  pluginId: string | undefined;
  onClose: () => void;
  onSuccess: () => void;
}

function GenerateDialog({ companyId, pluginId, onClose, onSuccess }: GenerateDialogProps) {
  const { pushToast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [provider, setProvider] = useState<"openai" | "codex-cli">("codex-cli");
  const [count, setCount] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const templatesQuery = useQuery({
    queryKey: ["content-templates", companyId],
    queryFn: async () => {
      if (!pluginId || !companyId) return { templates: [] };
      const res = await pluginsApi.bridgeGetData(
        pluginId, "templateList", { companyId }, companyId,
      );
      return (res as { data: { templates: Array<{ id: string; name: string; width: number; height: number }> } }).data ?? { templates: [] };
    },
    enabled: !!pluginId && !!companyId,
  });

  const onGenerate = useCallback(async () => {
    if (!pluginId || !companyId || !prompt.trim()) return;
    setIsGenerating(true);
    setProgress({ done: 0, total: count });
    const batchId = count > 1 ? globalThis.crypto.randomUUID() : undefined;
    let failures = 0;

    for (let i = 0; i < count; i++) {
      try {
        await pluginsApi.bridgePerformAction(pluginId, "imageGenerate", {
          companyId,
          prompt,
          templateId: templateId || undefined,
          provider,
          batchId,
        }, companyId);
      } catch (err) {
        failures++;
        // eslint-disable-next-line no-console
        console.error(`Image ${i + 1} failed:`, err);
      }
      setProgress({ done: i + 1, total: count });
    }

    setIsGenerating(false);
    setProgress(null);
    if (failures === count) {
      pushToast({ title: "All generations failed", tone: "error" });
      return;
    }
    if (failures > 0) {
      pushToast({ title: `Generated ${count - failures}/${count} (some failed)`, tone: "info" });
    } else {
      pushToast({ title: `Generated ${count} image(s)`, tone: "success" });
    }
    onSuccess();
  }, [pluginId, companyId, prompt, templateId, count, pushToast, onSuccess]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold">Generate image</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {provider === "codex-cli"
            ? "Via ChatGPT Pro subscription (Codex CLI, gpt-image-1.5). No API key needed."
            : "Via OpenAI API key (gpt-image-1). Billed per image."}
          {" "}A brand template is composited on top if selected.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <Label className="text-xs">Prompt</Label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              autoFocus
              placeholder="e.g. modern tech startup office, warm natural light, clean minimalist aesthetic"
              className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
            />
          </div>

          <div>
            <Label className="text-xs">Provider</Label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as "openai" | "codex-cli")}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              <option value="codex-cli">Codex CLI (ChatGPT Pro subscription)</option>
              <option value="openai">OpenAI API (gpt-image-1)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Brand template</Label>
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                <option value="">No template (raw image)</option>
                {(templatesQuery.data?.templates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.width}×{t.height})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label className="text-xs">Count</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                className="mt-1"
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          {isGenerating && progress && (
            <span className="text-xs text-muted-foreground mr-auto flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              {progress.done}/{progress.total}…
            </span>
          )}
          <Button variant="outline" size="sm" onClick={onClose} disabled={isGenerating}>
            Cancel
          </Button>
          <Button size="sm" onClick={onGenerate} disabled={!prompt.trim() || isGenerating}>
            {isGenerating ? "Generating…" : `Generate ${count > 1 ? count : ""}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
