import { useEffect, useState } from "react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/context/ToastContext";
import { api } from "@/api/client";
import { pluginsApi } from "@/api/plugins";

const BRIDGE_BASE = "/plugins/neocompany-tools/bridge";

interface PlatformConfig {
  googleClientId: string;
  googleClientSecretRef: string | null;
  googleRefreshTokenRef: string | null;
  googlePsiApiKeyRef: string | null;
  openPageRankApiKeyRef: string | null;
  resendApiKeyRef: string | null;
  resendDefaultFrom: string;
}

export function ToolsConfigSection() {
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => {
    setBreadcrumbs([{ label: "Admin" }, { label: "Tools Config" }]);
  }, [setBreadcrumbs]);

  // Check if plugin is installed
  const pluginsQuery = useQuery({
    queryKey: ["plugins"],
    queryFn: () => pluginsApi.list(),
  });
  const neoPlugin = (pluginsQuery.data ?? []).find(
    (p: { pluginKey: string }) => p.pluginKey === "neocompany-tools",
  );

  if (pluginsQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!neoPlugin) {
    return (
      <div className="max-w-3xl rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">
          The <strong>neocompany-tools</strong> plugin is not installed.
          Install it from the Plugins tab first.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Tools & Platform Config</h1>
        <p className="text-sm text-muted-foreground">
          Platform credentials and tool allowlist for neocompany-tools
        </p>
      </div>
      <PlatformCredentials />
      <ToolAllowlist />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Platform credentials form
// ---------------------------------------------------------------------------

function PlatformCredentials() {
  const { pushToast } = useToast();
  const configQuery = useQuery({
    queryKey: ["admin", "platform-config"],
    queryFn: () => api.get<PlatformConfig>(`${BRIDGE_BASE}/platform`),
  });

  const [form, setForm] = useState<Partial<PlatformConfig>>({});

  // Sync form with fetched data
  const cfg = configQuery.data;
  const field = (key: keyof PlatformConfig) =>
    form[key] !== undefined ? (form[key] as string) : (cfg?.[key] as string) ?? "";

  const saveMut = useMutation({
    mutationFn: () => api.put(`${BRIDGE_BASE}/platform`, form),
    onSuccess: () => {
      pushToast({ title: "Platform credentials saved", tone: "success" });
      setForm({});
      configQuery.refetch();
    },
    onError: (err) => pushToast({ title: `Save failed: ${(err as Error).message}`, tone: "error" }),
  });

  if (configQuery.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <h2 className="text-sm font-semibold">Platform provider credentials</h2>
      <div className="grid grid-cols-2 gap-3 text-sm">
        {([
          ["googleClientId", "Google OAuth Client ID"],
          ["googleClientSecretRef", "Google Client Secret (ref)"],
          ["googleRefreshTokenRef", "Google Refresh Token (ref)"],
          ["googlePsiApiKeyRef", "PageSpeed API key (ref)"],
          ["openPageRankApiKeyRef", "Open PageRank key (ref)"],
          ["resendApiKeyRef", "Resend API key (ref)"],
          ["resendDefaultFrom", "Resend default From"],
        ] as [keyof PlatformConfig, string][]).map(([key, label]) => (
          <div key={key} className="space-y-1">
            <Label className="text-xs">{label}</Label>
            <Input
              value={field(key)}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="text-xs"
              placeholder={key.endsWith("Ref") ? "secret_ref_uuid" : ""}
            />
          </div>
        ))}
      </div>
      <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
        {saveMut.isPending ? "Saving…" : "Save platform credentials"}
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tool allowlist
// ---------------------------------------------------------------------------

function ToolAllowlist() {
  const { pushToast } = useToast();
  const qc = useQueryClient();

  const enabledQuery = useQuery({
    queryKey: ["admin", "enabled-tools"],
    queryFn: () => api.get<{ enabled: string[] | null }>(`${BRIDGE_BASE}/enabled-tools`),
  });

  const toolsQuery = useQuery({
    queryKey: ["admin", "all-tools"],
    queryFn: () => api.get<{ name: string; displayName: string }[]>("/plugins/tools"),
  });

  const neoTools = (toolsQuery.data ?? []).filter((t: { name: string }) =>
    t.name.startsWith("neocompany-tools:"),
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);

  // Sync from server
  if (!initialized && enabledQuery.data) {
    const enabled = enabledQuery.data.enabled;
    if (enabled) {
      setSelected(new Set(enabled));
    } else {
      // null = all enabled
      setSelected(new Set(neoTools.map((t: { name: string }) => t.name.replace("neocompany-tools:", ""))));
    }
    setInitialized(true);
  }

  const saveMut = useMutation({
    mutationFn: () =>
      api.post(`${BRIDGE_BASE}/enabled-tools`, { enabled: Array.from(selected) }),
    onSuccess: () => {
      pushToast({ title: "Tool allowlist saved", tone: "success" });
      qc.invalidateQueries({ queryKey: ["admin", "enabled-tools"] });
    },
    onError: (err) => pushToast({ title: `Save failed: ${(err as Error).message}`, tone: "error" }),
  });

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (enabledQuery.isLoading || toolsQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Enabled tools allowlist</h2>
          <p className="text-xs text-muted-foreground">
            Only checked tools can be called by any agent on any company.
          </p>
        </div>
        <Badge variant="secondary">{selected.size} / {neoTools.length}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-1 text-sm">
        {neoTools.map((t: { name: string; displayName: string }) => {
          const bare = t.name.replace("neocompany-tools:", "");
          return (
            <label key={bare} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(bare)}
                onChange={() => toggle(bare)}
                className="rounded"
              />
              <span className="text-xs">{bare}</span>
            </label>
          );
        })}
      </div>

      <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
        {saveMut.isPending ? "Saving…" : "Save allowlist"}
      </Button>
    </section>
  );
}
