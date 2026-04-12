import type { PluginPageProps } from "@paperclipai/plugin-sdk/ui";
import { useHostContext } from "@paperclipai/plugin-sdk/ui";

// Phase 1 scaffold: minimal placeholder page. The full Settings UI
// (per-tool toggles, agent × tool matrix, secrets config) ships in Phase 3.

export function SettingsPage(_props: PluginPageProps) {
  const host = useHostContext();
  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 840 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>NeoCompany Tools</h1>
      <p style={{ color: "#6b7280", marginBottom: 24 }}>
        Tools available to {host?.company?.name ?? "your company"} agents. Configure global
        category toggles, per-agent allowlists, and provider credentials here.
      </p>
      <div
        style={{
          padding: 16,
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          backgroundColor: "#f9fafb",
          color: "#374151",
          fontSize: 14,
        }}
      >
        Phase 1 scaffold — full settings UI is implemented in Phase 3.
        <br />
        The MVP tools (<code>seoGscKeywords</code>, <code>emailSendMessage</code>) are
        already registered and will execute as soon as the plugin config provides the
        required secret references.
      </div>
    </div>
  );
}
