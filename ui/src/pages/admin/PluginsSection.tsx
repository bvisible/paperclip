//// Neocompany Modification — pure addition (Neocompany fork on top of paperclipai/paperclip)
//// This file does not exist upstream. Safe across upstream merges.

import { useEffect } from "react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PluginManager } from "@/pages/PluginManager";

export function PluginsSection() {
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => {
    setBreadcrumbs([{ label: "Admin" }, { label: "Plugins" }]);
  }, [setBreadcrumbs]);

  return <PluginManager />;
}
