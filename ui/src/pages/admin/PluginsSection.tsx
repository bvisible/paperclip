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
