//// Neocompany Modification — pure addition (Neocompany fork on top of paperclipai/paperclip)
//// This file does not exist upstream. Safe across upstream merges.

import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Image, Palette } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pluginsApi } from "@/api/plugins";
import { TemplateCanvas } from "@/components/templates/TemplateCanvas";
import type { TemplateConfig } from "@/components/templates/types";

// ---------------------------------------------------------------------------
// Types (mirror plugin data handler shapes)
// ---------------------------------------------------------------------------

interface TemplateView {
  id: string;
  name: string;
  description?: string;
  width: number;
  height: number;
  isDefault: boolean;
  config: Record<string, unknown>;
  createdAt: string;
}

const PRESETS = [
  { key: "instagram-square", label: "Instagram square", w: 1080, h: 1080 },
  { key: "instagram-portrait", label: "Instagram portrait", w: 1080, h: 1350 },
  { key: "instagram-story", label: "Instagram story", w: 1080, h: 1920 },
  { key: "facebook-post", label: "Facebook post", w: 1200, h: 630 },
  { key: "linkedin-post", label: "LinkedIn post", w: 1200, h: 627 },
  { key: "twitter-post", label: "Twitter post", w: 1200, h: 675 },
  { key: "youtube-thumbnail", label: "YouTube thumbnail", w: 1280, h: 720 },
];

const DEFAULT_CONFIG = {
  logo: { position: "bottom-right", scale: 15, opacity: 90 },
  textZones: [],
  filters: { brightness: 0, contrast: 0, saturation: 0, blur: 0 },
  overlay: { color: "#000000", opacity: 0 },
  border: { width: 0, color: "#ffffff", radius: 0 },
  backgroundColor: "#ffffff",
  imageFit: "cover",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ContentTemplates() {
  const navigate = useNavigate();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { pushToast } = useToast();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Content" }, { label: "Templates" }]);
  }, [setBreadcrumbs]);

  // Check if neocompany-tools plugin is installed
  const pluginsQuery = useQuery({
    queryKey: queryKeys.plugins.all,
    queryFn: () => pluginsApi.list(),
  });
  const neoPlugin = (pluginsQuery.data ?? []).find(
    (p: { pluginKey: string }) => p.pluginKey === "neocompany-tools",
  );
  const pluginId = neoPlugin?.id;

  // Fetch templates via plugin data handler
  const templatesQuery = useQuery({
    queryKey: ["content-templates", selectedCompanyId],
    queryFn: async () => {
      if (!pluginId || !selectedCompanyId) return { templates: [] };
      const res = await pluginsApi.bridgeGetData(pluginId, "templateList", { companyId: selectedCompanyId }, selectedCompanyId);
      return (res as { data: { templates: TemplateView[] } }).data ?? { templates: [] };
    },
    enabled: !!pluginId && !!selectedCompanyId,
  });

  const templates: TemplateView[] = templatesQuery.data?.templates ?? [];

  // Create template via plugin action
  const createMut = useMutation({
    mutationFn: async (data: { name: string; preset: string; description?: string }) => {
      if (!pluginId || !selectedCompanyId) throw new Error("Plugin not available");
      const match = PRESETS.find((p) => p.key === data.preset);
      return pluginsApi.bridgePerformAction(pluginId, "templateSave", {
        companyId: selectedCompanyId,
        data: {
          name: data.name,
          description: data.description,
          width: match?.w ?? 1080,
          height: match?.h ?? 1080,
          config: DEFAULT_CONFIG,
          isDefault: false,
        },
      }, selectedCompanyId);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["content-templates", selectedCompanyId] });
    },
    onSuccess: () => {
      pushToast({ title: "Template created", tone: "success" });
      setShowCreate(false);
    },
    onError: (err) => pushToast({ title: `Failed: ${(err as Error).message}`, tone: "error" }),
  });

  if (pluginsQuery.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (!neoPlugin) {
    return (
      <div className="max-w-3xl p-6">
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <Palette className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-muted-foreground">
            Install the <strong>neocompany-tools</strong> plugin to use brand templates.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Brand Templates</h1>
          <p className="text-sm text-muted-foreground">
            Create and manage image templates with your brand identity
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="mr-1 h-4 w-4" />
          New template
        </Button>
      </div>

      {showCreate && (
        <CreateTemplateCard
          onSubmit={(data) => createMut.mutate(data)}
          onCancel={() => setShowCreate(false)}
          isPending={createMut.isPending}
        />
      )}

      {templatesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading templates…</p>
      ) : templates.length === 0 && !showCreate ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <Image className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-muted-foreground mb-3">
            No templates yet. Create one to start designing branded images.
          </p>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            Create your first template
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              logoUrl={selectedCompany?.logoUrl ?? undefined}
              onClick={() => navigate(`/content/templates/${t.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template card
// ---------------------------------------------------------------------------

function TemplateCard({
  template: t,
  logoUrl,
  onClick,
}: {
  template: TemplateView;
  logoUrl?: string;
  onClick: () => void;
}) {
  // Use a small scale to fit the card width
  const cardScale = 340 / Math.max(t.width, t.height);
  const cfg = (t.config as unknown as TemplateConfig) ?? null;

  //// Neocompany Modification — prefer the template's own inline logo over
  //// the active company's logo. Each template can carry its own logo
  //// (saved in config.logo.imageDataUrl by the editor) and the card
  //// should render that one so the miniature is a true preview of what
  //// the template will produce — not the brand overlay of whatever
  //// company happens to be selected in the sidebar. Falls back to the
  //// caller-provided logoUrl when the template hasn't customized its own.
  const resolvedLogoUrl =
    (cfg?.logo as { imageDataUrl?: string } | undefined)?.imageDataUrl ?? logoUrl;
  //// End Neocompany Modification

  return (
    <button
      onClick={onClick}
      className="text-left rounded-xl border border-border bg-card overflow-hidden hover:shadow-md hover:border-primary/50 transition-all"
    >
      {/* Live preview */}
      <div className="flex items-center justify-center bg-muted/20 p-4">
        {cfg ? (
          <TemplateCanvas
            width={t.width}
            height={t.height}
            config={cfg}
            logoUrl={resolvedLogoUrl}
            sampleImageUrl="https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600"
            scale={cardScale}
            showLabel
            //// Neocompany Modification — the template list card shows the
            //// final rendered look (what a viewer will see), not the editor
            //// authoring chrome. Without showGuides:false the card would
            //// leak dashed text zone outlines and a green "Logo" placeholder
            //// box when the company has no logo asset configured.
            showGuides={false}
          />
        ) : (
          <div className="flex items-center justify-center text-muted-foreground" style={{ width: t.width * cardScale, height: t.height * cardScale }}>
            <Image className="h-6 w-6 opacity-40" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 border-t border-border">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium truncate">{t.name}</span>
          {t.isDefault && <Badge variant="secondary">default</Badge>}
        </div>
        {t.description && (
          <p className="text-xs text-muted-foreground mt-1 truncate">{t.description}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1 tabular-nums">
          {t.width} × {t.height} · {new Date(t.createdAt).toLocaleDateString()}
        </p>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Create template card
// ---------------------------------------------------------------------------

function CreateTemplateCard({
  onSubmit,
  onCancel,
  isPending,
}: {
  onSubmit: (data: { name: string; preset: string; description?: string }) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("instagram-square");
  const [description, setDescription] = useState("");

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <h3 className="text-sm font-semibold">New template</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Instagram Promo"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Dimension preset</Label>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label} ({p.w}×{p.h})
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Description (optional)</Label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this template is for"
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSubmit({ name, preset, description })} disabled={!name.trim() || isPending}>
          {isPending ? "Creating…" : "Create"}
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
