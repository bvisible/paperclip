import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, Trash2, Plus } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import { Button } from "@/components/ui/button";
import { pluginsApi } from "@/api/plugins";
import { TemplateCanvas } from "@/components/templates/TemplateCanvas";
import { CanvasPreviewGrid } from "@/components/templates/CanvasPreviewGrid";
import {
  DimensionsTab,
  LogoTab,
  TextTab,
  StyleTab,
} from "@/components/templates/TemplateEditorTabs";
import {
  DEFAULT_TEMPLATE_CONFIG,
  SAMPLE_IMAGES,
  type TemplateConfig,
} from "@/components/templates/types";

type Tab = "dimensions" | "logo" | "text" | "style";

interface TemplateData {
  id?: string;
  name: string;
  description?: string;
  width: number;
  height: number;
  config: TemplateConfig;
  isDefault: boolean;
}

export function ContentTemplateEditor() {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const qc = useQueryClient();

  // --- Plugin lookup ---
  const pluginsQuery = useQuery({
    queryKey: ["plugins"],
    queryFn: () => pluginsApi.list(),
  });
  const neoPlugin = (pluginsQuery.data ?? []).find(
    (p: { pluginKey: string }) => p.pluginKey === "neocompany-tools",
  );
  const pluginId = neoPlugin?.id;

  // --- Load templates list (contains the one we're editing) ---
  const templatesQuery = useQuery({
    queryKey: ["content-templates", selectedCompanyId],
    queryFn: async () => {
      if (!pluginId || !selectedCompanyId) return { templates: [] };
      const res = await pluginsApi.bridgeGetData(
        pluginId, "templateList", { companyId: selectedCompanyId }, selectedCompanyId,
      );
      return (res as { data: { templates: TemplateData[] } }).data ?? { templates: [] };
    },
    enabled: !!pluginId && !!selectedCompanyId,
  });

  // --- Load company brand (to auto-fill) ---
  const brandQuery = useQuery({
    queryKey: ["company-brand-for-template", selectedCompanyId],
    queryFn: async () => {
      if (!pluginId || !selectedCompanyId) return null;
      const res = await pluginsApi.bridgeGetData(
        pluginId, "companyConfig", { companyId: selectedCompanyId }, selectedCompanyId,
      );
      return (res as {
        data?: {
          config?: {
            brand?: { tagline?: string; website?: string; primaryFont?: string; secondaryFont?: string };
          };
        };
      }).data?.config?.brand ?? null;
    },
    enabled: !!pluginId && !!selectedCompanyId,
  });

  // --- Local state ---
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1080);
  const [config, setConfig] = useState<TemplateConfig>(DEFAULT_TEMPLATE_CONFIG);
  const [isDefault, setIsDefault] = useState(false);
  const [tab, setTab] = useState<Tab>("logo");
  const [sampleImageUrl, setSampleImageUrl] = useState<string | undefined>(SAMPLE_IMAGES[1].url);
  const [logoUrl, setLogoUrl] = useState<string | undefined>(selectedCompany?.logoUrl ?? undefined);
  const [loaded, setLoaded] = useState(false);

  // --- Hydrate from existing template ---
  useEffect(() => {
    if (loaded) return;
    const tpl = templatesQuery.data?.templates.find((t) => t.id === templateId);
    if (!tpl) return;
    setName(tpl.name ?? "");
    setDescription(tpl.description ?? "");
    setWidth(tpl.width ?? 1080);
    setHeight(tpl.height ?? 1080);
    setConfig({ ...DEFAULT_TEMPLATE_CONFIG, ...tpl.config });
    setIsDefault(tpl.isDefault ?? false);
    // Prefer the inline logo data URL stored in the template (works on
    // the server without any fetch); fall back to the company logo URL.
    if (tpl.config?.logo?.imageDataUrl) {
      setLogoUrl(tpl.config.logo.imageDataUrl);
    }
    setLoaded(true);
  }, [templateId, templatesQuery.data, loaded]);

  // --- Sync logoUrl with company logo when it changes ---
  useEffect(() => {
    if (!logoUrl && selectedCompany?.logoUrl) {
      setLogoUrl(selectedCompany.logoUrl);
    }
  }, [selectedCompany?.logoUrl, logoUrl]);

  // --- Breadcrumbs ---
  useEffect(() => {
    setBreadcrumbs([
      { label: "Content", href: "/content" },
      { label: "Templates", href: "/content/templates" },
      { label: name || "New template" },
    ]);
  }, [setBreadcrumbs, name]);

  // --- Save mutation ---
  const saveMut = useMutation({
    mutationFn: async () => {
      if (!pluginId || !selectedCompanyId) throw new Error("Plugin not available");
      return pluginsApi.bridgePerformAction(pluginId, "templateSave", {
        companyId: selectedCompanyId,
        templateId,
        data: { name, description, width, height, config, isDefault },
      }, selectedCompanyId);
    },
    onSuccess: () => {
      pushToast({ title: "Template saved", tone: "success" });
      qc.invalidateQueries({ queryKey: ["content-templates", selectedCompanyId] });
    },
    onError: (err) => pushToast({ title: `Save failed: ${(err as Error).message}`, tone: "error" }),
  });

  // --- Delete mutation ---
  const deleteMut = useMutation({
    mutationFn: async () => {
      if (!pluginId || !selectedCompanyId || !templateId) throw new Error("No template to delete");
      return pluginsApi.bridgePerformAction(pluginId, "templateDelete", {
        companyId: selectedCompanyId,
        templateId,
      }, selectedCompanyId);
    },
    onSuccess: () => {
      pushToast({ title: "Template deleted", tone: "success" });
      qc.invalidateQueries({ queryKey: ["content-templates", selectedCompanyId] });
      navigate("/content/templates");
    },
    onError: (err) => pushToast({ title: `Delete failed: ${(err as Error).message}`, tone: "error" }),
  });

  const onDeleteClick = useCallback(() => {
    if (!templateId) return;
    const confirmed = globalThis.confirm(`Delete template "${name || "Untitled"}"? This cannot be undone.`);
    if (confirmed) deleteMut.mutate();
  }, [templateId, name, deleteMut]);

  // --- Export PNG (real server-side composite via templateApply) ---
  const exportMut = useMutation({
    mutationFn: async () => {
      if (!pluginId || !selectedCompanyId || !templateId) throw new Error("Save template first");
      const res = await pluginsApi.bridgePerformAction(pluginId, "templateSave", {
        companyId: selectedCompanyId,
        templateId,
        data: { name, description, width, height, config, isDefault },
      }, selectedCompanyId);
      const savedId = (res as { data?: { templateId?: string } }).data?.templateId ?? templateId;
      // Then apply
      const applyRes = await fetch(`/api/plugins/tools/execute`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: "neocompany-tools:templateApply",
          parameters: {
            templateId: savedId,
            sourceImageUrl: sampleImageUrl ?? SAMPLE_IMAGES[1].url,
            logoUrl,
          },
          runContext: {
            agentId: "00000000-0000-0000-0000-000000000000",
            runId: `export-${Date.now()}`,
            companyId: selectedCompanyId,
            projectId: selectedCompanyId,
          },
        }),
      });
      const body = await applyRes.json();
      if (body.result?.error) throw new Error(body.result.error);
      return body.result.data?.processedImageDataUrl as string;
    },
    onSuccess: (dataUrl) => {
      if (!dataUrl) return;
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${name || "template"}.png`;
      a.click();
      pushToast({ title: "PNG exported", tone: "success" });
    },
    onError: (err) => pushToast({ title: `Export failed: ${(err as Error).message}`, tone: "error" }),
  });

  // --- Partial config patcher ---
  const onConfigChange = useCallback((patch: Partial<TemplateConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  // --- Apply brand defaults button ---
  const applyBrandDefaults = useCallback(() => {
    const brand = brandQuery.data;
    if (!brand) {
      pushToast({ title: "No brand data — set it in Company Settings", tone: "info" });
      return;
    }
    const patch: Partial<TemplateConfig> = {};
    if (selectedCompany?.brandColor && config.overlay.opacity === 0) {
      // Don't auto-apply brand color as overlay — user can do it manually
    }
    // Auto-add a website zone if brand.website is set and no text zone has it
    if (brand.website && !config.textZones.some((z) => z.defaultText === brand.website)) {
      patch.textZones = [
        ...config.textZones,
        {
          id: `zone-brand-website-${Date.now()}`,
          name: "Brand website",
          x: 10, y: 90, width: 80, height: 6,
          fontSize: 18,
          fontColor: "#ffffff",
          fontFamily: brand.primaryFont || "Arial",
          textAlign: "center",
          defaultText: brand.website,
        },
      ];
    }
    if (Object.keys(patch).length > 0) {
      onConfigChange(patch);
      pushToast({ title: "Brand defaults applied", tone: "success" });
    } else {
      pushToast({ title: "Brand defaults already applied", tone: "info" });
    }
  }, [brandQuery.data, selectedCompany, config, onConfigChange, pushToast]);

  const canvasScale = useMemo(
    () => Math.min(0.5, 520 / Math.max(width, height)),
    [width, height],
  );

  if (!pluginsQuery.isLoading && !neoPlugin) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        The neocompany-tools plugin is not installed.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header bar */}
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/content/templates")}
          className="shrink-0"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>

        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Template name"
          className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium"
        />

        <Button variant="outline" size="sm" onClick={applyBrandDefaults}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Apply brand
        </Button>

        <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !name.trim()}>
          <Save className="mr-1 h-3.5 w-3.5" />
          {saveMut.isPending ? "Saving…" : "Save"}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => exportMut.mutate()}
          disabled={exportMut.isPending || !templateId}
        >
          {exportMut.isPending ? "Exporting…" : "Export PNG"}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onDeleteClick}
          disabled={deleteMut.isPending || !templateId}
          className="text-destructive hover:text-destructive"
          title="Delete template"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Main content: left form + right preview */}
      <div className="flex-1 min-h-0 flex">
        {/* Left column: form */}
        <div className="w-[400px] shrink-0 overflow-y-auto border-r border-border bg-background p-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What this template is for"
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 rounded-md border border-border bg-card p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4 rounded accent-primary"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">Set as brand overlay</div>
              <div className="text-xs text-muted-foreground">
                Auto-apply this template on all generated images
              </div>
            </div>
          </label>

          {/* Tabs */}
          <div className="border-b border-border">
            <nav className="flex gap-1">
              {(["dimensions", "logo", "text", "style"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-2 text-xs font-medium capitalize transition-colors ${
                    tab === t
                      ? "border-b-2 border-primary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </nav>
          </div>

          <div className="pt-1">
            {tab === "dimensions" && (
              <DimensionsTab
                width={width}
                height={height}
                onWidthChange={setWidth}
                onHeightChange={setHeight}
              />
            )}
            {tab === "logo" && (
              <LogoTab
                config={config}
                logoUrl={logoUrl}
                onLogoUrlChange={(url) => {
                  setLogoUrl(url);
                  // Persist data URLs into the template config so the server
                  // compositor can render the logo without fetching a URL.
                  if (url && url.startsWith("data:")) {
                    onConfigChange({ logo: { ...config.logo, imageDataUrl: url } });
                  } else if (!url) {
                    const { imageDataUrl: _drop, ...rest } = config.logo;
                    onConfigChange({ logo: rest });
                  }
                }}
                onConfigChange={onConfigChange}
              />
            )}
            {tab === "text" && (
              <TextTab config={config} onConfigChange={onConfigChange} />
            )}
            {tab === "style" && (
              <StyleTab config={config} onConfigChange={onConfigChange} />
            )}
          </div>
        </div>

        {/* Right column: preview */}
        <div className="flex-1 overflow-y-auto bg-muted/20 p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Sample image picker */}
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold">Preview</h2>
              <div className="flex items-center gap-1.5">
                {SAMPLE_IMAGES.map((s, idx) => {
                  const active = sampleImageUrl === s.url;
                  return (
                    <button
                      key={idx}
                      onClick={() => setSampleImageUrl(s.url)}
                      className={`w-10 h-10 rounded-md border-2 overflow-hidden flex items-center justify-center ${
                        active ? "border-primary" : "border-border"
                      }`}
                      title={s.label}
                    >
                      {s.url ? (
                        <img src={s.url} alt={s.label} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </button>
                  );
                })}
                <label className="w-10 h-10 rounded-md border-2 border-dashed border-border flex items-center justify-center cursor-pointer hover:border-primary">
                  <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => setSampleImageUrl(reader.result as string);
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
              </div>
            </div>

            {/* Main preview */}
            <div className="flex justify-center">
              <TemplateCanvas
                width={width}
                height={height}
                config={config}
                logoUrl={logoUrl}
                sampleImageUrl={sampleImageUrl}
                scale={canvasScale}
              />
            </div>

            {/* Multi-format preview */}
            <div className="pt-4 border-t border-border">
              <h3 className="text-sm font-semibold text-center mb-4">Multi-format preview</h3>
              <CanvasPreviewGrid config={config} logoUrl={logoUrl} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
