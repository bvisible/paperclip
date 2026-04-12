# NeoCompany — Paperclip Fork

Fork of [Paperclip](https://github.com/paperclipai/paperclip) used as the
foundation for **NeoCompany** — our multi-tenant AI business management
platform. We replaced our previous Postiz-based stack with this after the
Postiz monorepo (250 deps, fragile build) proved unfit for production.

**Operating rules for Claude Code working in this repo:**
- Rule #0 — Never suggest stopping. Execute the full task the user asked for.
- Rule #1 — Actually test (use Chrome automation on `app.neocompany.ch`, don't
  ask the user to click things you can click yourself).
- Do all browser actions yourself via the `claude-in-chrome` tool.
- Commits: no Claude co-author, no "Generated with Claude Code" footer.
- Code comments: English only.

---

## Architecture

```
Paperclip (orchestration, chat UI, governance)
  └── OpenClaw Gateway (agent runtime, memory, tools)
       └── GPT-5.4 via Codex OAuth (info@bvisible.ch)
       └── Custom tools (future: neocompany-tools plugin)
```

- **Paperclip** handles: auth, companies, agents, issues, heartbeat runs,
  plugin lifecycle, and the chat UI.
- **OpenClaw Gateway** handles: LLM calls, session memory, MCP tool routing.
- **Plugins** (our own) extend Paperclip with chat and custom tools.

---

## Infrastructure (prod: app.neocompany.ch)

| Component | Detail |
|---|---|
| Domain | `app.neocompany.ch` — Let's Encrypt via certbot |
| Server | Infomaniak Public Cloud, `a2-ram4-disk50-perf1` (2 vCPU, 4 Go RAM) |
| IP | `83.228.224.34` |
| OS | Ubuntu 24.04.3 LTS |
| SSH | `ssh -i ~/.ssh/id_neoservice ubuntu@83.228.224.34` (key `neoservice-local`) |
| Runtime | Node.js 22, pnpm 10, PostgreSQL 16, Nginx reverse proxy |
| Source | `/home/ubuntu/paperclip` (this git repo) |

**Services (all systemd user units, `loginctl enable-linger ubuntu`):**
- `paperclip` — Paperclip server, port 3100
  - `ExecStart=/home/ubuntu/paperclip/server/node_modules/.bin/tsx
    /home/ubuntu/paperclip/server/src/index.ts`
  - `systemctl --user status|restart paperclip`
  - Logs: `journalctl --user -u paperclip -n 50`
- `openclaw-gateway` — OpenClaw Gateway, port 3200 (loopback only)
  - `ExecStart=/usr/local/bin/openclaw gateway run` (NOT `gateway start`,
    that would loop back into systemd)
  - Config: `~/.openclaw/openclaw.json`
  - Logs: `journalctl --user -u openclaw-gateway -n 50`
- `nginx` — reverse proxy 80/443 → 127.0.0.1:3100
- `postgresql` — user `paperclip`, db `paperclip`, password `paperclip2026`

**Ports:**
- `3100` — Paperclip (public via Nginx)
- `3200` — OpenClaw Gateway (loopback only)
- `5432` — PostgreSQL (local)
- `80/443` — Nginx

---

## Critical config files on the server

- `/home/ubuntu/paperclip/.env` — Paperclip env vars (DATABASE_URL, PORT, etc.)
- `/home/ubuntu/.paperclip/config.json` — Paperclip tiered config
  (`database.mode=postgres`, `deploymentMode=authenticated`,
  `allowedHostnames=[app.neocompany.ch]`)
- `~/.openclaw/openclaw.json` — OpenClaw gateway config
  (`gateway.auth.mode=token`, token stored inline,
  `gateway.bind=loopback`, plugins.allow=[memory-core, openai, auth])
- `~/.openclaw/workspace/paperclip-claimed-api-key.json` — API key the
  OpenClaw agent uses to call back into Paperclip. Created via
  `pnpm paperclipai agent local-cli <agentId> -C <companyId>`.

---

## Env vars (Paperclip)

```bash
DATABASE_URL=postgresql://paperclip:paperclip2026@localhost:5432/paperclip
PORT=3100
HOST=0.0.0.0
NODE_ENV=production
PAPERCLIP_DEPLOYMENT_MODE=authenticated
PAPERCLIP_PUBLIC_URL=https://app.neocompany.ch
BETTER_AUTH_SECRET=<random-hex-64>
PAPERCLIP_AUTH_DISABLE_SIGN_UP=false
PAPERCLIP_TELEMETRY_ENABLED=false
HEARTBEAT_SCHEDULER_ENABLED=true
```

---

## Current state (what already works)

- **End-to-end conversational chat** via the vendored `paperclip-chat` plugin
  (`packages/plugins/paperclip-chat/`) routed through OpenClaw Gateway → GPT-5.4.
- **Sidebar entry "Chat"** with a `MessageCircle` icon, rendered by our
  `PluginLauncherOutlet` on `sidebar` placement in `ui/src/components/Sidebar.tsx`.
- **Chat UI** with right-aligned user bubbles, left-aligned agent messages
  (avatar + real agent name from `thread.agentName`), markdown rendering,
  per-agent placeholder text.
- Company **"Neoservice"** (prefix `NEO`, id `2852b040-1d6f-46e7-a1c1-cf02ae77d2ba`),
  agent **"Melvyn"** (adapter `openclaw_gateway`, id
  `8a892763-f2ab-4c18-87c1-599075c9ef4c`). A second dormant company with
  prefix `NEOA` exists from the first test run.
- OpenAI Codex OAuth linked to `info@bvisible.ch` on the server for the
  OpenClaw gateway.

---

## Fixes landed in our fork on top of upstream

These are **must keep** when syncing from upstream — they fix real blockers:

1. **OpenClaw schema rejection** (`packages/adapters/openclaw-gateway/src/server/execute.ts`)
   — Paperclip `paperclip` context field caused `additionalProperties: false`
   rejection. We wrap it in `extraSystemPrompt` with `<paperclip-context>` tags.
2. **Chat prompt passthrough** (`packages/adapters/openclaw-gateway/src/server/execute.ts`
   + `server/src/services/plugin-host-services.ts`) — plugin `sessions.sendMessage`
   now injects the user prompt as `contextSnapshot.chatPrompt`, and the
   OpenClaw adapter uses it directly instead of the heartbeat wake text
   (otherwise the agent answers with the task procedure instead of chatting).
3. **Plugin RPC timeout** (`server/src/services/plugin-worker-manager.ts`) —
   `DEFAULT_RPC_TIMEOUT_MS` bumped from 30 s to 5 min so long chat runs
   don't hit the default budget.
4. **OpenClaw Gateway adapter enabled in UI**
   (`ui/src/adapters/adapter-display-registry.ts`) — removed the
   `comingSoon: true` flag.
5. **Plugin launcher nav resolution** (`ui/src/plugins/launchers.tsx`) —
   relative `plugins/<id>` targets are now prefixed with the current company
   prefix so `navigate("plugins/paperclip-chat")` actually hits
   `/NEO/plugins/paperclip-chat`.
6. **Plugin page lookup by key** (`ui/src/pages/PluginPage.tsx`) —
   `/:companyPrefix/plugins/:pluginId` now matches by `pluginKey` first, then
   `pluginId` (UUID) as fallback, so plugins are URL-friendly.
7. **Sidebar plugin launcher outlet** (`ui/src/components/Sidebar.tsx`) —
   added `PluginLauncherOutlet placementZones={["sidebar"]}` beside the
   existing slot outlet. Launchers in `sidebar` zone get native-looking
   styling via `launcherTriggerClassName`.
8. **Default launcher icon** (`ui/src/plugins/launchers.tsx`) — `pickLauncherIcon`
   maps `paperclip-chat` → `MessageCircle`, everything else → `Puzzle`.
9. **PluginPage chrome removed** (`ui/src/pages/PluginPage.tsx`) — dropped the
   "Back" button and wrapper padding so plugin pages get the full viewport.

---

## Vendored plugins

### `packages/plugins/paperclip-chat`

Fork of `webprismdevin/paperclip-plugin-chat` with heavy modifications:
- Default adapter `openclaw_gateway` (manifest + worker + UI state)
- Parser extended to understand the `[openclaw-gateway:event]` log line format
  and to accept chunks from any stream (stdout / stderr / system), not just
  stdout
- Thread tracks the resolved `agentId` + `agentName`; UI shows the real agent
  name instead of a generic "Paperclip"
- User messages rendered right-aligned in a primary-coloured bubble, agent
  messages left-aligned with avatar
- Placeholder dynamic: `Ask ${agentName} anything...`
- Launcher placement = `sidebar` (renders under `Inbox` in the main nav)
- Works via `ctx.agents.sessions` — the worker delegates to the host which
  now routes the prompt via our `chatPrompt` context field (see fix #2)

### Future plugins planned

- `neocompany-tools` — port of the legacy Postiz tool catalogue
  (SEO, social, content, designer, ad campaigns, email, analytics).
  See `/Users/jeremy/GitHub/postiz-app/libraries/nestjs-libraries/src/chat/tools/`
  for the reference registry.

---

## OpenClaw CLI cheat sheet (v2026.4.x)

- `openclaw --version`
- `openclaw gateway run` — foreground (what systemd runs)
- `openclaw gateway start|stop|restart|status` — service management
- `openclaw gateway health` / `openclaw gateway probe` — diagnostics
- `openclaw models auth login --provider openai-codex` — OAuth login
  (**requires TTY** — use `ssh -t`)
- `openclaw configure --section gateway|model|plugins|…` — interactive setup
- `openclaw config get gateway` / `openclaw config get <path>`
- `openclaw doctor --fix` — repair config

**Gotchas:**
- `gateway start` in systemd ExecStart creates a loop — use `gateway run`.
- The CLI `auth` command is gone; it's now `models auth login --provider <id>`.
- `plugins.allow` must list known bundled plugin ids (`auth`, `openai`,
  `memory-core`) — `"auth"` is NOT a plugin, don't add it.
- `gateway.auth.mode=none` still requires a device identity; the Paperclip
  adapter config needs either a valid token or matching device auth.

---

## Plugin workflow

### Build & deploy

```bash
# Local (from /Users/jeremy/GitHub/paperclip)
git add … && git commit -m "…" && git push origin master

# On the server (ssh ubuntu@83.228.224.34)
cd /home/ubuntu/paperclip
git pull
pnpm build            # pnpm -r build — includes plugins
systemctl --user restart paperclip
```

### Installing a local plugin into the running Paperclip instance

```bash
# Board API key for the CLI (created in session, persisted in board_api_keys)
TOKEN=pcp_board_91d6fbff84e12962bb2c3afbce51a13dddabf7a032f86adc

cd /home/ubuntu/paperclip
pnpm paperclipai plugin install /home/ubuntu/paperclip/packages/plugins/<plugin-dir> \
  --api-base http://127.0.0.1:3100 --api-key $TOKEN

# Reinstall after a rebuild (must uninstall first)
pnpm paperclipai plugin uninstall <plugin-key> \
  --api-base http://127.0.0.1:3100 --api-key $TOKEN

# Re-apply plugin config after reinstall
sudo -u postgres psql -d paperclip -c "
  INSERT INTO plugin_config (plugin_id, config_json)
    SELECT id, '{\"defaultAdapterType\": \"openclaw_gateway\"}'::jsonb
    FROM plugins WHERE plugin_key = '<plugin-key>'
  ON CONFLICT (plugin_id) DO UPDATE
    SET config_json = EXCLUDED.config_json;
"
```

**Important:** after updating a plugin's manifest/capabilities you MUST
restart Paperclip so the plugin loader re-reads the cached manifest.
Install happens via HTTP but manifests are cached in the Node import cache.

---

## Useful database queries

```sql
-- List companies and their issue prefixes (the URL slug)
SELECT id, name, issue_prefix FROM companies;

-- Agents and their adapter config
SELECT id, name, adapter_type, adapter_config FROM agents;

-- Plugin status
SELECT plugin_key, status, version FROM plugins;

-- Plugin config (per-instance)
SELECT p.plugin_key, pc.config_json
FROM plugins p JOIN plugin_config pc ON pc.plugin_id = p.id;

-- Board API keys (CLI auth)
SELECT id, user_id, name, created_at FROM board_api_keys;
```

Board API key generation (SHA-256 of bearer token stored in `key_hash`):

```python
import hashlib, secrets
token = "pcp_board_" + secrets.token_hex(24)
print("TOKEN =", token)
print("HASH  =", hashlib.sha256(token.encode()).hexdigest())
```

---

## Legacy Postiz references

- Repo: `/Users/jeremy/GitHub/postiz-app`
- Tool registry: `libraries/nestjs-libraries/src/chat/tools/tool.registry.ts`
- SEO / Content / WordPress / Social / Designer / Ads / Email tools under
  `libraries/nestjs-libraries/src/chat/tools/`
- Email models (legacy schema): `libraries/nestjs-libraries/src/database/prisma/schema.prisma`
  (`EmailAccount`, `IncomingEmail`)
- OpenClaw bridge (legacy): `libraries/nestjs-libraries/src/chat/openclaw-bridge.service.ts`
- These are the source material for the upcoming `neocompany-tools` plugin.

---

## Upstream sync

- `origin` → `github.com/bvisible/paperclip` (our fork)
- `upstream` → `github.com/paperclipai/paperclip` (original)
- Periodic merge: `git fetch upstream && git merge upstream/master`
- Watch for conflicts in the files listed under "Fixes landed in our fork".

---

## When you break something, check these first

1. Port conflict on 3100 — kill stray `nohup node …` processes from early
   manual launches; the systemd unit should own the port.
2. Plugin install fails with "Missing required capabilities" after a
   manifest edit → `systemctl --user restart paperclip` before reinstalling
   (Node module cache).
3. Chat stuck on "Thinking…" → verify the agent's `adapter_config.url` is
   `ws://127.0.0.1:3200` and the gateway is running; check
   `journalctl --user -u openclaw-gateway`.
4. Agent responds with the wake-up procedure instead of chatting → the
   `chatPrompt` passthrough (fix #2) regressed. Check
   `plugin-host-services.ts` and `openclaw-gateway/src/server/execute.ts`.
5. HTML white/black empty page → UI build out of date; `pnpm --filter
   @paperclipai/ui build` then restart Paperclip.
