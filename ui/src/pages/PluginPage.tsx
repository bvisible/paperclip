import { useEffect, useMemo } from "react";
import { Navigate, useParams } from "@/lib/router"; //// Neocompany Modification — patch #9 (Link no longer used after chromeless layout)
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { pluginsApi } from "@/api/plugins";
import { queryKeys } from "@/lib/queryKeys";
import {
  PluginSlotMount,
  resolveRouteSidebarSlot,
  type ResolvedPluginSlot,
} from "@/plugins/slots";
//// Neocompany Modification — patch #9 (Button + ArrowLeft no longer used after chromeless layout)
// import { Button } from "@/components/ui/button";
// import { ArrowLeft } from "lucide-react";
//// End Neocompany Modification
import { NotFoundPage } from "./NotFound";

/**
 * Company-context plugin page. Renders a plugin's `page` slot at
 * `/:companyPrefix/plugins/:pluginId` when the plugin declares a page slot
 * and is enabled for that company.
 *
 * @see doc/plugins/PLUGIN_SPEC.md §19.2 — Company-Context Routes
 * @see doc/plugins/PLUGIN_SPEC.md §24.4 — Company-Context Plugin Page
 */
export function PluginPage() {
  const params = useParams<{
    companyPrefix?: string;
    pluginId?: string;
    pluginRoutePath?: string;
    "*": string | undefined;
  }>();
  const { companyPrefix: routeCompanyPrefix, pluginId, pluginRoutePath } = params;
  const pluginRouteSplat = params["*"];
  const { companies, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const routeCompany = useMemo(() => {
    if (!routeCompanyPrefix) return null;
    const requested = routeCompanyPrefix.toUpperCase();
    return companies.find((c) => c.issuePrefix.toUpperCase() === requested) ?? null;
  }, [companies, routeCompanyPrefix]);
  const hasInvalidCompanyPrefix = Boolean(routeCompanyPrefix) && !routeCompany;

  const resolvedCompanyId = useMemo(() => {
    if (routeCompany) return routeCompany.id;
    if (routeCompanyPrefix) return null;
    return selectedCompanyId ?? null;
  }, [routeCompany, routeCompanyPrefix, selectedCompanyId]);

  const companyPrefix = useMemo(
    () => (resolvedCompanyId ? companies.find((c) => c.id === resolvedCompanyId)?.issuePrefix ?? null : null),
    [companies, resolvedCompanyId],
  );

  const { data: contributions } = useQuery({
    queryKey: queryKeys.plugins.uiContributions,
    queryFn: () => pluginsApi.listUiContributions(),
    enabled: !!resolvedCompanyId && (!!pluginId || !!pluginRoutePath),
  });

  const pageSlot = useMemo(() => {
    if (!contributions) return null;
    if (pluginId) {
      //// Neocompany Modification — patch #6 (lookup by pluginKey first, UUID fallback)
      // URL-friendly plugin keys (e.g. "paperclip-chat") should resolve before
      // raw UUIDs so /:companyPrefix/plugins/paperclip-chat works as a public link.
      // Migration path: PR upstream — universal multi-company UX improvement.
      const contribution =
        contributions.find((c) => c.pluginKey === pluginId) ??
        contributions.find((c) => c.pluginId === pluginId);
      //// End Neocompany Modification
      if (!contribution) return null;
      const slot = contribution.slots.find((s) => s.type === "page");
      if (!slot) return null;
      return {
        ...slot,
        pluginId: contribution.pluginId,
        pluginKey: contribution.pluginKey,
        pluginDisplayName: contribution.displayName,
        pluginVersion: contribution.version,
      };
    }
    if (!pluginRoutePath) return null;
    const matches = contributions.flatMap((contribution) => {
      const slot = contribution.slots.find((entry) => entry.type === "page" && entry.routePath === pluginRoutePath);
      if (!slot) return [];
      return [{
        ...slot,
        pluginId: contribution.pluginId,
        pluginKey: contribution.pluginKey,
        pluginDisplayName: contribution.displayName,
        pluginVersion: contribution.version,
      }];
    });
    if (matches.length !== 1) return null;
    return matches[0] ?? null;
  }, [pluginId, pluginRoutePath, contributions]);

  const context = useMemo(
    () => ({
      companyId: resolvedCompanyId ?? null,
      companyPrefix,
    }),
    [resolvedCompanyId, companyPrefix],
  );

  // When the active route has a routeSidebar slot, the sidebar provides the
  // back affordance, but the top bar still needs a route-specific title.
  const routeSidebarActive = useMemo(() => {
    if (!pluginRoutePath || !contributions) return false;
    const flattened: ResolvedPluginSlot[] = contributions.flatMap((contribution) =>
      contribution.slots.map((slot) => ({
        ...slot,
        pluginId: contribution.pluginId,
        pluginKey: contribution.pluginKey,
        pluginDisplayName: contribution.displayName,
        pluginVersion: contribution.version,
      })),
    );
    return resolveRouteSidebarSlot(flattened, pluginRoutePath) !== null;
  }, [contributions, pluginRoutePath]);

  useEffect(() => {
    if (!pageSlot) return;
    if (routeSidebarActive) {
      setBreadcrumbs([{ label: resolveRouteSidebarPageTitle(pageSlot, pluginRouteSplat) }]);
      return;
    }
    setBreadcrumbs([
      { label: "Plugins", href: "/instance/settings/plugins" },
      { label: pageSlot.pluginDisplayName },
    ]);
  }, [pageSlot, pluginRouteSplat, setBreadcrumbs, routeSidebarActive]);

  if (!resolvedCompanyId) {
    if (hasInvalidCompanyPrefix) {
      return <NotFoundPage scope="invalid_company_prefix" requestedPrefix={routeCompanyPrefix} />;
    }
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Select a company to view this page.</p>
      </div>
    );
  }

  if (!contributions) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  if (!pluginId && pluginRoutePath) {
    const duplicateMatches = contributions.filter((contribution) =>
      contribution.slots.some((slot) => slot.type === "page" && slot.routePath === pluginRoutePath),
    );
    if (duplicateMatches.length > 1) {
      return (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Multiple plugins declare the route <code>{pluginRoutePath}</code>. Use the plugin-id route until the conflict is resolved.
        </div>
      );
    }
  }

  if (!pageSlot) {
    if (pluginRoutePath) {
      return <NotFoundPage scope="board" />;
    }
    // No page slot: redirect to plugin settings where plugin info is always shown
    const settingsPath = pluginId ? `/instance/settings/plugins/${pluginId}` : "/instance/settings/plugins";
    return <Navigate to={settingsPath} replace />;
  }

  //// Neocompany Modification — patch #9 (chromeless plugin pages)
  // Drop the wrapper "Back" button + padding so plugin pages use the full
  // viewport. Plugins like paperclip-chat / content-templates need the entire
  // canvas (chat composer, template editor, etc.) without ambient chrome.
  // Migration path: PR upstream to add a `chromeless: true` flag on the
  // plugin manifest UI declaration so this is opt-in per slot.
  return (
    <div className="h-full flex flex-col -m-6">
      <PluginSlotMount
        slot={pageSlot}
        context={context}
        className="flex-1 min-h-0"
        missingBehavior="placeholder"
      />
    </div>
  );
  //// End Neocompany Modification
}

function resolveRouteSidebarPageTitle(pageSlot: ResolvedPluginSlot, routeSplat: string | undefined): string {
  const title = titleFromRouteSplat(routeSplat);
  return title ?? pageSlot.displayName ?? pageSlot.pluginDisplayName;
}

function titleFromRouteSplat(routeSplat: string | undefined): string | null {
  const segments = (routeSplat ?? "")
    .split("/")
    .filter(Boolean)
    .map(decodeRouteSegment);
  if (segments.length === 0) return null;

  if (segments[0] === "page" && segments.length > 1) {
    return titleFromPath(segments.slice(1).join("/"), { preserveCase: true });
  }

  return titleFromPath(segments[0] ?? null);
}

function titleFromPath(path: string | null | undefined, options: { preserveCase?: boolean } = {}): string | null {
  const trimmed = path?.trim();
  if (!trimmed) return null;
  const basename = trimmed.split("/").filter(Boolean).at(-1) ?? trimmed;
  const withoutNamespace = basename.split("::").at(-1) ?? basename;
  const withoutExtension = withoutNamespace.replace(/\.[^.]+$/, "");
  const normalized = withoutExtension.replace(/[-_]+/g, " ").trim();
  if (!normalized) return null;
  if (options.preserveCase) return normalized;
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function decodeRouteSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
