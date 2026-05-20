//// Neocompany Modification — pure addition.
//// /content/scenes — per-tenant editor for the scene_variant pool used by
//// imageGenerate. Five styles + a 6th "story_vertical" pool, each with
//// editable variants (displayName + body + audience). The Generate dialog
//// pulls from here.
//// End Neocompany Modification

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, Wand2, X, Copy, Sparkles } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pluginsApi } from "@/api/plugins";

type SceneStyle =
  | "lifestyle"
  | "studio_creative"
  | "seasonal"
  | "slide_hero"
  | "summer_pole"
  | "story_vertical";

type Audience = "casual" | "formal";

interface SceneVariant {
  id: string;
  style: SceneStyle;
  displayName: string;
  body: string;
  audience: Audience[];
  order: number;
  isDefault?: boolean;
}

const STYLE_LABELS: Array<{ key: SceneStyle; label: string; hint: string }> = [
  { key: "lifestyle", label: "Lifestyle", hint: "Scènes vie quotidienne — square / portrait" },
  { key: "studio_creative", label: "Studio créatif", hint: "Still-life propre, lumière dirigée — square / portrait" },
  { key: "seasonal", label: "Saisonnier", hint: "Variations automne / hiver / printemps / été — square / portrait" },
  { key: "slide_hero", label: "Slide hero (16:9)", hint: "Compositions panoramiques pour bannières / slides" },
  { key: "summer_pole", label: "Summer pole", hint: "Scènes summer Riviera / lac / vignobles — square" },
  { key: "story_vertical", label: "Story vertical (9:16)", hint: "Cadrages verticaux pour Story / Reel / TikTok" },
];

export function ContentScenes() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const qc = useQueryClient();

  const [styleTab, setStyleTab] = useState<SceneStyle>("lifestyle");
  const [editing, setEditing] = useState<SceneVariant | null>(null);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Content" }, { label: "Scènes" }]);
  }, [setBreadcrumbs]);

  const pluginsQuery = useQuery({
    queryKey: ["plugins"],
    queryFn: () => pluginsApi.list(),
  });
  const neoPlugin = (pluginsQuery.data ?? []).find(
    (p: { pluginKey: string }) => p.pluginKey === "neocompany-tools",
  );
  const pluginId = neoPlugin?.id;

  const scenesQuery = useQuery({
    queryKey: ["scenes", selectedCompanyId],
    queryFn: async (): Promise<SceneVariant[]> => {
      if (!pluginId || !selectedCompanyId) return [];
      const res = await pluginsApi.bridgeGetData(
        pluginId, "scenesList", { companyId: selectedCompanyId }, selectedCompanyId,
      );
      return (res as { data: { scenes: SceneVariant[] } }).data?.scenes ?? [];
    },
    enabled: !!pluginId && !!selectedCompanyId,
    refetchOnWindowFocus: false,
  });

  const allScenes = scenesQuery.data ?? [];
  const scenesByStyle = useMemo(() => {
    const grouped = new Map<SceneStyle, SceneVariant[]>();
    for (const s of allScenes) {
      const list = grouped.get(s.style) ?? [];
      list.push(s);
      grouped.set(s.style, list);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => a.order - b.order);
    }
    return grouped;
  }, [allScenes]);

  const currentList = scenesByStyle.get(styleTab) ?? [];
  const counts = STYLE_LABELS.map((s) => ({ key: s.key, count: (scenesByStyle.get(s.key) ?? []).length }));

  const seedMut = useMutation({
    mutationFn: async () => {
      if (!pluginId || !selectedCompanyId) throw new Error("Plugin not available");
      const res = await pluginsApi.bridgePerformAction(
        pluginId, "scenesSeedDefaults",
        { companyId: selectedCompanyId, overwrite: false },
        selectedCompanyId,
      );
      return (res as { data: { inserted: number; skipped: number } }).data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["scenes", selectedCompanyId] });
      pushToast({ title: `Scènes seed : ${data?.inserted ?? 0} insérées, ${data?.skipped ?? 0} ignorées (déjà présentes)`, tone: "success" });
    },
    onError: (err) => pushToast({ title: `Seed échoué : ${(err as Error).message}`, tone: "error" }),
  });

  const saveMut = useMutation({
    mutationFn: async ({ sceneId, data }: { sceneId?: string; data: Partial<SceneVariant> }) => {
      if (!pluginId || !selectedCompanyId) throw new Error("Plugin not available");
      return pluginsApi.bridgePerformAction(
        pluginId, "sceneUpsert",
        { companyId: selectedCompanyId, sceneId, data },
        selectedCompanyId,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scenes", selectedCompanyId] });
      setEditing(null);
      setShowNew(false);
    },
    onError: (err) => pushToast({ title: `Sauvegarde échouée : ${(err as Error).message}`, tone: "error" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (sceneId: string) => {
      if (!pluginId || !selectedCompanyId) throw new Error("Plugin not available");
      return pluginsApi.bridgePerformAction(
        pluginId, "sceneDelete",
        { companyId: selectedCompanyId, sceneId },
        selectedCompanyId,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scenes", selectedCompanyId] });
      pushToast({ title: "Scène supprimée", tone: "success" });
    },
    onError: (err) => pushToast({ title: `Suppression échouée : ${(err as Error).message}`, tone: "error" }),
  });

  const onDuplicate = (variant: SceneVariant) => {
    const { id: _id, ...rest } = variant;
    saveMut.mutate({
      data: {
        ...rest,
        displayName: `${variant.displayName} (copie)`,
        isDefault: false,
        order: (currentList[currentList.length - 1]?.order ?? 0) + 10,
      },
    });
  };

  const hasAnyScene = allScenes.length > 0;

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Scènes</h1>
          <span className="text-sm text-muted-foreground">
            {hasAnyScene ? `· ${allScenes.length} variant${allScenes.length > 1 ? "s" : ""}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!hasAnyScene && (
            <Button
              variant="default"
              size="sm"
              onClick={() => seedMut.mutate()}
              disabled={seedMut.isPending || !pluginId}
            >
              {seedMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Seed defaults Reed-Blake
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowNew(true)}
            disabled={!pluginId}
          >
            <Plus className="mr-2 h-4 w-4" />
            Nouvelle scène
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Les variants sont choisis automatiquement selon le format de génération (carré / portrait / story / 16:9) et la catégorie du produit (sneakers → casual, richelieus → formal). Cycler avec 🎲 dans le Generate dialog. Edition libre par tenant.
      </p>

      {/* Style tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {STYLE_LABELS.map((s) => {
          const c = counts.find((x) => x.key === s.key)?.count ?? 0;
          const isActive = s.key === styleTab;
          return (
            <button
              key={s.key}
              onClick={() => setStyleTab(s.key)}
              className={`px-3 py-2 text-sm border-b-2 transition-colors ${
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
              <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">{c}</span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {STYLE_LABELS.find((s) => s.key === styleTab)?.hint}
        </p>
        {scenesQuery.isLoading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Chargement…
          </div>
        ) : currentList.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            Aucune scène dans ce style.{" "}
            {!hasAnyScene && "Clique « Seed defaults Reed-Blake » en haut pour démarrer."}
          </div>
        ) : (
          <div className="grid gap-2">
            {currentList.map((v) => (
              <SceneCard
                key={v.id}
                variant={v}
                onEdit={() => setEditing(v)}
                onDuplicate={() => onDuplicate(v)}
                onDelete={() => {
                  if (confirm(`Supprimer "${v.displayName}" ?`)) deleteMut.mutate(v.id);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {(editing || showNew) && (
        <SceneEditDialog
          initial={editing ?? newSceneTemplate(styleTab, currentList)}
          onClose={() => { setEditing(null); setShowNew(false); }}
          onSave={(data) => saveMut.mutate({ sceneId: editing?.id, data })}
          saving={saveMut.isPending}
        />
      )}
    </div>
  );
}

function newSceneTemplate(style: SceneStyle, current: SceneVariant[]): SceneVariant {
  return {
    id: "",
    style,
    displayName: "",
    body: "",
    audience: [],
    order: (current[current.length - 1]?.order ?? 0) + 10,
  };
}

function SceneCard({
  variant, onEdit, onDuplicate, onDelete,
}: {
  variant: SceneVariant;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const audienceLabel = variant.audience.length === 0 ? "neutre" : variant.audience.join(" + ");
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 hover:border-primary/40 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onEdit}
            className="text-sm font-medium text-left truncate hover:underline"
            title={variant.displayName}
          >
            {variant.displayName || <i>(sans nom)</i>}
          </button>
          {variant.isDefault && (
            <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">default</span>
          )}
          <span className="shrink-0 rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">{audienceLabel}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{variant.body}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onDuplicate} title="Dupliquer">
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete} title="Supprimer">
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

function SceneEditDialog({
  initial, onClose, onSave, saving,
}: {
  initial: SceneVariant;
  onClose: () => void;
  onSave: (data: Partial<SceneVariant>) => void;
  saving: boolean;
}) {
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [body, setBody] = useState(initial.body);
  const [audience, setAudience] = useState<Audience[]>(initial.audience);
  const [style] = useState<SceneStyle>(initial.style);

  const toggleAudience = (a: Audience) => {
    setAudience((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">
            {initial.id ? "Éditer la scène" : "Nouvelle scène"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Style : <code>{style}</code> · Audience : {audience.length === 0 ? "neutre (tous produits)" : audience.join(" + ")}
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <Label className="text-xs">Nom affiché</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="ex. Café terrace Geneva — casual"
              className="mt-1"
              autoFocus
            />
          </div>

          <div>
            <Label className="text-xs">Audience produit (filtre)</Label>
            <div className="mt-1 flex items-center gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={audience.includes("casual")} onChange={() => toggleAudience("casual")} />
                Casual (baskets, mocassins, loafers)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={audience.includes("formal")} onChange={() => toggleAudience("formal")} />
                Formal (richelieus, brogues)
              </label>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Aucune coche = scène neutre (utilisable pour tout produit).
            </p>
          </div>

          <div>
            <Label className="text-xs flex items-center justify-between">
              <span>Corps du prompt</span>
              <span className="text-[10px] font-normal text-muted-foreground">
                Tokens disponibles : <code>{"{descriptor}"}</code> <code>{"{title}"}</code> <code>{"{brand}"}</code> <code>{"{description}"}</code> <code>{"{city}"}</code>
              </span>
            </Label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              placeholder="Décris la scène (lieu, lumière, props, vêtements, cadrage). Utilise {descriptor} pour faire référence au produit."
              className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm font-mono"
            />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button
            size="sm"
            disabled={saving || !displayName.trim() || !body.trim()}
            onClick={() => onSave({
              style,
              displayName: displayName.trim(),
              body: body.trim(),
              audience,
              order: initial.order,
              isDefault: initial.isDefault,
            })}
          >
            {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            {initial.id ? "Enregistrer" : "Créer"}
          </Button>
        </div>
      </div>
    </div>
  );
}
