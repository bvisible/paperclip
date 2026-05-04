import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
//// Neoffice Modification: neoffice-html-branding
//// Why: BreadcrumbContext rewrites `document.title` on every navigation
////      (e.g. "Dashboard · Paperclip"), which overrides the static
////      <title>NORA</title> emitted by the index.html transform plugin.
////      Switch the suffix to "NORA" when running embedded.
//// Date: 2026-05-04
//// Refs: NORA #27 Phase J follow-up
import { IS_NEOFFICE } from "@/lib/deployment";

const TITLE_BRAND = IS_NEOFFICE ? "NORA" : "Paperclip";
//// End Neoffice Modification: neoffice-html-branding

export interface Breadcrumb {
  label: string;
  href?: string;
}

interface BreadcrumbContextValue {
  breadcrumbs: Breadcrumb[];
  setBreadcrumbs: (crumbs: Breadcrumb[]) => void;
  mobileToolbar: ReactNode | null;
  setMobileToolbar: (node: ReactNode | null) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

function breadcrumbsEqual(left: Breadcrumb[], right: Breadcrumb[]) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]?.label !== right[index]?.label || left[index]?.href !== right[index]?.href) {
      return false;
    }
  }
  return true;
}

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [breadcrumbs, setBreadcrumbsState] = useState<Breadcrumb[]>([]);
  const [mobileToolbar, setMobileToolbarState] = useState<ReactNode | null>(null);

  const setBreadcrumbs = useCallback((crumbs: Breadcrumb[]) => {
    setBreadcrumbsState((current) => (breadcrumbsEqual(current, crumbs) ? current : crumbs));
  }, []);

  const setMobileToolbar = useCallback((node: ReactNode | null) => {
    setMobileToolbarState(node);
  }, []);

  useEffect(() => {
    if (breadcrumbs.length === 0) {
      document.title = TITLE_BRAND;
    } else {
      const parts = [...breadcrumbs].reverse().map((b) => b.label);
      document.title = `${parts.join(" · ")} · ${TITLE_BRAND}`;
    }
  }, [breadcrumbs]);

  return (
    <BreadcrumbContext.Provider value={{ breadcrumbs, setBreadcrumbs, mobileToolbar, setMobileToolbar }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbs() {
  const ctx = useContext(BreadcrumbContext);
  if (!ctx) {
    throw new Error("useBreadcrumbs must be used within BreadcrumbProvider");
  }
  return ctx;
}
