# FORK_PATCHES — `bvisible/paperclip` divergence vs `paperclipai/paperclip`

This file documents every patch we maintain on top of upstream
`paperclipai/paperclip`. Each entry should answer: **why does this patch
exist, what does it touch, and what would let us drop it?**

This is the source of truth consulted before each upstream sync. Add an
entry whenever you patch a core upstream file (anything outside
`packages/plugins/{paperclip-chat,neocompany-tools,nora-frappe-tools}/` and
`server/src/services/openclaw-isolated-agents.ts` which are pure additions).

Last sync: **upstream v2026.427.0** merged 2026-04-28 (`477ba2a2`).

## Active patches

### #1 — Wrap `paperclip` payload in `<paperclip-context>` XML

- **File:** `packages/adapters/openclaw-gateway/src/server/execute.ts:~1343`
- **Why:** OpenClaw gateway rejects unknown root fields on the `agent`
  request payload (`additionalProperties: false`). Our `paperclip` context
  field would fail validation, so we wrap it inside `extraSystemPrompt`
  using `<paperclip-context>` XML tags so the model still sees it as
  structured context.
- **Migration path:** open issue with OpenClaw to allow a `paperclip`
  reserved field in the agent schema. Until then, keep the wrap.

### #2 — `chatPrompt` passthrough for plugin chat sessions

- **Files:**
  - `server/src/services/plugin-host-services.ts:~1779` — injects
    `params.prompt` into `contextSnapshot.chatPrompt` when a plugin calls
    `sessions.sendMessage`.
  - `packages/adapters/openclaw-gateway/src/server/execute.ts:~1327` —
    reads `ctx.context.chatPrompt` and uses it as the user message instead
    of the heartbeat wake text.
- **Why:** Without this, agents receive the heartbeat task procedure
  instead of the chat prompt, so Nora replies with "Run this procedure
  now…" instead of conversing.
- **Migration path:** v2026.427.0 added "plugin orchestration host APIs"
  (#4114). Investigate whether one of the new hooks
  (`beforeSessionMessage`?) lets us inject the prompt from the
  `paperclip-chat` plugin worker itself, dropping the core patch.

### #3 — RPC timeout 15 min for plugin worker

- **File:** `server/src/services/plugin-worker-manager.ts:59-62`
- **Change:** `DEFAULT_RPC_TIMEOUT_MS` 30s → 15 min, `MAX_RPC_TIMEOUT_MS`
  5 min → 15 min.
- **Why:** `imageGenerate` via `codex-cli` takes 30-90 s for `gpt-image-2`
  (sometimes more for high-detail). Upstream's 5-min cap clamps requests
  that should succeed.
- **Migration path:** the SDK plugin protocol has no `timeoutMs` per tool
  call (the per-call timeoutMs in 2026.4.23 release notes is OpenClaw
  runtime only, not plugin SDK). Open a PR upstream to add an optional
  `timeoutMs` field on `tools.execute` so each tool can request its own
  ceiling. Until then, keep the global bump.

### #4 — OpenClaw gateway adapter promoted from "Coming Soon"

- **File:** `ui/src/adapters/adapter-display-registry.ts`
- **Change:** drop the `comingSoon: true` flag on `openclaw_gateway`.
- **Migration path:** PR upstream to drop the flag (it's our primary
  adapter, no longer experimental on our side).

### #5 — Plugin launcher prefixed with company prefix

- **File:** `ui/src/plugins/launchers.tsx`
- **Change:** Relative `plugins/<id>` nav targets are prefixed with the
  current company prefix so `navigate("plugins/paperclip-chat")` resolves
  to `/NEO/plugins/paperclip-chat`.
- **Migration path:** PR upstream — bug fix universal to multi-company
  installs.

### #6 — Plugin page lookup by `pluginKey` then UUID

- **File:** `ui/src/pages/PluginPage.tsx`
- **Change:** `/:companyPrefix/plugins/:pluginId` matches by `pluginKey`
  first, falls back to `pluginId` (UUID).
- **Migration path:** PR upstream — URL-friendly is universal.

### #7 — Sidebar plugin launcher outlet

- **File:** `ui/src/components/Sidebar.tsx`
- **Change:** `<PluginLauncherOutlet placementZones={["sidebar"]}/>` so
  plugin launchers appear natively in the main nav.
- **Migration path:** PR upstream.

### #8 — Default launcher icon mapping

- **File:** `ui/src/plugins/launchers.tsx`
- **Change:** `pickLauncherIcon` maps `paperclip-chat` → `MessageCircle`,
  fallback `Puzzle`.
- **Migration path:** PR upstream — drop our local mapping when icons
  ship in plugin manifest declarations.

### #9 — Plugin page chrome removed

- **File:** `ui/src/pages/PluginPage.tsx`
- **Change:** Removed the "Back" button + wrapper padding so plugin pages
  use the full viewport.
- **Migration path:** PR upstream to add a `chromeless: true` flag on the
  plugin manifest UI declaration. Pure UX preference for now.

### #10 — `/plugins/tools/execute` accepts agent JWT

- **File:** `server/src/routes/plugins.ts`
- **Change:** Dual authz branch — board callers go through
  `assertBoardOrgAccess`, agent callers (OpenClaw callbacks from a
  Paperclip-issued JWT) extract `agentId/companyId/runId` from the JWT
  instead of trusting the request body.
- **Why:** Upstream's #4122 hardening rejects all agents on this route.
  Our isolated agents need to call back into `/plugins/tools/execute`
  with their own JWT.
- **Migration path:** PR upstream to expose a `plugin.tools.execute-as-agent`
  capability that plugins can request, instead of hardcoding the dual
  branch. Until then, keep the patch.

### #11 — SAAS dashboard at `/admin/*` coexists with `/instance/settings/*`

- **File:** `ui/src/App.tsx`
- **Change:** Mounts our NeoCompany SuperAdmin dashboard
  (`AdminLayout` + `CompaniesSection` + `PluginsSection` + `ToolsConfigSection` +
  `GeneralSection`) at `/admin/*`, alongside upstream's
  `/instance/settings/*` (multi-user, invites, plugin manager, adapter
  manager, profile settings).
- **Why:** Two distinct UX paradigms. Upstream's settings is the
  multi-user/local-first source of truth; `/admin/*` is the NeoCompany
  product surface for a SaaS operator (global API keys, plugin install
  flow per company, etc.).
- **Migration path:** stay local — choice product, not pushable upstream.

## Custom additions (not patches, pure new files)

These don't conflict with upstream because they're pure additions:

- `server/src/services/seed-agents.ts` — NeoCompany default fleet (Nora /
  Lyra / Pixel / …).
- `server/src/services/openclaw-isolated-agents.ts` — per-agent OpenClaw
  workspace provisioning.
- `packages/plugins/neocompany-tools/` — 30 tools (SEO, content, social,
  templates, image gen).
- `packages/plugins/nora-frappe-tools/` — 8 tools (Frappe ERP) for
  Neoffice.
- `packages/plugins/paperclip-chat/` — vendored chat plugin with
  Wave 7.1b (externalId upsert) and Wave 7.1e (accumulateText robustness).
- `scripts/openclaw-provision-company.sh` — bash one-shot for migration.

## Wave 7 NORA modifications (chat plugin only — vendored, no upstream conflict)

- `packages/plugins/paperclip-chat/src/types.ts` — `ChatThread.externalId?`
- `packages/plugins/paperclip-chat/src/worker.ts` — `accumulateText()` +
  `chat_create_thread` upsert on externalId.

These never conflict because the vendored plugin tree is not modified by
upstream.

## Process for new patches

Before patching a core upstream file, ask in order:

1. **Hook / event / capability already in the SDK?** — use it, no patch.
2. **Bug fix or universal feature?** — open a PR upstream, no patch.
3. **Can we do it as a plugin** consuming an existing hook? — do that.
4. **Otherwise**, patch core but:
   - Keep behind a feature flag env var when possible (e.g.
     `PAPERCLIP_OPENCLAW_ISOLATED=1`).
   - Add an entry to this file with: file path, why, migration path.
