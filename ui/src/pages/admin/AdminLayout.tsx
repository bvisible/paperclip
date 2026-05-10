//// Neoffice Modification — pure addition (Neocompany fork on top of paperclipai/paperclip)
//// This file does not exist upstream. Safe across upstream merges.

import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { Building2, Puzzle, Settings, Wrench } from "lucide-react";
import { adminApi } from "@/api/admin";
import { queryKeys } from "@/lib/queryKeys";
import { useToast } from "@/context/ToastContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";

const NAV_ITEMS = [
  { to: "/admin/companies", label: "Companies", icon: Building2 },
  { to: "/admin/plugins", label: "Plugins", icon: Puzzle },
  { to: "/admin/tools", label: "Tools Config", icon: Wrench },
  { to: "/admin/general", label: "Settings", icon: Settings },
];

export function AdminLayout() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [checked, setChecked] = useState(false);

  const adminQuery = useQuery({
    queryKey: queryKeys.admin.isAdmin,
    queryFn: () => adminApi.checkIsAdmin(),
    retry: false,
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Admin" }]);
  }, [setBreadcrumbs]);

  // Redirect non-admins once the check completes
  useEffect(() => {
    if (adminQuery.isLoading) return;
    if (!adminQuery.data?.isAdmin) {
      pushToast({ title: "Admin access required", tone: "error" });
      navigate("/", { replace: true });
    } else {
      setChecked(true);
    }
  }, [adminQuery.isLoading, adminQuery.data, navigate, pushToast]);

  if (!checked) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Checking admin access…
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Sidebar navigation */}
      <nav className="w-52 shrink-0 border-r border-border bg-card p-4 space-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Administration
        </h2>
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
