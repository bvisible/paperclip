import { useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link2, Linkedin, Facebook, Instagram, RefreshCw, Trash2, Check } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import { Button } from "@/components/ui/button";
import { pluginsApi } from "@/api/plugins";

type ProviderKey = "linkedin" | "facebook" | "instagram";

interface ChannelRecord {
  provider: ProviderKey;
  accountId: string;
  accountName: string;
  iconUrl?: string;
  expiresAt: number | null;
  scopes?: string[];
  connectedAt: string;
  refreshedAt?: string;
}

interface ProviderMeta {
  key: ProviderKey;
  displayName: string;
  recommendedFeedDimensions: { width: number; height: number };
}

interface ChannelsListResponse {
  channels: ChannelRecord[];
  providers: ProviderMeta[];
}

const PROVIDER_VISUALS: Record<ProviderKey, { icon: React.ComponentType<{ className?: string }>; accent: string }> = {
  linkedin: { icon: Linkedin, accent: "text-[#0A66C2]" },
  facebook: { icon: Facebook, accent: "text-[#1877F2]" },
  instagram: { icon: Instagram, accent: "text-[#E4405F]" },
};

export function ContentChannels() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const qc = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([{ label: "Content" }, { label: "Channels" }]);
  }, [setBreadcrumbs]);

  // Surface OAuth redirect outcomes coming from ?connected=... / ?oauth_error=...
  useEffect(() => {
    const url = new URL(window.location.href);
    const connected = url.searchParams.get("connected");
    const errorReason = url.searchParams.get("oauth_error");
    const account = url.searchParams.get("account");
    if (connected) {
      pushToast({
        title: `Connected to ${connected}${account ? ` as ${decodeURIComponent(account)}` : ""}`,
        tone: "success",
      });
      qc.invalidateQueries({ queryKey: ["social-channels", selectedCompanyId] });
    }
    if (errorReason) {
      pushToast({ title: `OAuth failed: ${errorReason}`, tone: "error" });
    }
    if (connected || errorReason) {
      url.searchParams.delete("connected");
      url.searchParams.delete("account");
      url.searchParams.delete("oauth_error");
      window.history.replaceState({}, "", url.toString());
    }
  }, [pushToast, qc, selectedCompanyId]);

  const pluginsQuery = useQuery({
    queryKey: ["plugins"],
    queryFn: () => pluginsApi.list(),
  });
  const neoPlugin = (pluginsQuery.data ?? []).find(
    (p: { pluginKey: string }) => p.pluginKey === "neocompany-tools",
  );
  const pluginId = neoPlugin?.id;

  const channelsQuery = useQuery({
    queryKey: ["social-channels", selectedCompanyId],
    queryFn: async (): Promise<ChannelsListResponse> => {
      if (!pluginId || !selectedCompanyId) return { channels: [], providers: [] };
      const res = await pluginsApi.bridgeGetData(
        pluginId,
        "channelsList",
        { companyId: selectedCompanyId },
        selectedCompanyId,
      );
      return (res as { data: ChannelsListResponse }).data ?? { channels: [], providers: [] };
    },
    enabled: !!pluginId && !!selectedCompanyId,
    refetchOnWindowFocus: false,
  });

  const connectMut = useMutation({
    mutationFn: async (provider: ProviderKey) => {
      if (!pluginId || !selectedCompanyId) throw new Error("Plugin not available");
      const res = await pluginsApi.bridgePerformAction(
        pluginId,
        "channelConnectStart",
        {
          companyId: selectedCompanyId,
          provider,
          publicUrl: window.location.origin,
          returnTo: window.location.pathname,
        },
        selectedCompanyId,
      );
      const url = (res as { data: { url: string } }).data?.url;
      if (!url) throw new Error("No OAuth URL returned");
      // Navigate the whole page so the OAuth redirect dance works; the
      // provider will eventually redirect back to our callback which
      // redirects back here with ?connected=...
      window.location.href = url;
    },
    onError: (err) => pushToast({ title: `Connect failed: ${(err as Error).message}`, tone: "error" }),
  });

  const disconnectMut = useMutation({
    mutationFn: async (args: { provider: ProviderKey; accountId: string }) => {
      if (!pluginId || !selectedCompanyId) throw new Error("Plugin not available");
      return pluginsApi.bridgePerformAction(
        pluginId,
        "channelDisconnect",
        { companyId: selectedCompanyId, ...args },
        selectedCompanyId,
      );
    },
    onSuccess: () => {
      pushToast({ title: "Channel disconnected", tone: "success" });
      qc.invalidateQueries({ queryKey: ["social-channels", selectedCompanyId] });
    },
    onError: (err) => pushToast({ title: `Disconnect failed: ${(err as Error).message}`, tone: "error" }),
  });

  const refreshMut = useMutation({
    mutationFn: async (args: { provider: ProviderKey; accountId: string }) => {
      if (!pluginId || !selectedCompanyId) throw new Error("Plugin not available");
      return pluginsApi.bridgePerformAction(
        pluginId,
        "channelRefresh",
        { companyId: selectedCompanyId, ...args },
        selectedCompanyId,
      );
    },
    onSuccess: () => {
      pushToast({ title: "Token refreshed", tone: "success" });
      qc.invalidateQueries({ queryKey: ["social-channels", selectedCompanyId] });
    },
    onError: (err) => pushToast({ title: `Refresh failed: ${(err as Error).message}`, tone: "error" }),
  });

  const byProvider = useMemo(() => {
    const map = new Map<ProviderKey, ChannelRecord[]>();
    for (const c of channelsQuery.data?.channels ?? []) {
      const list = map.get(c.provider) ?? [];
      list.push(c);
      map.set(c.provider, list);
    }
    return map;
  }, [channelsQuery.data]);

  const providers = channelsQuery.data?.providers ?? [];

  if (pluginsQuery.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!neoPlugin) {
    return (
      <div className="max-w-3xl p-6">
        <p className="text-muted-foreground">
          Install the <strong>neocompany-tools</strong> plugin to connect social channels.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Social channels</h1>
        <p className="text-sm text-muted-foreground">
          Connect your LinkedIn, Facebook and Instagram accounts so Pixel can prepare and publish
          posts. Tokens are stored per company and never leave the backend.
        </p>
      </div>

      {providers.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          No providers are available. Ask a platform admin to configure at least one OAuth app in
          the plugin's platform settings.
        </div>
      ) : (
        <div className="space-y-4">
          {providers.map((p) => {
            const connected = byProvider.get(p.key) ?? [];
            const Visual = PROVIDER_VISUALS[p.key];
            const Icon = Visual.icon;
            return (
              <div key={p.key} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-start gap-4 p-4">
                  <div className={`shrink-0 ${Visual.accent}`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold">{p.displayName}</h2>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        feed: {p.recommendedFeedDimensions.width}×{p.recommendedFeedDimensions.height}
                      </span>
                    </div>
                    {connected.length === 0 ? (
                      <p className="text-xs text-muted-foreground mt-1">Not connected yet.</p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">
                        {connected.length} account{connected.length > 1 ? "s" : ""} connected
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => connectMut.mutate(p.key)}
                    disabled={connectMut.isPending}
                  >
                    <Link2 className="mr-1.5 h-3.5 w-3.5" />
                    {connected.length > 0 ? "Add another" : "Connect"}
                  </Button>
                </div>

                {connected.length > 0 && (
                  <div className="border-t border-border divide-y divide-border">
                    {connected.map((c) => (
                      <ConnectedRow
                        key={c.accountId}
                        channel={c}
                        onDisconnect={() =>
                          disconnectMut.mutate({ provider: c.provider, accountId: c.accountId })
                        }
                        onRefresh={() =>
                          refreshMut.mutate({ provider: c.provider, accountId: c.accountId })
                        }
                        refreshing={refreshMut.isPending}
                        disconnecting={disconnectMut.isPending}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConnectedRow({
  channel,
  onDisconnect,
  onRefresh,
  refreshing,
  disconnecting,
}: {
  channel: ChannelRecord;
  onDisconnect: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  disconnecting: boolean;
}) {
  const tokenFresh = channel.expiresAt == null ? true : channel.expiresAt > Date.now() + 60_000;
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="shrink-0 h-8 w-8 rounded-full bg-muted flex items-center justify-center overflow-hidden">
        {channel.iconUrl ? (
          <img src={channel.iconUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Check className="h-4 w-4 text-emerald-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{channel.accountName}</p>
        <p className="text-[11px] text-muted-foreground truncate">
          {channel.accountId}
          {" · "}
          {tokenFresh ? (
            <span className="text-emerald-600">token active</span>
          ) : (
            <span className="text-amber-600">token expired</span>
          )}
          {channel.expiresAt ? ` (expires ${new Date(channel.expiresAt).toLocaleDateString()})` : ""}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onRefresh}
        disabled={refreshing}
        title="Refresh token"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          if (globalThis.confirm("Disconnect this channel? Scheduled posts using it will fail.")) {
            onDisconnect();
          }
        }}
        disabled={disconnecting}
        className="text-destructive hover:text-destructive"
        title="Disconnect"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
