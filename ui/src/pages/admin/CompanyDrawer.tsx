//// Neoffice Modification — pure addition (Neocompany fork on top of paperclipai/paperclip)
//// This file does not exist upstream. Safe across upstream merges.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Shield, ShieldOff, Trash2, Archive } from "lucide-react";
import type { Company, Agent } from "@paperclipai/shared";
import { companiesApi } from "@/api/companies";
import { adminApi, type CompanyMember } from "@/api/admin";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/context/ToastContext";

type Tab = "details" | "members" | "agents";

interface Props {
  company: Company;
  onClose: () => void;
}

export function CompanyDrawer({ company, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("details");

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      {/* Drawer panel */}
      <div className="relative w-full max-w-lg bg-background border-l border-border shadow-xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background border-b border-border px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">{company.name}</h2>
              <p className="text-xs text-muted-foreground">
                <code>{company.issuePrefix}</code> · {company.id.slice(0, 8)}
              </p>
            </div>
            <button onClick={onClose} className="rounded-md p-1 hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="mt-3 flex gap-1">
            {(["details", "members", "agents"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  tab === t
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-5">
          {tab === "details" && <DetailsTab company={company} onClose={onClose} />}
          {tab === "members" && <MembersTab companyId={company.id} />}
          {tab === "agents" && <AgentsTab companyId={company.id} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Details tab
// ---------------------------------------------------------------------------

function DetailsTab({ company, onClose }: { company: Company; onClose: () => void }) {
  const qc = useQueryClient();
  const { pushToast } = useToast();
  const [name, setName] = useState(company.name);
  const [description, setDescription] = useState(company.description ?? "");
  const [budget, setBudget] = useState(String((company.budgetMonthlyCents ?? 0) / 100));

  const updateMut = useMutation({
    mutationFn: (data: Parameters<typeof companiesApi.update>[1]) =>
      companiesApi.update(company.id, data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
    onSuccess: () => pushToast({ title: "Company updated", tone: "success" }),
    onError: (err) => pushToast({ title: `Update failed: ${(err as Error).message}`, tone: "error" }),
  });

  const archiveMut = useMutation({
    mutationFn: () => companiesApi.archive(company.id),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.companies.all });
      onClose();
    },
    onSuccess: () => pushToast({ title: "Company archived", tone: "success" }),
  });

  const deleteMut = useMutation({
    mutationFn: () => companiesApi.remove(company.id),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.companies.all });
      onClose();
    },
    onSuccess: () => pushToast({ title: "Company deleted", tone: "success" }),
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Description</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
      </div>
      <div className="space-y-2">
        <Label>Monthly budget ($)</Label>
        <Input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} min="0" step="1" />
      </div>
      <div className="space-y-2">
        <Label>Status</Label>
        <Badge variant={company.status === "active" ? "default" : "secondary"}>{company.status}</Badge>
      </div>

      <div className="flex gap-2 pt-2">
        <Button
          size="sm"
          onClick={() =>
            updateMut.mutate({
              name,
              description: description || null,
              budgetMonthlyCents: Math.round(parseFloat(budget || "0") * 100),
            })
          }
          disabled={updateMut.isPending}
        >
          {updateMut.isPending ? "Saving…" : "Save"}
        </Button>
      </div>

      <hr className="my-4 border-border" />

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Danger zone</h3>
        {company.status === "active" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (confirm("Archive this company? It can be restored later.")) archiveMut.mutate();
            }}
            disabled={archiveMut.isPending}
          >
            <Archive className="mr-1 h-3.5 w-3.5" />
            Archive
          </Button>
        )}
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            if (company.status !== "archived") {
              pushToast({ title: "Archive the company first before deleting", tone: "error" });
              return;
            }
            if (confirm("Permanently delete this company? This cannot be undone.")) deleteMut.mutate();
          }}
          disabled={deleteMut.isPending}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          Delete permanently
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members tab
// ---------------------------------------------------------------------------

function MembersTab({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { pushToast } = useToast();

  const membersQuery = useQuery({
    queryKey: queryKeys.admin.companyMembers(companyId),
    queryFn: () => adminApi.listCompanyMembers(companyId),
  });

  const promoteMut = useMutation({
    mutationFn: (userId: string) => adminApi.promoteAdmin(userId),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.admin.companyMembers(companyId) }),
    onSuccess: () => pushToast({ title: "Promoted to admin", tone: "success" }),
    onError: (err) => pushToast({ title: `Failed: ${(err as Error).message}`, tone: "error" }),
  });

  const demoteMut = useMutation({
    mutationFn: (userId: string) => adminApi.demoteAdmin(userId),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.admin.companyMembers(companyId) }),
    onSuccess: () => pushToast({ title: "Demoted from admin", tone: "success" }),
    onError: (err) => pushToast({ title: `Failed: ${(err as Error).message}`, tone: "error" }),
  });

  const members = (membersQuery.data ?? []).filter((m) => m.principalType === "user");

  if (membersQuery.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">
        Members · {members.length}
      </h3>
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No user members. Use the company invite flow to add users.
        </p>
      ) : (
        <ul className="space-y-2">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
            >
              <div>
                <div className="font-medium">
                  {m.userName ?? m.userEmail ?? m.principalId.slice(0, 8)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {m.userEmail ?? m.principalId} · {m.membershipRole ?? "member"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={m.status === "active" ? "default" : "secondary"}>{m.status}</Badge>
                {m.isInstanceAdmin ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Demote from instance admin"
                    onClick={() => demoteMut.mutate(m.principalId)}
                    disabled={demoteMut.isPending}
                  >
                    <ShieldOff className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Promote to instance admin"
                    onClick={() => promoteMut.mutate(m.principalId)}
                    disabled={promoteMut.isPending}
                  >
                    <Shield className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agents tab
// ---------------------------------------------------------------------------

function AgentsTab({ companyId }: { companyId: string }) {
  const agentsQuery = useQuery({
    queryKey: queryKeys.admin.companyAgents(companyId),
    queryFn: () => adminApi.listCompanyAgents(companyId),
  });

  const agents: Agent[] = agentsQuery.data ?? [];

  if (agentsQuery.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">
        Agents · {agents.length}
      </h3>
      {agents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agents in this company.</p>
      ) : (
        <ul className="space-y-2">
          {agents.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
            >
              <div>
                <div className="font-medium">{a.name}</div>
                <div className="text-xs text-muted-foreground">
                  {a.adapterType} · {a.id.slice(0, 8)}
                </div>
              </div>
              <Badge variant={a.status === "active" ? "default" : "secondary"}>
                {a.status}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
