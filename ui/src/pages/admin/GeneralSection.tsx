//// Neoffice Modification — pure addition (Neocompany fork on top of paperclipai/paperclip)
//// This file does not exist upstream. Safe across upstream merges.

import { useEffect } from "react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { InstanceGeneralSettings } from "@/pages/InstanceGeneralSettings";
import { InstanceExperimentalSettings } from "@/pages/InstanceExperimentalSettings";

export function GeneralSection() {
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => {
    setBreadcrumbs([{ label: "Admin" }, { label: "General Settings" }]);
  }, [setBreadcrumbs]);

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-lg font-semibold">General Settings</h1>
        <p className="text-sm text-muted-foreground">Instance-wide configuration</p>
      </div>
      <InstanceGeneralSettings />
      <hr className="border-border" />
      <InstanceExperimentalSettings />
    </div>
  );
}
