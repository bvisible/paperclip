import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Image as ImageIcon, Loader2, Plus, Sparkles, Upload, X, Trash2 } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pluginsApi } from "@/api/plugins";

type ImageSource = "generated" | "upload";

interface GeneratedImage {
  id: string;
  prompt: string;
  provider?: "openai" | "gemini" | "codex-cli";
  source?: ImageSource;
  tags?: string[];
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
type SourceFilter = "all" | "generated" | "upload";

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved (stock)" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

const SOURCE_TABS: Array<{ key: SourceFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "generated", label: "AI generated" },
  { key: "upload", label: "Uploaded" },
];

export function ContentStock() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const qc = useQueryClient();
  const [statusTab, setStatusTab] = useState<StatusFilter>("all");
  const [sourceTab, setSourceTab] = useState<SourceFilter>("all");
  const [showGenerate, setShowGenerate] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Content" }, { label: "Library" }]);
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

  const uploadMut = useMutation({
    mutationFn: async (files: FileList) => {
      if (!pluginId || !selectedCompanyId) throw new Error("Plugin not available");
      let uploaded = 0;
      let failures = 0;
      for (const file of Array.from(files)) {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          const dims = await probeImageDimensions(dataUrl);
          await pluginsApi.bridgePerformAction(pluginId, "libraryUpload", {
            companyId: selectedCompanyId,
            imageDataUrl: dataUrl,
            mimeType: file.type,
            filename: file.name,
            width: dims.width,
            height: dims.height,
            tags: [],
          }, selectedCompanyId);
          uploaded++;
        } catch (err) {
          failures++;
          // eslint-disable-next-line no-console
          console.error(`Upload failed for ${file.name}:`, err);
        }
      }
      return { uploaded, failures };
    },
    onSuccess: ({ uploaded, failures }) => {
      qc.invalidateQueries({ queryKey: ["generated-images", selectedCompanyId] });
      if (failures > 0) {
        pushToast({ title: `Uploaded ${uploaded} (${failures} failed)`, tone: "info" });
      } else {
        pushToast({ title: `Uploaded ${uploaded} image(s)`, tone: "success" });
      }
    },
    onError: (err) => pushToast({ title: `Upload failed: ${(err as Error).message}`, tone: "error" }),
  });

  const triggerUpload = () => uploadInputRef.current?.click();
  const onFilesChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadMut.mutate(e.target.files);
    }
    // Reset so the same file can be re-picked
    if (e.target) e.target.value = "";
  };

  // Normalize source (backfill default "generated" for legacy rows).
  const normalized = (imagesQuery.data ?? []).map((img) => ({
    ...img,
    source: img.source ?? ("generated" as ImageSource),
  }));
  const filtered = normalized.filter((img) => {
    if (statusTab !== "all" && img.status !== statusTab) return false;
    if (sourceTab !== "all" && img.source !== sourceTab) return false;
    return true;
  });
  const statusCounts = {
    pending: normalized.filter((i) => i.status === "pending").length,
    approved: normalized.filter((i) => i.status === "approved").length,
    rejected: normalized.filter((i) => i.status === "rejected").length,
  };
  const sourceCounts = {
    generated: normalized.filter((i) => i.source === "generated").length,
    upload: normalized.filter((i) => i.source === "upload").length,
  };

  if (pluginsQuery.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!neoPlugin) {
    return (
      <div className="max-w-3xl p-6">
        <p className="text-muted-foreground">Install the <strong>neocompany-tools</strong> plugin to use the image library.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">Image Library</h1>
          <p className="text-sm text-muted-foreground">
            Uploaded photos and AI-generated images. Approved items feed the social posts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={triggerUpload} disabled={uploadMut.isPending}>
            {uploadMut.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1 h-4 w-4" />
            )}
            Upload
          </Button>
          <Button size="sm" onClick={() => setShowGenerate(true)}>
            <Sparkles className="mr-1 h-4 w-4" />
            Generate
          </Button>
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onFilesChosen}
          />
        </div>
      </div>

      {/* Source filter pills */}
      <div className="flex items-center gap-1.5">
        {SOURCE_TABS.map((t) => {
          const count =
            t.key === "all"
              ? normalized.length
              : sourceCounts[t.key as "generated" | "upload"];
          const active = sourceTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setSourceTab(t.key)}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {t.label}
              <span className="ml-1.5 tabular-nums opacity-75">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatusTab(t.key)}
            className={`px-3 py-2 text-sm border-b-2 transition-colors -mb-px ${
              statusTab === t.key
                ? "border-primary text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {t.key !== "all" && (
              <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
                {statusCounts[t.key as "pending" | "approved" | "rejected"]}
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
            setStatusTab("pending");
            setSourceTab("generated");
          }}
        />
      )}

      {imagesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading images…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-muted-foreground mb-3">
            No images match this filter. Try another tab or add some.
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button size="sm" variant="outline" onClick={triggerUpload}>
              <Upload className="mr-1 h-4 w-4" /> Upload
            </Button>
            <Button size="sm" onClick={() => setShowGenerate(true)}>
              <Plus className="mr-1 h-4 w-4" /> Generate
            </Button>
          </div>
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
// Helpers
// ---------------------------------------------------------------------------

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

function probeImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
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
  img: GeneratedImage & { source: ImageSource };
  onApprove: () => void;
  onReject: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const caption =
    img.source === "upload"
      ? "Uploaded image"
      : img.prompt || "Generated image";
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden group">
      <div className="relative aspect-square bg-muted">
        {img.finalImageUrl ? (
          <img
            src={img.finalImageUrl}
            alt={caption}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-8 w-8 opacity-40" />
          </div>
        )}
        <div className="absolute top-2 left-2">
          <SourcePill source={img.source} />
        </div>
        <div className="absolute top-2 right-2">
          <StatusPill status={img.status} />
        </div>
      </div>

      <div className="p-3 space-y-2 border-t border-border">
        <p className="text-xs text-foreground line-clamp-2" title={caption}>
          {caption}
        </p>
        <p className="text-[10px] text-muted-foreground tabular-nums">
          {img.width} × {img.height}
          {img.provider ? ` · ${img.provider}` : ""}
          {" · "}
          {new Date(img.createdAt).toLocaleDateString()}
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

function SourcePill({ source }: { source: ImageSource }) {
  const styles =
    source === "upload"
      ? "bg-sky-500/90 text-white"
      : "bg-violet-500/90 text-white";
  const label = source === "upload" ? "Uploaded" : "AI";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${styles}`}>
      {label}
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
  }, [pluginId, companyId, prompt, templateId, provider, count, pushToast, onSuccess]);

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
