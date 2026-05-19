//// Neocompany Modification — pure addition (Neocompany fork on top of paperclipai/paperclip)
//// This file does not exist upstream. Safe across upstream merges.

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
  //// Neocompany Modification — references attached at generation time.
  //// Surfaced in the "Image details" drawer so the operator can trace
  //// where a generated image came from.
  referenceImageIds?: string[];
  referenceImageUrls?: string[];
  //// End Neocompany Modification
}

type StatusFilter = "all" | "pending" | "approved" | "rejected";
type SourceFilter = "all" | "generated" | "upload";

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved (stock)" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

//// Neocompany Modification — renamed to French labels matching how the
//// user talks about the library: "matière brute" (uploads, used as
//// reference material for AI) vs "générées" (AI outputs awaiting review
//// or already approved for posting). The internal filter values stay as
//// English keys so the worker filter contract is unchanged.
const SOURCE_TABS: Array<{ key: SourceFilter; label: string }> = [
  { key: "upload", label: "Matière brute" },
  { key: "generated", label: "Générées" },
  { key: "all", label: "Tout" },
];
//// End Neocompany Modification

export function ContentStock() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const qc = useQueryClient();
  const [statusTab, setStatusTab] = useState<StatusFilter>("all");
  const [sourceTab, setSourceTab] = useState<SourceFilter>("all");
  const [showGenerate, setShowGenerate] = useState(false);
  //// Neocompany Modification — when the user clicks "Utiliser comme
  //// référence" on a raw upload card, we open the Generate dialog with
  //// that image's id already in the picker so they only have to write a
  //// prompt. Multiple refs can be selected from within the dialog.
  const [pendingRefIds, setPendingRefIds] = useState<string[]>([]);
  //// "Image details" drawer for a generated image — shows its refs +
  //// prompt + provider + template. Clicked from the card itself.
  const [detailsImage, setDetailsImage] = useState<(GeneratedImage & { source: ImageSource }) | null>(null);
  //// Catalog product pre-fill — when the user lands on this page with a
  //// `?productId=wc-123` query param (typically clicked "Générer" on a
  //// product card in /content/catalog), auto-open the Generate dialog
  //// with that product selected.
  const [pendingProductId, setPendingProductId] = useState<string>("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pid = params.get("productId");
    if (pid) {
      setPendingProductId(pid);
      setShowGenerate(true);
      // Clean up the URL so a reload doesn't keep reopening the dialog.
      params.delete("productId");
      const cleaned = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}${window.location.hash}`;
      window.history.replaceState(null, "", cleaned);
    }
  }, []);
  //// End Neocompany Modification
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
          //// Neocompany Modification — pre-fill the picker when the user
          //// arrived via "Utiliser comme référence" on a card.
          initialReferenceIds={pendingRefIds}
          //// Pre-select a catalog product when arrived via /content/catalog
          //// "Générer" button (?productId=…).
          initialProductId={pendingProductId || undefined}
          //// End Neocompany Modification
          libraryUploads={normalized.filter((i) => i.source === "upload" && i.status === "approved")}
          onClose={() => {
            setShowGenerate(false);
            setPendingRefIds([]);
            setPendingProductId("");
          }}
          onSuccess={() => {
            setShowGenerate(false);
            setPendingRefIds([]);
            setPendingProductId("");
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
              //// Neocompany Modification — raw uploads can be used as a
              //// reference for a new AI generation. Clicking opens the
              //// Generate dialog with this image's id pre-selected.
              onUseAsReference={
                img.source === "upload" && img.status === "approved"
                  ? () => {
                      setPendingRefIds([img.id]);
                      setShowGenerate(true);
                    }
                  : undefined
              }
              onOpenDetails={
                img.source === "generated"
                  ? () => setDetailsImage(img)
                  : undefined
              }
              //// End Neocompany Modification
            />
          ))}
        </div>
      )}

      {/* //// Neocompany Modification — Image details drawer. */}
      {detailsImage && (
        <ImageDetailsDrawer
          image={detailsImage}
          allImages={normalized}
          onClose={() => setDetailsImage(null)}
          onReuseSetup={(image) => {
            setDetailsImage(null);
            setPendingRefIds(image.referenceImageIds ?? []);
            setShowGenerate(true);
          }}
        />
      )}
      {/* //// End Neocompany Modification */}
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
  onUseAsReference,
  onOpenDetails,
}: {
  img: GeneratedImage & { source: ImageSource };
  onApprove: () => void;
  onReject: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onUseAsReference?: () => void;
  onOpenDetails?: () => void;
}) {
  const caption =
    img.source === "upload"
      ? "Uploaded image"
      : img.prompt || "Generated image";
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden group">
      <div
        className={`relative aspect-square bg-muted ${onOpenDetails ? "cursor-pointer" : ""}`}
        onClick={onOpenDetails}
        title={onOpenDetails ? "Voir les détails (références utilisées)" : undefined}
      >
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
        {/* //// Neocompany Modification — small badge "N refs" when a
           generated image was conditioned on visual references. */}
        {(img.referenceImageIds?.length ?? 0) + (img.referenceImageUrls?.length ?? 0) > 0 && (
          <div className="absolute bottom-2 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] text-white font-medium">
            {(img.referenceImageIds?.length ?? 0) + (img.referenceImageUrls?.length ?? 0)} ref
            {(img.referenceImageIds?.length ?? 0) + (img.referenceImageUrls?.length ?? 0) > 1 ? "s" : ""}
          </div>
        )}
        {/* //// End Neocompany Modification */}
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
          {/* //// Neocompany Modification — primary action for raw uploads
             is "Use as reference", which feeds it back into a new
             generation. The rest of the approval/delete CTAs stay below
             but in compact form so the card doesn't get noisy. */}
          {onUseAsReference && (
            <Button size="sm" className="flex-1 h-7 text-xs" onClick={onUseAsReference}>
              <Sparkles className="mr-1 h-3 w-3" /> Utiliser comme référence
            </Button>
          )}
          {/* //// End Neocompany Modification */}
          {!onUseAsReference && img.status === "pending" && (
            <>
              <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={onApprove}>
                <Check className="mr-1 h-3 w-3" /> Approve
              </Button>
              <Button size="sm" variant="outline" className="flex-1 h-7 text-xs text-destructive" onClick={onReject}>
                <X className="mr-1 h-3 w-3" /> Reject
              </Button>
            </>
          )}
          {!onUseAsReference && img.status === "approved" && (
            <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={onRestore}>
              Return to pending
            </Button>
          )}
          {!onUseAsReference && img.status === "rejected" && (
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
  //// Neocompany Modification — pre-fill the reference picker when the
  //// user arrived via "Utiliser comme référence" on a card. Empty means
  //// they opened the dialog from the toolbar Generate button.
  initialReferenceIds?: string[];
  //// libraryUploads: pool of approved raw uploads usable as refs. We
  //// pass it down from the parent (already in state) instead of re-
  //// fetching, so the picker UI is instant.
  libraryUploads: Array<GeneratedImage & { source: ImageSource }>;
  //// initialProductId: optional catalog product the user arrived with
  //// (e.g. clicked "Générer" on a product card in /content/catalog).
  initialProductId?: string;
  //// End Neocompany Modification
}

//// Neocompany Modification — catalog product picker payload.
interface CatalogProductSummary {
  id: string;
  wcId: number;
  name: string;
  price?: string;
  currency?: string;
  imageCount: number;
  status: string;
}
//// End Neocompany Modification

function GenerateDialog({
  companyId, pluginId, onClose, onSuccess, initialReferenceIds, libraryUploads, initialProductId,
}: GenerateDialogProps) {
  const { pushToast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [provider, setProvider] = useState<"openai" | "codex-cli">("codex-cli");
  const [count, setCount] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  //// Neocompany Modification — reference picker state.
  const [refIds, setRefIds] = useState<string[]>(initialReferenceIds ?? []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const MAX_REFS = 5;
  //// Catalog product picker — when set, the worker grounds the prompt in
  //// the product name + short description. The gallery imageUrls are also
  //// surfaced in the "Images de référence" zone (productRefUrls below) so
  //// the user sees what will feed the generation.
  const [productId, setProductId] = useState<string>(initialProductId ?? "");
  //// productRefUrls — gallery image URLs of the selected catalog product,
  //// surfaced as thumbnails in the refs zone. Distinct from refIds (library
  //// uploads). Cap is shared: refIds.length + productRefUrls.length ≤ MAX_REFS.
  const [productRefUrls, setProductRefUrls] = useState<string[]>([]);
  //// End Neocompany Modification

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

  //// Neocompany Modification — Catalog product list for the picker.
  //// We pull only the lightweight summary fields (name, price, image
  //// count) so the dropdown stays cheap even with a few hundred SKUs.
  const productsQuery = useQuery({
    queryKey: ["wc-catalog-products-picker", companyId],
    queryFn: async () => {
      if (!pluginId || !companyId) return { products: [] as CatalogProductSummary[] };
      const res = await pluginsApi.bridgeGetData(
        pluginId, "productsList",
        { companyId, limit: 500, status: "publish" },
        companyId,
      );
      return (res as { data: { products: CatalogProductSummary[] } }).data ?? { products: [] };
    },
    enabled: !!pluginId && !!companyId,
  });
  const selectedProduct = (productsQuery.data?.products ?? []).find((p) => p.id === productId);

  //// productGet — when a product is selected, fetch its full data so we
  //// can materialise its gallery imageUrls as thumbnails in the refs zone.
  //// productsList only returns the first image (thumbnailUrl) + count, not
  //// the full gallery.
  useEffect(() => {
    if (!productId || !pluginId || !companyId) {
      setProductRefUrls([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await pluginsApi.bridgeGetData(
          pluginId, "productGet", { companyId, productId }, companyId,
        );
        const data = (res as { data?: { imageUrls?: string[] } }).data;
        const urls = Array.isArray(data?.imageUrls) ? data!.imageUrls! : [];
        if (!cancelled) {
          // Cap to MAX_REFS minus the manually-picked refs so the picker stays usable.
          const budget = Math.max(0, MAX_REFS - refIds.length);
          setProductRefUrls(urls.slice(0, budget));
        }
      } catch {
        if (!cancelled) setProductRefUrls([]);
      }
    })();
    return () => { cancelled = true; };
  // refIds intentionally excluded — we only re-fetch on productId change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, pluginId, companyId]);
  //// End Neocompany Modification

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
          //// Neocompany Modification — forward selected references so the
          //// codex-cli path attaches them via `-i`.
          referenceImageIds: refIds.length > 0 ? refIds : undefined,
          //// referenceImageUrls — gallery images of the catalog product
          //// the user explicitly sees in the refs zone. Sent verbatim so
          //// the worker doesn't need to re-resolve them.
          referenceImageUrls: productRefUrls.length > 0 ? productRefUrls : undefined,
          //// productId — worker grounds the prompt (prefix with product
          //// name + short description). The worker still passes any extra
          //// gallery images not already provided, but UI typically sends
          //// them so the user sees what conditions the generation.
          productId: productId || undefined,
          //// End Neocompany Modification
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
  }, [pluginId, companyId, prompt, templateId, provider, count, refIds, productRefUrls, productId, pushToast, onSuccess]);

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

          {/* //// Neocompany Modification — Catalog product picker.
             When set, the worker prefixes the prompt with the product
             name + short description and auto-attaches the product's
             gallery images as refs. The picker lists the synced catalog
             from /content/catalog (productsList data handler). */}
          {(productsQuery.data?.products?.length ?? 0) > 0 && (
            <div>
              <Label className="text-xs">Produit du catalogue</Label>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                <option value="">Aucun (génération libre)</option>
                {(productsQuery.data?.products ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.price ? ` · ${p.price} ${p.currency ?? ""}` : ""}
                  </option>
                ))}
              </select>
              {selectedProduct && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  📦 {productRefUrls.length}/{selectedProduct.imageCount} image{selectedProduct.imageCount > 1 ? "s" : ""} du produit affichée{productRefUrls.length > 1 ? "s" : ""} ci-dessous. Le prompt sera prefixé avec le nom et la description du produit.
                </p>
              )}
            </div>
          )}
          {/* //// End Neocompany Modification */}

          {/* //// Neocompany Modification — Reference picker.
             Visual references the generator should base its output on
             (Codex CLI `-i` flag). Max 5 to avoid the "too many refs =
             noisy result" trap we saw on the Reed-Blake pipeline. Only
             the codex-cli provider currently consumes them; OpenAI path
             ignores them silently (warns in server logs). */}
          <div>
            {(() => {
              const totalRefCount = refIds.length + productRefUrls.length;
              return (
                <>
                  <Label className="text-xs flex items-center justify-between">
                    <span>Images de référence ({totalRefCount}/{MAX_REFS})</span>
                    {provider === "openai" && totalRefCount > 0 && (
                      <span className="text-[10px] text-amber-600 font-normal">
                        Ignorées avec OpenAI — passe en Codex CLI
                      </span>
                    )}
                  </Label>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {/* //// Neocompany Modification — Catalog product thumbnails.
                       Surfaced first with a 📦 corner badge so the user can
                       see which gallery images will condition the generation.
                       Removable individually like refIds. */}
                    {productRefUrls.map((url, idx) => (
                      <div
                        key={`prod-${idx}`}
                        className="relative h-14 w-14 rounded-md overflow-hidden border-2 border-primary/50 group/ref"
                        title="Image du produit catalogue"
                      >
                        <img src={url} alt={`product ref ${idx + 1}`} className="h-full w-full object-cover" />
                        <span className="absolute bottom-0 left-0 rounded-tr-md bg-primary/80 text-primary-foreground text-[8px] leading-none px-0.5 py-px">📦</span>
                        <button
                          onClick={() => setProductRefUrls((prev) => prev.filter((_, i) => i !== idx))}
                          className="absolute top-0 right-0 rounded-bl-md bg-black/70 px-1 py-0.5 text-white opacity-0 group-hover/ref:opacity-100 transition-opacity"
                          title="Retirer cette image du produit"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {/* //// End Neocompany Modification */}
                    {refIds.map((id) => {
                      const ref = libraryUploads.find((i) => i.id === id);
                      return (
                        <div key={id} className="relative h-14 w-14 rounded-md overflow-hidden border border-border group/ref">
                          {ref?.finalImageUrl ? (
                            <img src={ref.finalImageUrl} alt="ref" className="h-full w-full object-cover" />
                          ) : (
                            <div className="h-full w-full bg-muted flex items-center justify-center">
                              <ImageIcon className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                          <button
                            onClick={() => setRefIds((prev) => prev.filter((r) => r !== id))}
                            className="absolute top-0 right-0 rounded-bl-md bg-black/70 px-1 py-0.5 text-white opacity-0 group-hover/ref:opacity-100 transition-opacity"
                            title="Retirer"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                    {totalRefCount < MAX_REFS && (
                      <button
                        onClick={() => setPickerOpen(true)}
                        className="h-14 w-14 rounded-md border-2 border-dashed border-border flex items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                        title="Ajouter une référence depuis la Matière brute"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {productRefUrls.length > 0 ? (
                      <>📦 = image du produit · </>
                    ) : null}
                    Pioche dans <b>Matière brute</b> pour conditionner la génération sur des photos existantes.
                  </p>
                </>
              );
            })()}
          </div>
          {/* //// End Neocompany Modification */}

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
      {/* //// Neocompany Modification — sub-modal: pick refs from Matière brute. */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { e.stopPropagation(); setPickerOpen(false); }}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-xl border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h4 className="text-sm font-semibold">Choisir des images de référence</h4>
              <button onClick={() => setPickerOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              {libraryUploads.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Aucune image dans la Matière brute. Upload des photos depuis l'onglet correspondant pour les utiliser ici.
                </p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {libraryUploads.map((img) => {
                    const selected = refIds.includes(img.id);
                    return (
                      <button
                        key={img.id}
                        onClick={() => {
                          if (selected) {
                            setRefIds((prev) => prev.filter((r) => r !== img.id));
                          } else if (refIds.length < MAX_REFS) {
                            setRefIds((prev) => [...prev, img.id]);
                          }
                        }}
                        className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                          selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50"
                        } ${!selected && refIds.length >= MAX_REFS ? "opacity-40 cursor-not-allowed" : ""}`}
                        disabled={!selected && refIds.length >= MAX_REFS}
                      >
                        {img.finalImageUrl ? (
                          <img src={img.finalImageUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full bg-muted flex items-center justify-center">
                            <ImageIcon className="h-6 w-6 text-muted-foreground" />
                          </div>
                        )}
                        {selected && (
                          <div className="absolute top-1 right-1 rounded-full bg-primary text-primary-foreground p-1">
                            <Check className="h-3 w-3" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="border-t border-border px-5 py-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{refIds.length}/{MAX_REFS} sélectionnée(s)</span>
              <Button size="sm" onClick={() => setPickerOpen(false)}>
                Terminer
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* //// End Neocompany Modification */}
    </div>
  );
}

//// Neocompany Modification — Drawer.

// ---------------------------------------------------------------------------
// Image details drawer (Neocompany)
// ---------------------------------------------------------------------------

function ImageDetailsDrawer({
  image,
  allImages,
  onClose,
  onReuseSetup,
}: {
  image: GeneratedImage & { source: ImageSource };
  allImages: Array<GeneratedImage & { source: ImageSource }>;
  onClose: () => void;
  onReuseSetup: (image: GeneratedImage & { source: ImageSource }) => void;
}) {
  const refIds = image.referenceImageIds ?? [];
  const refUrls = image.referenceImageUrls ?? [];
  const refImages = refIds
    .map((id) => allImages.find((i) => i.id === id))
    .filter((i): i is GeneratedImage & { source: ImageSource } => Boolean(i));

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md h-full bg-card border-l border-border shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold">Détails de l'image</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Main image */}
          {image.finalImageUrl && (
            <div className="rounded-lg overflow-hidden border border-border">
              <img src={image.finalImageUrl} alt="" className="w-full h-auto" />
            </div>
          )}

          {/* Refs section */}
          <section>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
              Références utilisées ({refImages.length + refUrls.length})
            </h4>
            {refImages.length === 0 && refUrls.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                Aucune — génération à partir du prompt seul.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {refImages.map((ref) => (
                  <div key={ref.id} className="aspect-square rounded-md overflow-hidden border border-border">
                    <img
                      src={ref.finalImageUrl ?? ref.rawImageUrl ?? ""}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </div>
                ))}
                {refUrls.map((url, idx) => (
                  <div key={`url-${idx}`} className="aspect-square rounded-md overflow-hidden border border-border">
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Prompt */}
          <section>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Prompt</h4>
            <p className="text-sm whitespace-pre-wrap">{image.prompt || <i>—</i>}</p>
          </section>

          {/* Metadata */}
          <section className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground uppercase font-semibold mb-1">Provider</div>
              <div>{image.provider ?? "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground uppercase font-semibold mb-1">Dimensions</div>
              <div className="tabular-nums">{image.width} × {image.height}</div>
            </div>
            <div>
              <div className="text-muted-foreground uppercase font-semibold mb-1">Statut</div>
              <div className="capitalize">{image.status}</div>
            </div>
            <div>
              <div className="text-muted-foreground uppercase font-semibold mb-1">Créée le</div>
              <div>{new Date(image.createdAt).toLocaleString()}</div>
            </div>
            {image.templateId && (
              <div className="col-span-2">
                <div className="text-muted-foreground uppercase font-semibold mb-1">Template appliqué</div>
                <div className="font-mono text-[11px]">{image.templateId}</div>
              </div>
            )}
            {image.batchId && (
              <div className="col-span-2">
                <div className="text-muted-foreground uppercase font-semibold mb-1">Batch</div>
                <div className="font-mono text-[11px]">{image.batchId}</div>
              </div>
            )}
          </section>
        </div>

        <div className="border-t border-border px-5 py-3 flex justify-end">
          <Button size="sm" onClick={() => onReuseSetup(image)}>
            <Sparkles className="mr-1 h-4 w-4" />
            Refaire avec le même setup
          </Button>
        </div>
      </div>
    </div>
  );
}
//// End Neocompany Modification
