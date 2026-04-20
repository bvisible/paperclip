import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Plus, X } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pluginsApi } from "@/api/plugins";

type ProviderKey = "linkedin" | "facebook" | "instagram";

interface ChannelRef {
  provider: ProviderKey;
  channelKey: string;
  accountName?: string;
}

interface PublishingSlot {
  dayOfWeek: number;
  hour: number;
  minute?: number;
}

interface EditorialStrategy {
  postsPerWeek: Record<string, number>;
  leadTimeWeeks: number;
  queueSize: number;
  publishingSlots: PublishingSlot[];
  voiceGuidelines?: string;
  defaultChannels: ChannelRef[];
  updatedAt?: string;
}

interface ChannelRecord {
  provider: ProviderKey;
  accountId: string;
  accountName: string;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function defaultStrategy(): EditorialStrategy {
  return {
    postsPerWeek: {},
    leadTimeWeeks: 2,
    queueSize: 5,
    publishingSlots: [
      { dayOfWeek: 2, hour: 10 }, // Tue 10:00
      { dayOfWeek: 4, hour: 16 }, // Thu 16:00
    ],
    voiceGuidelines: "",
    defaultChannels: [],
  };
}

export function ContentStrategy() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const qc = useQueryClient();
  const [strategy, setStrategy] = useState<EditorialStrategy>(defaultStrategy);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Content" }, { label: "Strategy" }]);
  }, [setBreadcrumbs]);

  const pluginsQuery = useQuery({
    queryKey: ["plugins"],
    queryFn: () => pluginsApi.list(),
  });
  const neoPlugin = (pluginsQuery.data ?? []).find(
    (p: { pluginKey: string }) => p.pluginKey === "neocompany-tools",
  );
  const pluginId = neoPlugin?.id;

  const strategyQuery = useQuery({
    queryKey: ["editorial-strategy", selectedCompanyId],
    queryFn: async (): Promise<EditorialStrategy | null> => {
      if (!pluginId || !selectedCompanyId) return null;
      const res = await pluginsApi.bridgeGetData(
        pluginId,
        "strategyGet",
        { companyId: selectedCompanyId },
        selectedCompanyId,
      );
      return ((res as { data: { strategy: EditorialStrategy | null } }).data?.strategy) ?? null;
    },
    enabled: !!pluginId && !!selectedCompanyId,
    refetchOnWindowFocus: false,
  });

  const channelsQuery = useQuery({
    queryKey: ["social-channels", selectedCompanyId],
    queryFn: async (): Promise<ChannelRecord[]> => {
      if (!pluginId || !selectedCompanyId) return [];
      const res = await pluginsApi.bridgeGetData(
        pluginId,
        "channelsList",
        { companyId: selectedCompanyId },
        selectedCompanyId,
      );
      return (res as { data: { channels: ChannelRecord[] } }).data?.channels ?? [];
    },
    enabled: !!pluginId && !!selectedCompanyId,
    refetchOnWindowFocus: false,
  });

  // Hydrate from server once
  useEffect(() => {
    if (loaded) return;
    if (strategyQuery.data) {
      setStrategy(strategyQuery.data);
    }
    if (strategyQuery.data !== undefined) setLoaded(true);
  }, [strategyQuery.data, loaded]);

  const connectedChannels = channelsQuery.data ?? [];
  const channelKeyOf = (c: ChannelRecord) => `${c.provider}:${c.accountId}`;

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!pluginId || !selectedCompanyId) throw new Error("Plugin not available");
      return pluginsApi.bridgePerformAction(
        pluginId,
        "setEditorialStrategy",
        { companyId: selectedCompanyId, strategy },
        selectedCompanyId,
      );
    },
    onSuccess: () => {
      pushToast({ title: "Strategy saved", tone: "success" });
      qc.invalidateQueries({ queryKey: ["editorial-strategy", selectedCompanyId] });
    },
    onError: (err) => pushToast({ title: `Save failed: ${(err as Error).message}`, tone: "error" }),
  });

  const toggleDefaultChannel = (c: ChannelRecord) => {
    const key = channelKeyOf(c);
    const exists = strategy.defaultChannels.some((d) => d.channelKey === key);
    setStrategy({
      ...strategy,
      defaultChannels: exists
        ? strategy.defaultChannels.filter((d) => d.channelKey !== key)
        : [
            ...strategy.defaultChannels,
            { provider: c.provider, channelKey: key, accountName: c.accountName },
          ],
      postsPerWeek: exists
        ? Object.fromEntries(Object.entries(strategy.postsPerWeek).filter(([k]) => k !== key))
        : { ...strategy.postsPerWeek, [key]: strategy.postsPerWeek[key] ?? 2 },
    });
  };

  const addSlot = () =>
    setStrategy({
      ...strategy,
      publishingSlots: [...strategy.publishingSlots, { dayOfWeek: 1, hour: 9 }],
    });
  const removeSlot = (idx: number) =>
    setStrategy({
      ...strategy,
      publishingSlots: strategy.publishingSlots.filter((_, i) => i !== idx),
    });
  const updateSlot = (idx: number, patch: Partial<PublishingSlot>) =>
    setStrategy({
      ...strategy,
      publishingSlots: strategy.publishingSlots.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    });

  const totalWeeklyPosts = useMemo(
    () => Object.values(strategy.postsPerWeek).reduce((a, b) => a + b, 0),
    [strategy.postsPerWeek],
  );

  if (pluginsQuery.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!neoPlugin) {
    return (
      <div className="max-w-3xl p-6">
        <p className="text-muted-foreground">
          Install the <strong>neocompany-tools</strong> plugin to configure the editorial strategy.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Editorial strategy</h1>
        <p className="text-sm text-muted-foreground">
          Tell Pixel how often to post on each channel and how many drafts to keep in review. Pixel
          prepares posts in advance; you approve them in the Approvals tab.
        </p>
      </div>

      {connectedChannels.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-sm">
          Connect a social channel first in{" "}
          <a href="/content/channels" className="underline">
            Channels
          </a>
          {" "}before defining the strategy.
        </div>
      ) : (
        <div className="space-y-5">
          {/* Channels + weekly target */}
          <section className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h2 className="text-sm font-semibold">Channels &amp; weekly target</h2>
            <p className="text-xs text-muted-foreground">
              Check each channel you want Pixel to post on. Set how many posts per week.
            </p>
            <div className="space-y-2">
              {connectedChannels.map((c) => {
                const key = channelKeyOf(c);
                const active = strategy.defaultChannels.some((d) => d.channelKey === key);
                const perWeek = strategy.postsPerWeek[key] ?? 0;
                return (
                  <div
                    key={key}
                    className={`flex items-center gap-3 rounded-md border px-3 py-2 ${
                      active ? "border-primary bg-primary/5" : "border-border bg-background"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleDefaultChannel(c)}
                      className="h-4 w-4 rounded accent-primary"
                    />
                    <div className="flex-1 text-sm">
                      <span className="font-medium capitalize">{c.provider}</span>{" "}
                      <span className="text-muted-foreground">— {c.accountName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={20}
                        value={perWeek}
                        onChange={(e) =>
                          setStrategy({
                            ...strategy,
                            postsPerWeek: {
                              ...strategy.postsPerWeek,
                              [key]: Math.max(0, Math.min(20, Number(e.target.value) || 0)),
                            },
                          })
                        }
                        disabled={!active}
                        className="w-16"
                      />
                      <span className="text-xs text-muted-foreground">/week</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              Total: {totalWeeklyPosts} posts / week
            </p>
          </section>

          {/* Lead time + queue */}
          <section className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h2 className="text-sm font-semibold">Queue</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Lead time (weeks of drafts in pipeline)</Label>
                <Input
                  type="number"
                  min={1}
                  max={8}
                  value={strategy.leadTimeWeeks}
                  onChange={(e) =>
                    setStrategy({
                      ...strategy,
                      leadTimeWeeks: Math.max(1, Math.min(8, Number(e.target.value) || 1)),
                    })
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Posts awaiting your approval</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={strategy.queueSize}
                  onChange={(e) =>
                    setStrategy({
                      ...strategy,
                      queueSize: Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                    })
                  }
                  className="mt-1"
                />
              </div>
            </div>
          </section>

          {/* Publishing slots */}
          <section className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Publishing slots</h2>
              <button
                onClick={addSlot}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Plus className="h-3 w-3" /> Add slot
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Preferred days and times for publishing. Pixel aligns proposed dates with these slots.
            </p>
            <div className="space-y-2">
              {strategy.publishingSlots.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={s.dayOfWeek}
                    onChange={(e) => updateSlot(i, { dayOfWeek: Number(e.target.value) })}
                    className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  >
                    {DAY_LABELS.map((label, idx) => (
                      <option key={idx} value={idx}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={s.hour}
                    onChange={(e) => updateSlot(i, { hour: Math.max(0, Math.min(23, Number(e.target.value) || 0)) })}
                    className="w-20"
                  />
                  <span className="text-xs text-muted-foreground">h</span>
                  <button
                    onClick={() => removeSlot(i)}
                    className="rounded-md p-1 text-destructive hover:bg-destructive/10"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Voice guidelines */}
          <section className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h2 className="text-sm font-semibold">Voice &amp; guidelines</h2>
            <textarea
              value={strategy.voiceGuidelines ?? ""}
              onChange={(e) => setStrategy({ ...strategy, voiceGuidelines: e.target.value })}
              rows={4}
              placeholder="e.g. Warm but professional, French vouvoiement, light emoji use, avoid jargon."
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
            />
          </section>

          <div className="flex items-center justify-end gap-2">
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              <Save className="mr-1 h-4 w-4" />
              {saveMut.isPending ? "Saving…" : "Save strategy"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
