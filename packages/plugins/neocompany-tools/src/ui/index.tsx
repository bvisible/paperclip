import type { PluginPageProps } from "@paperclipai/plugin-sdk/ui";
import { usePluginData, usePluginAction, useHostContext } from "@paperclipai/plugin-sdk/ui";
import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Types — mirror the shape returned by the worker's data handlers
// ---------------------------------------------------------------------------

interface ToolMetadataView {
  name: string;
  label: string;
  category: string;
  defaultEnabled: boolean;
  internal: boolean;
  connectionTrigger?: "wordpress" | "google" | null;
  allowedRoles?: string[];
}

interface ToolCatalog {
  toolCount: number;
  categories: Record<string, { label: string; tools: ToolMetadataView[] }>;
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
// Settings page
// ---------------------------------------------------------------------------

export function SettingsPage(_props: PluginPageProps) {
  const host = useHostContext();
  const companyId = host?.companyId ?? "";

  const catalogResp = usePluginData<ToolCatalog>("toolCatalog", {});
  const accessResp = usePluginData<AccessState>("accessState", { companyId });
  const configResp = usePluginData<ConfigSummary>("configSummary", {});
  const setCategoryEnabled = usePluginAction("setCategoryEnabled");
  const [pendingToggle, setPendingToggle] = useState<string | null>(null);

  const refreshAll = useCallback(() => {
    catalogResp.refresh();
    accessResp.refresh();
    configResp.refresh();
  }, [catalogResp, accessResp, configResp]);

  const catalog = catalogResp.data;
  const access = accessResp.data;
  const config = configResp.data;

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

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, color: tokens.mutedText, marginBottom: 8 }}>
          Provider configuration
        </h2>
        <Card>
          {!config ? (
            <p style={{ color: tokens.mutedText, fontSize: 13 }}>Loading…</p>
          ) : (
            <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Google OAuth (GSC, GA4)</span>
                <Pill tone={config.googleOAuthConfigured ? "ok" : "warn"}>
                  {config.googleOAuthConfigured ? "configured" : "missing"}
                </Pill>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Google PageSpeed Insights API key</span>
                <Pill tone={config.googlePsiKeyConfigured ? "ok" : "muted"}>
                  {config.googlePsiKeyConfigured ? "configured" : "optional"}
                </Pill>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Resend API key (email.send)</span>
                <Pill tone={config.resendConfigured ? "ok" : "warn"}>
                  {config.resendConfigured ? "configured" : "missing"}
                </Pill>
              </div>
              {config.defaultFromAddress && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Default From address</span>
                  <span style={{ color: tokens.mutedText, fontSize: 12 }}>{config.defaultFromAddress}</span>
                </div>
              )}
            </div>
          )}
          <p style={{ color: tokens.mutedText, fontSize: 12, marginTop: 12 }}>
            Secret references are edited from the core Paperclip plugin config panel.
          </p>
        </Card>
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
                        <div style={{ display: "flex", gap: 6 }}>
                          {tool.internal && <Pill tone="warn">internal</Pill>}
                          {tool.connectionTrigger && (
                            <Pill tone="muted">needs {tool.connectionTrigger}</Pill>
                          )}
                          {tool.allowedRoles && tool.allowedRoles.length > 0 && (
                            <Pill tone="muted">{tool.allowedRoles.join(", ")}</Pill>
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
    </div>
  );
}
