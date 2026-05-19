//// Neocompany Modification — pure addition (Neocompany fork on top of paperclipai/paperclip)
//// /content/catalog page — browse the locally-synced WooCommerce product
//// catalog, search/filter, and trigger a manual re-sync. Designed so an
//// agent can be told "prépare 5 posts sur la collection été" and resolve
//// the products via wcListProducts + wcGetProduct.
//// End Neocompany Modification

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Package, RefreshCw, Search, Sparkles } from "lucide-react";
import { NavLink } from "@/lib/router";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pluginsApi } from "@/api/plugins";

interface CatalogProduct {
  id: string;
  wcId: number;
  name: string;
  slug: string;
  status: "publish" | "draft" | "pending" | "private" | "deleted";
  price?: string;
  currency?: string;
  permalink?: string;
  categoryIds: string[];
  categoryNames: string[];
  thumbnailUrl?: string;
  imageCount: number;
}

interface CatalogCategory {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  count: number;
}

interface SyncResult {
  upserted: number;
  softDeleted: number;
  categoriesUpserted: number;
  scanned: number;
  errors: string[];
}

const STATUS_OPTIONS: Array<{ value: "any" | "publish" | "draft" | "pending"; label: string }> = [
  { value: "any", label: "All non-deleted" },
  { value: "publish", label: "Published" },
  { value: "draft", label: "Draft" },
  { value: "pending", label: "Pending" },
];

export function ContentCatalog() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [status, setStatus] = useState<"any" | "publish" | "draft" | "pending">("any");

  useEffect(() => {
    setBreadcrumbs([{ label: "Content" }, { label: "Catalogue" }]);
  }, [setBreadcrumbs]);

  const pluginsQuery = useQuery({
    queryKey: ["plugins"],
    queryFn: () => pluginsApi.list(),
  });
  const neoPlugin = (pluginsQuery.data ?? []).find(
    (p: { pluginKey: string }) => p.pluginKey === "neocompany-tools",
  );
  const pluginId = neoPlugin?.id;

  const productsQuery = useQuery({
    queryKey: ["wc-catalog-products", selectedCompanyId],
    queryFn: async (): Promise<CatalogProduct[]> => {
      if (!pluginId || !selectedCompanyId) return [];
      const res = await pluginsApi.bridgeGetData(
        pluginId,
        "productsList",
        { companyId: selectedCompanyId, limit: 500, status: "any" },
        selectedCompanyId,
      );
      return (res as { data: { products: CatalogProduct[] } }).data?.products ?? [];
    },
    enabled: !!pluginId && !!selectedCompanyId,
    refetchOnWindowFocus: false,
  });

  const categoriesQuery = useQuery({
    queryKey: ["wc-catalog-categories", selectedCompanyId],
    queryFn: async (): Promise<CatalogCategory[]> => {
      if (!pluginId || !selectedCompanyId) return [];
      const res = await pluginsApi.bridgeGetData(
        pluginId,
        "productCategoriesList",
        { companyId: selectedCompanyId },
        selectedCompanyId,
      );
      return (res as { data: { categories: CatalogCategory[] } }).data?.categories ?? [];
    },
    enabled: !!pluginId && !!selectedCompanyId,
    refetchOnWindowFocus: false,
  });

  const syncMut = useMutation({
    mutationFn: async (force: boolean) => {
      if (!pluginId || !selectedCompanyId) throw new Error("Plugin not available");
      const res = await pluginsApi.bridgePerformAction(
        pluginId,
        "productCatalogSync",
        { companyId: selectedCompanyId, force },
        selectedCompanyId,
      );
      return (res as { data: SyncResult }).data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["wc-catalog-products", selectedCompanyId] });
      qc.invalidateQueries({ queryKey: ["wc-catalog-categories", selectedCompanyId] });
      const errorSuffix = data?.errors?.length ? ` (${data.errors.length} erreur${data.errors.length > 1 ? "s" : ""})` : "";
      pushToast({
        title: `Sync terminé : ${data?.upserted ?? 0} produit(s), ${data?.categoriesUpserted ?? 0} catégorie(s)${errorSuffix}`,
        tone: data?.errors?.length ? "info" : "success",
      });
    },
    onError: (err) => pushToast({ title: `Sync échoué : ${(err as Error).message}`, tone: "error" }),
  });

  const filtered = useMemo(() => {
    const all = productsQuery.data ?? [];
    const lower = search.trim().toLowerCase();
    return all.filter((p) => {
      if (status !== "any" && p.status !== status) return false;
      if (status === "any" && p.status === "deleted") return false;
      if (categoryId && !p.categoryIds.includes(categoryId)) return false;
      if (lower && !p.name.toLowerCase().includes(lower) && !p.slug.toLowerCase().includes(lower)) return false;
      return true;
    });
  }, [productsQuery.data, search, status, categoryId]);

  const totalRaw = productsQuery.data?.length ?? 0;
  const hasNeverSynced = !productsQuery.isLoading && totalRaw === 0;

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Catalogue</h1>
          <span className="text-sm text-muted-foreground">
            {totalRaw > 0 ? `· ${totalRaw} produit${totalRaw > 1 ? "s" : ""} synchronisé${totalRaw > 1 ? "s" : ""}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMut.mutate(false)}
            disabled={syncMut.isPending || !pluginId || !selectedCompanyId}
          >
            {syncMut.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {syncMut.isPending ? "Synchronisation…" : "Sync from WooCommerce"}
          </Button>
        </div>
      </div>

      {/* Empty state — never synced */}
      {hasNeverSynced ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <Package className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">Catalogue vide</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Aucun produit synchronisé.{" "}
            {selectedCompany ? (
              <>
                Vérifiez que les identifiants WordPress sont configurés dans{" "}
                <NavLink to={`/${selectedCompany.issuePrefix}/plugins/${pluginId ?? "neocompany-tools"}`} className="text-primary underline">
                  les paramètres du plugin
                </NavLink>
                {", "}puis cliquez sur « Sync from WooCommerce ».
              </>
            ) : (
              "Configurez d'abord les identifiants WordPress, puis lancez un sync."
            )}
          </p>
          <Button
            className="mt-4"
            onClick={() => syncMut.mutate(false)}
            disabled={syncMut.isPending || !pluginId || !selectedCompanyId}
          >
            {syncMut.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Lancer le premier sync
          </Button>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un produit…"
                className="pl-8 w-64"
              />
            </div>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Toutes les catégories</option>
              {(categoriesQuery.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.count})
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {(search || categoryId || status !== "any") && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setCategoryId(""); setStatus("any"); }}>
                Réinitialiser
              </Button>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {filtered.length} sur {totalRaw} affiché{filtered.length > 1 ? "s" : ""}
            </span>
          </div>

          {/* Grid */}
          {productsQuery.isLoading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Chargement…
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Aucun produit ne correspond à vos filtres.
            </div>
          ) : (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
              {filtered.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  companyPrefix={selectedCompany?.issuePrefix ?? ""}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ProductCard({ product, companyPrefix }: { product: CatalogProduct; companyPrefix: string }) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary/40">
      <div className="aspect-square bg-muted/40">
        {product.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.thumbnailUrl}
            alt={product.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Package className="h-10 w-10" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-sm font-medium" title={product.name}>
            {product.name}
          </h3>
          {product.status !== "publish" && (
            <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {product.status}
            </span>
          )}
        </div>
        {product.price && (
          <div className="text-xs text-muted-foreground">
            {product.price} {product.currency ?? ""}
          </div>
        )}
        {product.categoryNames.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {product.categoryNames.slice(0, 3).map((c) => (
              <span key={c} className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
                {c}
              </span>
            ))}
            {product.categoryNames.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{product.categoryNames.length - 3}</span>
            )}
          </div>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="text-[10px] text-muted-foreground">
            {product.imageCount} image{product.imageCount > 1 ? "s" : ""}
          </span>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="opacity-0 transition-opacity group-hover:opacity-100"
          >
            <NavLink to={`/${companyPrefix}/content/stock?productId=${encodeURIComponent(product.id)}`}>
              <Sparkles className="mr-1 h-3 w-3" />
              Générer
            </NavLink>
          </Button>
        </div>
      </div>
    </div>
  );
}
