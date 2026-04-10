# NeoCompany — Paperclip Fork

This is a fork of [Paperclip](https://github.com/paperclipai/paperclip), an open-source orchestration platform for AI agent companies.
We use it as the foundation for **NeoCompany** — our multi-tenant AI business management platform.

## Project Context

NeoCompany replaces our previous Postiz-based stack. The goal: provide clients with a managed
AI agent company that runs their business operations autonomously.

**Key architecture:**
```
Paperclip (orchestration, UI, governance)
  └── OpenClaw (agent runtime, memory, tools)
       └── Custom tools (social media, SEO, email, designer)
```

**Previous stack (Postiz)** had 250 dependencies, fragile build, and was not production-ready.
Paperclip provides a cleaner foundation with built-in org charts, budgets, audit trails, and agent governance.

## Infrastructure

- **Domain**: app.neocompany.ch
- **Server**: Infomaniak Public Cloud (Ubuntu 24.04, 2 vCPU, 4 Go RAM, 50 Go SSD)
- **IP**: 83.228.224.34
- **SSH**: `ssh -i ~/.ssh/id_neoservice ubuntu@83.228.224.34`
- **Stack**: Node.js 22, PostgreSQL 16, pnpm 10, Nginx + Let's Encrypt
- **Port**: 3100 (default Paperclip)

## Monorepo Structure

```
paperclip/
├── cli/                    # paperclipai CLI binary
├── server/                 # Express backend (port 3100)
│   └── src/
│       ├── config.ts       # All env vars and config loading
│       ├── app.ts          # Express app setup
│       ├── index.ts        # Server entry point
│       ├── routes/         # API routes
│       ├── services/       # Business logic
│       ├── adapters/       # Agent adapter integrations
│       └── auth/           # Authentication (Better Auth)
├── ui/                     # React frontend (bundled into server)
├── packages/
│   ├── shared/             # Types, constants, interfaces
│   ├── db/                 # Drizzle ORM, migrations
│   ├── adapter-utils/      # Adapter framework
│   ├── mcp-server/         # MCP server package
│   ├── plugins/            # Plugin system
│   └── adapters/           # Agent adapters
│       ├── openclaw-gateway/  # <-- Our primary adapter
│       ├── claude-local/
│       ├── codex-local/
│       ├── cursor-local/
│       ├── gemini-local/
│       ├── opencode-local/
│       └── pi-local/
├── docs/                   # Documentation (Mintlify)
├── scripts/                # Build, release, backup scripts
└── docker/                 # Docker configs
```

## Key Technologies

- **Runtime**: Node.js 20+ (we use 22)
- **Package manager**: pnpm 9.15+ (we use 10)
- **Language**: TypeScript
- **Frontend**: React (static, served by Express)
- **Backend**: Express.js
- **Database**: PostgreSQL + Drizzle ORM
- **Auth**: Better Auth
- **Tests**: Vitest + Playwright

## Configuration

Paperclip uses tiered config: **Env vars > config.json > Defaults**

**Critical env vars:**
```bash
# Database
DATABASE_URL=postgresql://paperclip:paperclip2026@localhost:5432/paperclip

# Server
PORT=3100
HOST=0.0.0.0
NODE_ENV=production

# Auth
PAPERCLIP_DEPLOYMENT_MODE=authenticated
BETTER_AUTH_SECRET=<random-hex-64>
PAPERCLIP_PUBLIC_URL=https://app.neocompany.ch

# Disable signup (we manage users)
PAPERCLIP_AUTH_DISABLE_SIGN_UP=true

# OpenClaw (via adapter config, not env)
# Configured per-agent in the UI
```

## OpenClaw Integration

The OpenClaw adapter (`packages/adapters/openclaw-gateway/`) connects via WebSocket:
1. Receives `connect.challenge`
2. Sends `req connect` with auth
3. Sends `req agent` with message
4. Streams `event agent` frames as logs

**Auth modes**: token, header, password
**Session strategies**: issue, fixed, run

## Development

```bash
# Install dependencies
pnpm install

# Dev mode (server + ui hot reload)
pnpm dev

# Build all packages
pnpm build

# Run tests
pnpm test

# Database migrations
pnpm db:migrate

# Typecheck
pnpm typecheck
```

## Code Comments

- **ALL code comments MUST be written in English**
- Use clear, concise English for all inline comments and documentation

## Git Commits

- DO NOT add Claude as co-author in commit messages
- Keep commit messages clean and simple
- No "Generated with Claude Code" footer

## Our Customizations (NeoCompany)

Things we will add/modify in this fork:
1. **Custom agent templates** — pre-built companies for our clients
2. **Social media tools** — extracted from Postiz (X, WhatsApp, etc.)
3. **SEO tools** — GA4, GSC, PageSpeed integrations
4. **Designer tools** — visual content generation
5. **Branding** — NeoCompany UI, logo, colors
6. **Multi-tenant management** — client onboarding, billing
7. **Chat interface** — conversational UI on top of task system

## Upstream Sync

- **Origin**: bvisible/paperclip (our fork)
- **Upstream**: paperclipai/paperclip (original)
- Periodically sync upstream changes: `git fetch upstream && git merge upstream/master`
