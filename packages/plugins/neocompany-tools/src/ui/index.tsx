import type { PluginPageProps } from "@paperclipai/plugin-sdk/ui";
import { usePluginData, usePluginAction, useHostContext } from "@paperclipai/plugin-sdk/ui";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types — mirror the shape returned by the worker's data handlers
// ---------------------------------------------------------------------------

interface ToolConfigField {
  name: string;
  label: string;
  type: "string" | "url" | "number" | "boolean" | "enum";
  description?: string;
  default?: string | number | boolean;
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
}

interface ToolConfigSchemaView {
  title: string;
  description?: string;
  fields: ToolConfigField[];
}

interface ToolMetadataView {
  name: string;
  label: string;
  category: string;
  defaultEnabled: boolean;
  internal: boolean;
  connectionTrigger?: "wordpress" | "google" | null;
  allowedRoles?: string[];
  configSchema?: ToolConfigSchemaView | null;
}

interface ToolCatalog {
  toolCount: number;
  categories: Record<string, { label: string; tools: ToolMetadataView[] }>;
}

interface ToolConfigResponse {
  config: Record<string, unknown>;
}

interface AccessState {
  companyId?: string;
  categoryToggles: Record<string, boolean>;
}

interface ConfigSummary {
  googleOAuthConfigured: boolean;
  googlePsiKeyConfigured: boolean;
  resendConfigured: boolean;
  defaultFromAddress: string;
}

interface EmailAccountView {
  id: string;
  address: string;
  label: string | null;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  pollingEnabled: boolean;
  pollIntervalMin: number;
  lastSeenUid: number;
  status: "active" | "paused" | "error";
  lastError: string | null;
  allowedAgents: string[];
}

interface EmailAccountsResponse {
  companyId?: string;
  accounts: EmailAccountView[];
}

interface CompanyConfigView {
  gscSiteUrl?: string;
  ga4PropertyId?: string;
  wordpressSiteUrl?: string;
  wordpressUsername?: string;
  wordpressAppPasswordRef?: string;
}

interface CompanyConfigResponse {
  config: CompanyConfigView;
}

interface PlatformConfigView {
  googleClientId: string;
  googleClientSecretRef: string | null;
  googleRefreshTokenRef: string | null;
  googlePsiApiKeyRef: string | null;
  openPageRankApiKeyRef: string | null;
  resendApiKeyRef: string | null;
  resendDefaultFrom: string;
}

interface EnabledToolsView {
  enabled: string[] | null;
}

// ---------------------------------------------------------------------------
// Layout tokens — use inline styles so the plugin stays self-contained and
// doesn't ship any CSS-in-JS runtime. These values follow the Paperclip UI
// neutral palette (light + dark variables).
// ---------------------------------------------------------------------------

const tokens = {
  pagePad: 24,
  cardBg: "var(--card, #ffffff)",
  cardBorder: "1px solid var(--border, #e5e7eb)",
  cardRadius: 10,
  mutedText: "var(--muted-foreground, #64748b)",
  primary: "var(--primary, #2563eb)",
  danger: "var(--destructive, #dc2626)",
  success: "var(--success, #16a34a)",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif',
};

// ---------------------------------------------------------------------------
// Small UI primitives
// ---------------------------------------------------------------------------

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: tokens.cardBg,
        border: tokens.cardBorder,
        borderRadius: tokens.cardRadius,
        padding: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Pill({ tone, children }: { tone: "ok" | "warn" | "muted"; children: React.ReactNode }) {
  const bg =
    tone === "ok"
      ? "rgba(22, 163, 74, 0.12)"
      : tone === "warn"
        ? "rgba(245, 158, 11, 0.14)"
        : "rgba(100, 116, 139, 0.14)";
  const color =
    tone === "ok" ? tokens.success : tone === "warn" ? "#b45309" : tokens.mutedText;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: bg,
        color,
        textTransform: "uppercase",
        letterSpacing: 0.3,
      }}
    >
      {children}
    </span>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          width: 36,
          height: 20,
          borderRadius: 999,
          background: checked ? tokens.primary : "rgba(100, 116, 139, 0.3)",
          position: "relative",
          transition: "background 120ms",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 120ms",
            boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
          }}
        />
      </span>
      <input
        type="checkbox"
        style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label && <span style={{ fontSize: 13, color: "var(--foreground, #111)" }}>{label}</span>}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Brand Templates section
// ---------------------------------------------------------------------------

interface TemplateView {
  id: string;
  name: string;
  description?: string;
  width: number;
  height: number;
  isDefault: boolean;
  createdAt: string;
}

function BrandTemplatesSection({ companyId }: { companyId: string }) {
  const templateResp = usePluginData<{ companyId: string; templates: TemplateView[] }>("templateList", companyId ? { companyId } : undefined);
  const templateSave = usePluginAction("templateSave");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("instagram-square");
  const [saving, setSaving] = useState(false);

  const templates: TemplateView[] = templateResp.data?.templates ?? [];

  const PRESETS = [
    { key: "instagram-square", label: "Instagram square (1080×1080)", w: 1080, h: 1080 },
    { key: "instagram-portrait", label: "Instagram portrait (1080×1350)", w: 1080, h: 1350 },
    { key: "instagram-story", label: "Instagram story (1080×1920)", w: 1080, h: 1920 },
    { key: "facebook-post", label: "Facebook post (1200×630)", w: 1200, h: 630 },
    { key: "linkedin-post", label: "LinkedIn post (1200×627)", w: 1200, h: 627 },
    { key: "twitter-post", label: "Twitter post (1200×675)", w: 1200, h: 675 },
    { key: "youtube-thumbnail", label: "YouTube thumbnail (1280×720)", w: 1280, h: 720 },
  ];

  const onSave = useCallback(async () => {
    if (!name.trim() || !companyId) return;
    setSaving(true);
    const match = PRESETS.find((p) => p.key === preset);
    try {
      await templateSave({
        companyId,
        data: {
          name: name.trim(),
          width: match?.w ?? 1080,
          height: match?.h ?? 1080,
          config: {
            logo: { position: "bottom-right", scale: 15, opacity: 90 },
            textZones: [],
            filters: { brightness: 0, contrast: 0, saturation: 0, blur: 0 },
            overlay: { color: "#000000", opacity: 0 },
            border: { width: 0, color: "#ffffff", radius: 0 },
            backgroundColor: "#ffffff",
            imageFit: "cover",
          },
          isDefault: false,
        },
      });
      setName("");
      setShowForm(false);
      templateResp.refresh();
    } catch (err) {
      console.error("templateSave failed:", err);
    } finally {
      setSaving(false);
    }
  }, [name, preset, companyId, templateSave, templateResp]);

  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, color: tokens.mutedText, margin: 0 }}>
          Brand templates {templates.length > 0 ? `· ${templates.length}` : ""}
        </h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{
            background: showForm ? "rgba(100, 116, 139, 0.14)" : tokens.primary,
            color: showForm ? "var(--foreground, #111)" : "#fff",
            border: tokens.cardBorder,
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {showForm ? "Cancel" : "Create template"}
        </button>
      </div>

      {showForm && (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ color: tokens.mutedText, fontSize: 12 }}>Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Instagram promo"
                style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, fontSize: 13 }}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ color: tokens.mutedText, fontSize: 12 }}>Dimension preset</span>
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
                style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, fontSize: 13 }}
              >
                {PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
            </label>
            <button
              onClick={onSave}
              disabled={saving || !name.trim()}
              style={{
                background: tokens.primary,
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "6px 12px",
                fontSize: 13,
                cursor: saving ? "wait" : "pointer",
                opacity: saving || !name.trim() ? 0.5 : 1,
              }}
            >
              {saving ? "Saving…" : "Create"}
            </button>
          </div>
        </Card>
      )}

      {templates.length === 0 && !showForm ? (
        <Card>
          <p style={{ color: tokens.mutedText, fontSize: 13, margin: 0 }}>
            No brand templates yet. Create one to apply logos, text, and filters to images.
          </p>
        </Card>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {templates.map((t) => (
            <Card key={t.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                  <div style={{ color: tokens.mutedText, fontSize: 12 }}>
                    {t.width}×{t.height} · {t.description || "No description"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {t.isDefault && <Pill tone="ok">default</Pill>}
                  <code style={{ fontSize: 11, color: tokens.mutedText }}>{t.id.slice(0, 8)}</code>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

export function SettingsPage(_props: PluginPageProps) {
  const host = useHostContext();
  const companyId = host?.companyId ?? "";

  const catalogResp = usePluginData<ToolCatalog>("toolCatalog", {});
  const accessResp = usePluginData<AccessState>("accessState", { companyId });
  const configResp = usePluginData<ConfigSummary>("configSummary", {});
  const emailAccountsResp = usePluginData<EmailAccountsResponse>("emailAccounts", { companyId });
  const companyConfigResp = usePluginData<CompanyConfigResponse>("companyConfig", { companyId });
  const setCategoryEnabled = usePluginAction("setCategoryEnabled");
  const emailAccountUpsert = usePluginAction("emailAccountUpsert");
  const emailAccountDelete = usePluginAction("emailAccountDelete");
  const emailAccountTest = usePluginAction("emailAccountTest");
  const setToolConfig = usePluginAction("setToolConfig");
  const setCompanyConfigAction = usePluginAction("setCompanyConfig");

  // ── Admin bridge (server-side gate) ──────────────────────────────
  // These fetch calls go DIRECTLY to the Paperclip HTTP API with the
  // user's session cookie — they bypass the plugin worker on purpose.
  // The server routes use `assertInstanceAdmin` for writes so a non-admin
  // can never toggle the platform allowlist even by poking curl.
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [platformCfg, setPlatformCfg] = useState<PlatformConfigView | null>(null);
  const [enabledTools, setEnabledTools] = useState<string[] | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [adminRes, platformRes, enabledRes] = await Promise.all([
          fetch("/api/plugins/neocompany-tools/bridge/am-i-admin", { credentials: "include" }),
          fetch("/api/plugins/neocompany-tools/bridge/platform", { credentials: "include" }),
          fetch("/api/plugins/neocompany-tools/bridge/enabled-tools", { credentials: "include" }),
        ]);
        if (cancelled) return;
        if (adminRes.ok) {
          const json = (await adminRes.json()) as { isAdmin: boolean };
          setIsAdmin(Boolean(json.isAdmin));
        } else {
          setIsAdmin(false);
        }
        if (platformRes.ok) {
          setPlatformCfg((await platformRes.json()) as PlatformConfigView);
        }
        if (enabledRes.ok) {
          const json = (await enabledRes.json()) as EnabledToolsView;
          setEnabledTools(json.enabled);
        }
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);
  const [configDrawer, setConfigDrawer] = useState<ToolMetadataView | null>(null);
  const [pendingToggle, setPendingToggle] = useState<string | null>(null);
  const [pendingAccountAction, setPendingAccountAction] = useState<string | null>(null);
  const [accountTestResult, setAccountTestResult] = useState<{ id: string; ok: boolean; message: string } | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState({
    address: "",
    label: "",
    imapHost: "",
    imapPort: 993,
    imapUser: "",
    imapPassRef: "",
    pollIntervalMin: 5,
    pollingEnabled: true,
  });

  const refreshAll = useCallback(() => {
    catalogResp.refresh();
    accessResp.refresh();
    configResp.refresh();
    emailAccountsResp.refresh();
  }, [catalogResp, accessResp, configResp, emailAccountsResp]);

  const catalog = catalogResp.data;
  const access = accessResp.data;
  const config = configResp.data;
  const emailAccounts = emailAccountsResp.data?.accounts ?? [];

  const onToggleCategory = useCallback(
    async (category: string, enabled: boolean) => {
      if (!companyId) return;
      setPendingToggle(category);
      try {
        await setCategoryEnabled({ companyId, category, enabled });
        accessResp.refresh();
      } finally {
        setPendingToggle(null);
      }
    },
    [companyId, setCategoryEnabled, accessResp],
  );

  const onAddAccount = useCallback(async () => {
    if (!companyId || !draft.address || !draft.imapHost) return;
    setPendingAccountAction("add");
    try {
      await emailAccountUpsert({
        companyId,
        address: draft.address,
        label: draft.label || undefined,
        imapHost: draft.imapHost,
        imapPort: Number(draft.imapPort),
        imapUser: draft.imapUser || draft.address,
        imapPassRef: draft.imapPassRef,
        pollIntervalMin: Number(draft.pollIntervalMin),
        pollingEnabled: draft.pollingEnabled,
      });
      setShowAddForm(false);
      setDraft({
        address: "",
        label: "",
        imapHost: "",
        imapPort: 993,
        imapUser: "",
        imapPassRef: "",
        pollIntervalMin: 5,
        pollingEnabled: true,
      });
      emailAccountsResp.refresh();
    } finally {
      setPendingAccountAction(null);
    }
  }, [companyId, draft, emailAccountUpsert, emailAccountsResp]);

  const onDeleteAccount = useCallback(
    async (id: string) => {
      if (!companyId) return;
      setPendingAccountAction(id);
      try {
        await emailAccountDelete({ companyId, id });
        emailAccountsResp.refresh();
      } finally {
        setPendingAccountAction(null);
      }
    },
    [companyId, emailAccountDelete, emailAccountsResp],
  );

  const savePlatformConfig = useCallback(
    async (patch: Partial<PlatformConfigView>) => {
      const res = await fetch("/api/plugins/neocompany-tools/bridge/platform", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        // Re-read from server to avoid optimistic-UI drift
        const next = await fetch("/api/plugins/neocompany-tools/bridge/platform", { credentials: "include" });
        if (next.ok) setPlatformCfg((await next.json()) as PlatformConfigView);
      }
    },
    [],
  );

  const saveEnabledTools = useCallback(async (next: string[]) => {
    const res = await fetch("/api/plugins/neocompany-tools/bridge/enabled-tools", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    if (res.ok) {
      setEnabledTools(next);
      catalogResp.refresh();
    }
  }, [catalogResp]);

  const saveCompanyConfig = useCallback(
    async (patch: Partial<CompanyConfigView>) => {
      if (!companyId) return;
      await setCompanyConfigAction({ companyId, patch });
      companyConfigResp.refresh();
      configResp.refresh();
    },
    [companyId, setCompanyConfigAction, companyConfigResp, configResp],
  );

  const onTestAccount = useCallback(
    async (id: string) => {
      if (!companyId) return;
      setPendingAccountAction(id);
      setAccountTestResult(null);
      try {
        const result = (await emailAccountTest({ companyId, id })) as
          | { ok: true; message: string }
          | { ok: false; error: string };
        setAccountTestResult({
          id,
          ok: result.ok,
          message: result.ok ? result.message : result.error,
        });
      } finally {
        setPendingAccountAction(null);
      }
    },
    [companyId, emailAccountTest],
  );

  return (
    <div
      style={{
        padding: tokens.pagePad,
        fontFamily: tokens.fontFamily,
        maxWidth: 960,
        margin: "0 auto",
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>NeoCompany Tools</h1>
        <p style={{ color: tokens.mutedText, fontSize: 14, marginTop: 4 }}>
          Tools exposed to your agents. Configure per-category toggles and provider
          credentials. Agents only see tools whose category is enabled for this company.
        </p>
      </header>

      {isAdmin === true && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, color: tokens.mutedText, marginBottom: 8 }}>
            Platform settings · super-admin only
          </h2>
          <PlatformSection
            cfg={platformCfg}
            catalog={catalog}
            enabledTools={enabledTools}
            onSaveCfg={savePlatformConfig}
            onSaveEnabled={saveEnabledTools}
          />
        </section>
      )}

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, color: tokens.mutedText, marginBottom: 8 }}>
          Company configuration
        </h2>
        <CompanySection
          cfg={companyConfigResp.data?.config ?? null}
          configSummary={config}
          onSave={saveCompanyConfig}
        />
      </section>

      <section>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, color: tokens.mutedText, margin: 0 }}>
            Tool catalog {catalog ? `· ${catalog.toolCount} tools` : ""}
          </h2>
          <button
            onClick={refreshAll}
            style={{
              background: "transparent",
              border: tokens.cardBorder,
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
              color: "var(--foreground, #111)",
            }}
          >
            Refresh
          </button>
        </div>

        {!catalog ? (
          <Card><p style={{ color: tokens.mutedText, fontSize: 13 }}>Loading tool catalog…</p></Card>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {Object.entries(catalog.categories).map(([key, entry]) => {
              const toggles = access?.categoryToggles ?? {};
              // Default to enabled when the toggle is absent from state.
              const enabled = toggles[key] !== false;
              return (
                <Card key={key}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 10,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{entry.label}</div>
                      <div style={{ color: tokens.mutedText, fontSize: 12 }}>
                        {entry.tools.length} tool{entry.tools.length > 1 ? "s" : ""} ·{" "}
                        {enabled ? "enabled" : "disabled"} for this company
                      </div>
                    </div>
                    <Toggle
                      checked={enabled}
                      disabled={!companyId || pendingToggle === key}
                      onChange={(next) => onToggleCategory(key, next)}
                    />
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: "none",
                      display: "grid",
                      gap: 6,
                      borderTop: tokens.cardBorder,
                      paddingTop: 10,
                    }}
                  >
                    {entry.tools.map((tool) => (
                      <li
                        key={tool.name}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          fontSize: 13,
                        }}
                      >
                        <div>
                          <code
                            style={{
                              background: "rgba(100, 116, 139, 0.14)",
                              padding: "1px 6px",
                              borderRadius: 4,
                              fontSize: 12,
                              marginRight: 8,
                            }}
                          >
                            {tool.name}
                          </code>
                          <span style={{ color: tokens.mutedText }}>{tool.label}</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {tool.internal && <Pill tone="warn">internal</Pill>}
                          {tool.connectionTrigger && (
                            <Pill tone="muted">needs {tool.connectionTrigger}</Pill>
                          )}
                          {tool.allowedRoles && tool.allowedRoles.length > 0 && (
                            <Pill tone="muted">{tool.allowedRoles.join(", ")}</Pill>
                          )}
                          {tool.configSchema && (
                            <button
                              onClick={() => setConfigDrawer(tool)}
                              title={`Configure ${tool.label}`}
                              aria-label={`Configure ${tool.label}`}
                              style={{
                                background: "transparent",
                                border: tokens.cardBorder,
                                borderRadius: 6,
                                padding: "2px 6px",
                                cursor: "pointer",
                                fontSize: 12,
                                color: tokens.mutedText,
                                lineHeight: 1,
                              }}
                            >
                              ⚙
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── Brand Templates section ──────────────────────────────── */}
      <BrandTemplatesSection companyId={companyId} />

      <section style={{ marginTop: 24 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, color: tokens.mutedText, margin: 0 }}>
            Email accounts {emailAccounts.length > 0 ? `· ${emailAccounts.length}` : ""}
          </h2>
          <button
            onClick={() => setShowAddForm((v) => !v)}
            style={{
              background: showAddForm ? "rgba(100, 116, 139, 0.14)" : tokens.primary,
              color: showAddForm ? "var(--foreground, #111)" : "#fff",
              border: tokens.cardBorder,
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {showAddForm ? "Cancel" : "Add account"}
          </button>
        </div>

        {showAddForm && (
          <Card style={{ marginBottom: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, fontSize: 13 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ color: tokens.mutedText, fontSize: 12 }}>Address</span>
                <input
                  type="email"
                  value={draft.address}
                  onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                  placeholder="melvyn@neocompany.ch"
                  style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, background: "transparent", color: "var(--foreground, #111)" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ color: tokens.mutedText, fontSize: 12 }}>Label (optional)</span>
                <input
                  type="text"
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  placeholder="Melvyn inbox"
                  style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, background: "transparent", color: "var(--foreground, #111)" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ color: tokens.mutedText, fontSize: 12 }}>IMAP host</span>
                <input
                  type="text"
                  value={draft.imapHost}
                  onChange={(e) => setDraft({ ...draft, imapHost: e.target.value })}
                  placeholder="imap.gmail.com"
                  style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, background: "transparent", color: "var(--foreground, #111)" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ color: tokens.mutedText, fontSize: 12 }}>IMAP port</span>
                <input
                  type="number"
                  value={draft.imapPort}
                  onChange={(e) => setDraft({ ...draft, imapPort: Number(e.target.value) })}
                  style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, background: "transparent", color: "var(--foreground, #111)" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ color: tokens.mutedText, fontSize: 12 }}>IMAP user (defaults to address)</span>
                <input
                  type="text"
                  value={draft.imapUser}
                  onChange={(e) => setDraft({ ...draft, imapUser: e.target.value })}
                  placeholder={draft.address || "username"}
                  style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, background: "transparent", color: "var(--foreground, #111)" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ color: tokens.mutedText, fontSize: 12 }}>IMAP password — secret ref</span>
                <input
                  type="text"
                  value={draft.imapPassRef}
                  onChange={(e) => setDraft({ ...draft, imapPassRef: e.target.value })}
                  placeholder="secret_ref_uuid"
                  style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, background: "transparent", color: "var(--foreground, #111)" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ color: tokens.mutedText, fontSize: 12 }}>Poll interval (minutes)</span>
                <input
                  type="number"
                  min={1}
                  value={draft.pollIntervalMin}
                  onChange={(e) => setDraft({ ...draft, pollIntervalMin: Number(e.target.value) })}
                  style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, background: "transparent", color: "var(--foreground, #111)" }}
                />
              </label>
              <div style={{ display: "flex", alignItems: "end" }}>
                <Toggle
                  checked={draft.pollingEnabled}
                  onChange={(v) => setDraft({ ...draft, pollingEnabled: v })}
                  label="Polling enabled"
                />
              </div>
            </div>
            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={onAddAccount}
                disabled={!draft.address || !draft.imapHost || !draft.imapPassRef || pendingAccountAction === "add"}
                style={{
                  background: tokens.primary,
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "6px 14px",
                  fontSize: 13,
                  cursor: "pointer",
                  opacity: !draft.address || !draft.imapHost || !draft.imapPassRef ? 0.5 : 1,
                }}
              >
                {pendingAccountAction === "add" ? "Saving…" : "Save account"}
              </button>
            </div>
            <p style={{ marginTop: 10, color: tokens.mutedText, fontSize: 11 }}>
              The IMAP password must already exist as a Paperclip secret. Paste its
              reference UUID here. The poller resolves it on every cycle and never
              caches the value.
            </p>
          </Card>
        )}

        {emailAccounts.length === 0 ? (
          <Card>
            <p style={{ color: tokens.mutedText, fontSize: 13, margin: 0 }}>
              No email accounts configured. Click <strong>Add account</strong> to register one. The
              poller (cron <code>*/5 * * * *</code>) will pick it up on the next cycle.
            </p>
          </Card>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {emailAccounts.map((acc) => {
              const tone = acc.status === "active" ? "ok" : acc.status === "error" ? "warn" : "muted";
              const isPending = pendingAccountAction === acc.id;
              const testFor = accountTestResult?.id === acc.id ? accountTestResult : null;
              return (
                <Card key={acc.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {acc.label || acc.address}
                      </div>
                      <div style={{ color: tokens.mutedText, fontSize: 12, marginTop: 2 }}>
                        {acc.address} · {acc.imapHost}:{acc.imapPort} · poll every {acc.pollIntervalMin} min · UID floor {acc.lastSeenUid}
                      </div>
                      {acc.lastError && (
                        <div style={{ color: tokens.danger, fontSize: 12, marginTop: 4 }}>
                          ⚠ {acc.lastError}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                      <Pill tone={tone}>
                        {acc.status}
                        {!acc.pollingEnabled && " · paused"}
                      </Pill>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => onTestAccount(acc.id)}
                          disabled={isPending}
                          style={{
                            background: "transparent",
                            border: tokens.cardBorder,
                            borderRadius: 6,
                            padding: "3px 8px",
                            fontSize: 11,
                            cursor: "pointer",
                            color: "var(--foreground, #111)",
                          }}
                        >
                          {isPending && !testFor ? "Testing…" : "Test"}
                        </button>
                        <button
                          onClick={() => onDeleteAccount(acc.id)}
                          disabled={isPending}
                          style={{
                            background: "transparent",
                            border: `1px solid ${tokens.danger}`,
                            color: tokens.danger,
                            borderRadius: 6,
                            padding: "3px 8px",
                            fontSize: 11,
                            cursor: "pointer",
                          }}
                        >
                          Pause
                        </button>
                      </div>
                    </div>
                  </div>
                  {testFor && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: 8,
                        borderRadius: 6,
                        background: testFor.ok ? "rgba(22, 163, 74, 0.1)" : "rgba(220, 38, 38, 0.1)",
                        color: testFor.ok ? tokens.success : tokens.danger,
                        fontSize: 12,
                      }}
                    >
                      {testFor.ok ? "✓ " : "✗ "}
                      {testFor.message}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {configDrawer && (
        <ToolConfigDrawer
          tool={configDrawer}
          companyId={companyId}
          onClose={() => setConfigDrawer(null)}
          onSave={async (config) => {
            await setToolConfig({ companyId, toolName: configDrawer.name, config });
            setConfigDrawer(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolConfigDrawer — modal-like drawer rendered over the Settings page for
// editing a tool's per-company config. Loads the current values via
// usePluginData('toolConfig', { companyId, toolName }) and writes them back
// via the setToolConfig action.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PlatformSection — super-admin only. Edits the platform-wide provider
// credentials (Google OAuth, PSI, Resend, Open PageRank, default From) and
// the platform-wide enabled-tools allowlist. Writes go through the
// bridge routes (`PUT /bridge/platform` + `POST /bridge/enabled-tools`)
// which enforce `assertInstanceAdmin`.
// ---------------------------------------------------------------------------

function PlatformSection({
  cfg,
  catalog,
  enabledTools,
  onSaveCfg,
  onSaveEnabled,
}: {
  cfg: PlatformConfigView | null;
  catalog: ToolCatalog | null;
  enabledTools: string[] | null | undefined;
  onSaveCfg: (patch: Partial<PlatformConfigView>) => Promise<void>;
  onSaveEnabled: (next: string[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<PlatformConfigView> | null>(null);
  const [savingCfg, setSavingCfg] = useState(false);
  const [savingEnabled, setSavingEnabled] = useState(false);
  const [localEnabled, setLocalEnabled] = useState<string[] | null>(null);

  // Hydrate the draft from the server response once.
  if (!draft && cfg) {
    setDraft({
      googleClientId: cfg.googleClientId,
      googleClientSecretRef: cfg.googleClientSecretRef ?? "",
      googleRefreshTokenRef: cfg.googleRefreshTokenRef ?? "",
      googlePsiApiKeyRef: cfg.googlePsiApiKeyRef ?? "",
      openPageRankApiKeyRef: cfg.openPageRankApiKeyRef ?? "",
      resendApiKeyRef: cfg.resendApiKeyRef ?? "",
      resendDefaultFrom: cfg.resendDefaultFrom,
    });
  }

  // Collect all tools from the catalog into a flat list for the allowlist toggle
  const allTools: Array<{ name: string; label: string; category: string }> = [];
  if (catalog) {
    for (const entry of Object.values(catalog.categories)) {
      for (const t of entry.tools) {
        allTools.push({ name: t.name, label: t.label, category: entry.label });
      }
    }
  }
  const currentEnabled =
    localEnabled !== null
      ? localEnabled
      : enabledTools === null || enabledTools === undefined
        ? allTools.map((t) => t.name) // unconfigured == all enabled
        : enabledTools;

  const toggleTool = (name: string) => {
    const next = currentEnabled.includes(name)
      ? currentEnabled.filter((n) => n !== name)
      : [...currentEnabled, name];
    setLocalEnabled(next);
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Card>
        <div style={{ marginBottom: 10, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <strong style={{ fontSize: 14 }}>Platform provider credentials</strong>
          <span style={{ fontSize: 11, color: tokens.mutedText }}>shared across every company</span>
        </div>
        {!draft ? (
          <p style={{ color: tokens.mutedText, fontSize: 13 }}>Loading…</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13 }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 11, color: tokens.mutedText, fontWeight: 600 }}>Google OAuth Client ID</span>
              <input
                type="text"
                value={String(draft.googleClientId ?? "")}
                onChange={(e) => setDraft({ ...draft, googleClientId: e.target.value })}
                placeholder="1234...apps.googleusercontent.com"
                style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, background: "transparent", color: "var(--foreground, #111)" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 11, color: tokens.mutedText, fontWeight: 600 }}>Google OAuth Client Secret (secret ref)</span>
              <input
                type="text"
                value={String(draft.googleClientSecretRef ?? "")}
                onChange={(e) => setDraft({ ...draft, googleClientSecretRef: e.target.value })}
                placeholder="secret_ref_uuid"
                style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, background: "transparent", color: "var(--foreground, #111)" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 11, color: tokens.mutedText, fontWeight: 600 }}>Google OAuth Refresh Token (secret ref)</span>
              <input
                type="text"
                value={String(draft.googleRefreshTokenRef ?? "")}
                onChange={(e) => setDraft({ ...draft, googleRefreshTokenRef: e.target.value })}
                placeholder="secret_ref_uuid"
                style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, background: "transparent", color: "var(--foreground, #111)" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 11, color: tokens.mutedText, fontWeight: 600 }}>PageSpeed Insights key (secret ref, optional)</span>
              <input
                type="text"
                value={String(draft.googlePsiApiKeyRef ?? "")}
                onChange={(e) => setDraft({ ...draft, googlePsiApiKeyRef: e.target.value })}
                placeholder="secret_ref_uuid"
                style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, background: "transparent", color: "var(--foreground, #111)" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 11, color: tokens.mutedText, fontWeight: 600 }}>Open PageRank key (secret ref, optional)</span>
              <input
                type="text"
                value={String(draft.openPageRankApiKeyRef ?? "")}
                onChange={(e) => setDraft({ ...draft, openPageRankApiKeyRef: e.target.value })}
                placeholder="secret_ref_uuid"
                style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, background: "transparent", color: "var(--foreground, #111)" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 11, color: tokens.mutedText, fontWeight: 600 }}>Resend API Key (secret ref)</span>
              <input
                type="text"
                value={String(draft.resendApiKeyRef ?? "")}
                onChange={(e) => setDraft({ ...draft, resendApiKeyRef: e.target.value })}
                placeholder="secret_ref_uuid"
                style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, background: "transparent", color: "var(--foreground, #111)" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}>
              <span style={{ fontSize: 11, color: tokens.mutedText, fontWeight: 600 }}>Resend Default From</span>
              <input
                type="text"
                value={String(draft.resendDefaultFrom ?? "")}
                onChange={(e) => setDraft({ ...draft, resendDefaultFrom: e.target.value })}
                placeholder={`Melvyn <melvyn@neocompany.ch>`}
                style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, background: "transparent", color: "var(--foreground, #111)" }}
              />
            </label>
          </div>
        )}
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button
            disabled={savingCfg || !draft}
            onClick={async () => {
              if (!draft) return;
              setSavingCfg(true);
              try {
                await onSaveCfg(draft);
              } finally {
                setSavingCfg(false);
              }
            }}
            style={{
              background: tokens.primary,
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 13,
              cursor: "pointer",
              opacity: savingCfg ? 0.6 : 1,
            }}
          >
            {savingCfg ? "Saving…" : "Save platform credentials"}
          </button>
        </div>
      </Card>

      <Card>
        <div style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Enabled tools allowlist</strong>
          <div style={{ fontSize: 12, color: tokens.mutedText, marginTop: 2 }}>
            Only tools checked here can be called by any agent, on any company.
            {enabledTools === null && " Currently unconfigured → every tool is implicitly enabled."}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, fontSize: 13, marginBottom: 12 }}>
          {allTools.map((t) => {
            const checked = currentEnabled.includes(t.name);
            return (
              <label key={t.name} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "3px 0" }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleTool(t.name)}
                />
                <code style={{ fontSize: 11, color: tokens.mutedText }}>{t.name}</code>
              </label>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            disabled={savingEnabled || localEnabled === null}
            onClick={() => setLocalEnabled(null)}
            style={{
              background: "transparent",
              border: tokens.cardBorder,
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 13,
              cursor: "pointer",
              color: "var(--foreground, #111)",
            }}
          >
            Reset
          </button>
          <button
            disabled={savingEnabled || localEnabled === null}
            onClick={async () => {
              if (localEnabled === null) return;
              setSavingEnabled(true);
              try {
                await onSaveEnabled(localEnabled);
                setLocalEnabled(null);
              } finally {
                setSavingEnabled(false);
              }
            }}
            style={{
              background: tokens.primary,
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 13,
              cursor: "pointer",
              opacity: savingEnabled ? 0.6 : 1,
            }}
          >
            {savingEnabled ? "Saving…" : "Save allowlist"}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompanySection — editable by any user with access to the current company.
// Stores gscSiteUrl / ga4PropertyId / wordpressSiteUrl / wordpressUsername /
// wordpressAppPasswordRef in plugin_state scope=company.
// ---------------------------------------------------------------------------

function CompanySection({
  cfg,
  configSummary,
  onSave,
}: {
  cfg: CompanyConfigView | null;
  configSummary: ConfigSummary | null;
  onSave: (patch: Partial<CompanyConfigView>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<CompanyConfigView> | null>(null);
  const [saving, setSaving] = useState(false);

  if (!draft && cfg) {
    setDraft({
      gscSiteUrl: cfg.gscSiteUrl ?? "",
      ga4PropertyId: cfg.ga4PropertyId ?? "",
      wordpressSiteUrl: cfg.wordpressSiteUrl ?? "",
      wordpressUsername: cfg.wordpressUsername ?? "",
      wordpressAppPasswordRef: cfg.wordpressAppPasswordRef ?? "",
    });
  }

  return (
    <Card>
      {configSummary && (
        <div style={{ display: "grid", gap: 6, fontSize: 13, marginBottom: 16, paddingBottom: 12, borderBottom: tokens.cardBorder }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Platform Google OAuth</span>
            <Pill tone={configSummary.googleOAuthConfigured ? "ok" : "warn"}>
              {configSummary.googleOAuthConfigured ? "configured" : "missing"}
            </Pill>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Platform PSI key</span>
            <Pill tone={configSummary.googlePsiKeyConfigured ? "ok" : "muted"}>
              {configSummary.googlePsiKeyConfigured ? "configured" : "optional"}
            </Pill>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Platform Resend key</span>
            <Pill tone={configSummary.resendConfigured ? "ok" : "warn"}>
              {configSummary.resendConfigured ? "configured" : "missing"}
            </Pill>
          </div>
        </div>
      )}

      {!draft ? (
        <p style={{ color: tokens.mutedText, fontSize: 13 }}>Loading…</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13 }}>
          <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}>
            <span style={{ fontSize: 11, color: tokens.mutedText, fontWeight: 600 }}>GSC property URL (this company)</span>
            <input
              type="text"
              value={String(draft.gscSiteUrl ?? "")}
              onChange={(e) => setDraft({ ...draft, gscSiteUrl: e.target.value })}
              placeholder="https://neoservice.ai/ or sc-domain:neoservice.ai"
              style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, background: "transparent", color: "var(--foreground, #111)" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}>
            <span style={{ fontSize: 11, color: tokens.mutedText, fontWeight: 600 }}>GA4 property ID (this company)</span>
            <input
              type="text"
              value={String(draft.ga4PropertyId ?? "")}
              onChange={(e) => setDraft({ ...draft, ga4PropertyId: e.target.value })}
              placeholder="367221234"
              style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, background: "transparent", color: "var(--foreground, #111)" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}>
            <span style={{ fontSize: 11, color: tokens.mutedText, fontWeight: 600 }}>WordPress site URL</span>
            <input
              type="text"
              value={String(draft.wordpressSiteUrl ?? "")}
              onChange={(e) => setDraft({ ...draft, wordpressSiteUrl: e.target.value })}
              placeholder="https://blog.neoservice.ai"
              style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, background: "transparent", color: "var(--foreground, #111)" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 11, color: tokens.mutedText, fontWeight: 600 }}>WordPress username</span>
            <input
              type="text"
              value={String(draft.wordpressUsername ?? "")}
              onChange={(e) => setDraft({ ...draft, wordpressUsername: e.target.value })}
              placeholder="admin"
              style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, background: "transparent", color: "var(--foreground, #111)" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 11, color: tokens.mutedText, fontWeight: 600 }}>WP app password (secret ref)</span>
            <input
              type="text"
              value={String(draft.wordpressAppPasswordRef ?? "")}
              onChange={(e) => setDraft({ ...draft, wordpressAppPasswordRef: e.target.value })}
              placeholder="secret_ref_uuid"
              style={{ padding: "6px 8px", border: tokens.cardBorder, borderRadius: 6, background: "transparent", color: "var(--foreground, #111)" }}
            />
          </label>
        </div>
      )}
      <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
        <button
          disabled={saving || !draft}
          onClick={async () => {
            if (!draft) return;
            setSaving(true);
            try {
              await onSave(draft);
            } finally {
              setSaving(false);
            }
          }}
          style={{
            background: tokens.primary,
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "6px 14px",
            fontSize: 13,
            cursor: "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Save company configuration"}
        </button>
      </div>
    </Card>
  );
}

function ToolConfigDrawer({
  tool,
  companyId,
  onClose,
  onSave,
}: {
  tool: ToolMetadataView;
  companyId: string;
  onClose: () => void;
  onSave: (config: Record<string, unknown>) => Promise<void>;
}) {
  const configResp = usePluginData<ToolConfigResponse>("toolConfig", {
    companyId,
    toolName: tool.name,
  });
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [initialised, setInitialised] = useState(false);

  // Initialise the draft once the data has loaded
  if (!initialised && configResp.data) {
    const loaded = configResp.data.config ?? {};
    const seeded: Record<string, unknown> = {};
    for (const field of tool.configSchema?.fields ?? []) {
      seeded[field.name] = loaded[field.name] ?? field.default ?? "";
    }
    setDraft(seeded);
    setInitialised(true);
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      // Strip empty strings so we don't pollute the stored config
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(draft)) {
        if (v === "" || v === undefined || v === null) continue;
        cleaned[k] = v;
      }
      await onSave(cleaned);
    } finally {
      setSaving(false);
    }
  };

  const schema = tool.configSchema;
  if (!schema) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 9999,
        fontFamily: tokens.fontFamily,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: "100%",
          background: "var(--background, #fff)",
          height: "100%",
          padding: 24,
          overflowY: "auto",
          borderLeft: tokens.cardBorder,
          boxShadow: "-10px 0 30px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: tokens.mutedText, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Configure tool
            </div>
            <h2 style={{ margin: "2px 0 4px 0", fontSize: 18, fontWeight: 700 }}>{tool.label}</h2>
            <code style={{ fontSize: 11, color: tokens.mutedText }}>{tool.name}</code>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 20,
              color: tokens.mutedText,
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{schema.title}</h3>
          {schema.description && (
            <p style={{ margin: "4px 0 0 0", fontSize: 12, color: tokens.mutedText }}>
              {schema.description}
            </p>
          )}
        </div>

        {!configResp.data ? (
          <p style={{ color: tokens.mutedText, fontSize: 13 }}>Loading…</p>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {schema.fields.map((field) => (
              <label key={field.name} style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 12, color: tokens.mutedText, fontWeight: 600 }}>
                  {field.label}
                  {field.required && <span style={{ color: tokens.danger, marginLeft: 4 }}>*</span>}
                </span>
                {field.type === "enum" && field.options ? (
                  <select
                    value={String(draft[field.name] ?? "")}
                    onChange={(e) => setDraft({ ...draft, [field.name]: e.target.value })}
                    style={{
                      padding: "6px 8px",
                      border: tokens.cardBorder,
                      borderRadius: 6,
                      background: "transparent",
                      color: "var(--foreground, #111)",
                      fontSize: 13,
                    }}
                  >
                    <option value="">(default)</option>
                    {field.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : field.type === "boolean" ? (
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={Boolean(draft[field.name])}
                      onChange={(e) => setDraft({ ...draft, [field.name]: e.target.checked })}
                    />
                    <span style={{ fontSize: 12, color: tokens.mutedText }}>
                      {Boolean(draft[field.name]) ? "Enabled" : "Disabled"}
                    </span>
                  </label>
                ) : field.type === "number" ? (
                  <input
                    type="number"
                    value={String(draft[field.name] ?? "")}
                    onChange={(e) => setDraft({ ...draft, [field.name]: e.target.value === "" ? "" : Number(e.target.value) })}
                    style={{
                      padding: "6px 8px",
                      border: tokens.cardBorder,
                      borderRadius: 6,
                      background: "transparent",
                      color: "var(--foreground, #111)",
                      fontSize: 13,
                    }}
                  />
                ) : (
                  <input
                    type={field.type === "url" ? "url" : "text"}
                    value={String(draft[field.name] ?? "")}
                    onChange={(e) => setDraft({ ...draft, [field.name]: e.target.value })}
                    placeholder={field.default ? String(field.default) : ""}
                    style={{
                      padding: "6px 8px",
                      border: tokens.cardBorder,
                      borderRadius: 6,
                      background: "transparent",
                      color: "var(--foreground, #111)",
                      fontSize: 13,
                    }}
                  />
                )}
                {field.description && (
                  <span style={{ fontSize: 11, color: tokens.mutedText }}>{field.description}</span>
                )}
              </label>
            ))}
          </div>
        )}

        <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              background: "transparent",
              border: tokens.cardBorder,
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 13,
              cursor: "pointer",
              color: "var(--foreground, #111)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !initialised}
            style={{
              background: tokens.primary,
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 13,
              cursor: "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
