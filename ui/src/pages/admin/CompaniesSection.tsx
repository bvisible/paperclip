//// Neocompany Modification — pure addition (Neocompany fork on top of paperclipai/paperclip)
//// This file does not exist upstream. Safe across upstream merges.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { companiesApi, type CompanyStats } from "@/api/companies";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Company } from "@paperclipai/shared";
import { CompanyDrawer } from "./CompanyDrawer";
import { CreateCompanyDialog } from "./CreateCompanyDialog";

export function CompaniesSection() {
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const companiesQuery = useQuery({
    queryKey: [...queryKeys.companies.all, "withTest"] as const,
    // /admin lists all companies including is_test=true ones (server gates this
    // behind isInstanceAdmin). The 🧪 badge below distinguishes them.
    queryFn: () => companiesApi.list({ includeTest: true }),
  });

  const statsQuery = useQuery({
    queryKey: queryKeys.companies.stats,
    queryFn: () => companiesApi.stats(),
  });

  const companies = companiesQuery.data ?? [];
  const stats: CompanyStats = statsQuery.data ?? {};

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Companies</h1>
          <p className="text-sm text-muted-foreground">
            {companies.length} compan{companies.length === 1 ? "y" : "ies"} on this instance
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Create company
        </Button>
      </div>

      {companiesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : companies.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">No companies yet.</p>
          <Button size="sm" className="mt-3" onClick={() => setShowCreate(true)}>
            Create your first company
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Prefix</th>
                <th className="px-4 py-3 text-right">Agents</th>
                <th className="px-4 py-3 text-right">Issues</th>
                <th className="px-4 py-3 text-right">Budget</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => {
                const s = stats[c.id];
                const budgetCents = c.budgetMonthlyCents ?? 0;
                const spentCents = (c as Company & { spentMonthlyCents?: number }).spentMonthlyCents ?? 0;
                const overBudget = budgetCents > 0 && spentCents > budgetCents;
                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedCompany(c)}
                    className="border-b border-border last:border-0 cursor-pointer hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium">
                      <span className="inline-flex items-center gap-2">
                        {c.name}
                        {(c as Company & { isTest?: boolean }).isTest && (
                          <span
                            className="inline-flex items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
                            title="Test company — hidden from client boards"
                          >
                            🧪 Test
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{c.issuePrefix}</code>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{s?.agentCount ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{s?.issueCount ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {budgetCents > 0 ? (
                        <span className={overBudget ? "text-destructive font-medium" : ""}>
                          ${(spentCents / 100).toFixed(2)} / ${(budgetCents / 100).toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={c.status === "active" ? "default" : "secondary"}>
                        {c.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedCompany && (
        <CompanyDrawer
          company={selectedCompany}
          onClose={() => setSelectedCompany(null)}
        />
      )}

      {showCreate && (
        <CreateCompanyDialog onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}
