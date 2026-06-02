//// Neocompany Modification — pure addition (Neocompany fork on top of paperclipai/paperclip)
//// This file does not exist upstream. Safe across upstream merges.

/**
 * Hermes isolated-agent memory roots — per (company, user, agent) `HERMES_HOME`.
 *
 * NeoCompany's multi-tenant model requires each Hermes agent run to write its
 * persistent memory (`MEMORY.md`, `USER.md`, session DB) into a directory that
 * is isolated by company AND by the human user driving the run — so two
 * clients never share memory, and two users inside the same client don't
 * either.
 *
 * The `hermes_local` adapter (hermes-paperclip-adapter) stores memory under
 * `~/.hermes/` by default — a single global path. It honours the `HERMES_HOME`
 * env var, but never sets it itself. This module computes the per-run
 * `HERMES_HOME` value; the registry wrapper for `hermes_local` injects it into
 * `adapterConfig.env` at execute time (see server/src/adapters/registry.ts).
 *
 * Resolution:
 *   HERMES_HOME = <root>/{companyId}/{userId}/{agentId}
 *
 * `userId` comes from `ctx.context.actorUserId`, which the chat path already
 * propagates into `run.contextSnapshot` (plugin-host-services.ts patch #2).
 * Runs with no human actor (scheduled heartbeats, task assignments) fall back
 * to the `_system` bucket so they still get a stable, isolated-per-company
 * home rather than leaking into a user's directory.
 *
 * Controlled by env var `PAPERCLIP_HERMES_ISOLATED=1`. When unset, this module
 * returns `null` and the adapter falls back to the shared `~/.hermes` — fine
 * for local dev / smoke tests, NOT safe for prod multi-tenant.
 */

import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Bucket used when a run has no human actor (scheduled / task-driven runs). */
export const HERMES_SYSTEM_USER_BUCKET = "_system";

/** Root under which all per-agent Hermes homes live. */
export function hermesHomeRoot(): string {
  return process.env.PAPERCLIP_HERMES_HOME_ROOT ?? "/var/lib/paperclip/hermes";
}

/** True when per-(company,user,agent) isolation is enabled for this deployment. */
export function hermesIsolationEnabled(): boolean {
  return process.env.PAPERCLIP_HERMES_ISOLATED === "1";
}

/**
 * Sanitize a path segment so a malformed id can never escape the root.
 * Company / user / agent ids are normally UUIDs, but we never trust them
 * blindly — anything outside `[A-Za-z0-9_-]` is replaced, and empty or
 * traversal-only values are rejected.
 */
function safeSegment(value: string, label: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "_");
  if (cleaned.length === 0 || /^_+$/.test(cleaned)) {
    throw new Error(`hermes-isolated-agents: invalid ${label} segment "${value}"`);
  }
  return cleaned;
}

/**
 * Compute the `HERMES_HOME` path for a (company, user, agent) triple.
 *
 * Returns `null` when isolation is disabled — the caller should then leave
 * `HERMES_HOME` unset so Hermes uses its default `~/.hermes`.
 *
 * `userId` may be null/undefined for non-chat runs; it resolves to the
 * `_system` bucket in that case.
 */
export function resolveHermesHome(
  companyId: string,
  userId: string | null | undefined,
  agentId: string,
): string | null {
  if (!hermesIsolationEnabled()) return null;
  const company = safeSegment(companyId, "companyId");
  const user =
    userId && userId.trim().length > 0
      ? safeSegment(userId, "userId")
      : HERMES_SYSTEM_USER_BUCKET;
  const agent = safeSegment(agentId, "agentId");
  return join(hermesHomeRoot(), company, user, agent);
}

/**
 * Files that each isolated HERMES_HOME must inherit from the default
 * `~/.hermes/` install. Hermes' `setup` writes both — `auth.json` carries
 * the Codex OAuth refresh token, `config.yaml` selects provider + model.
 * Without them every fresh per-(company,user,agent) bucket falls into
 * "Hermes isn't configured yet" and chat runs end silently.
 *
 * The default install path is `~/.hermes/` and is the only authoritative
 * source — we never re-auth from inside an isolated home.
 */
const HERMES_DEFAULT_HOME_FILES = ["auth.json", "config.yaml"] as const;

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function seedHermesHomeCredentials(home: string): Promise<void> {
  const defaultHome = process.env.HERMES_DEFAULT_HOME?.trim() || join(homedir(), ".hermes");
  for (const filename of HERMES_DEFAULT_HOME_FILES) {
    const target = join(home, filename);
    if (await fileExists(target)) continue;
    const source = join(defaultHome, filename);
    if (!(await fileExists(source))) continue;
    await copyFile(source, target);
  }
}

//// Neocompany Modification — per-agent workspace + tools guide.
//// The hermes_local run cwd is `config.cwd || ctx.config.workspaceDir || "."`
//// (hermes-paperclip-adapter/server/execute.js). When unset it falls back to
//// the server process cwd, so the agent never sees any company-specific
//// AGENTS.md. We point the run cwd at this workspace dir and drop an
//// `AGENTS.md` here; Hermes auto-injects AGENTS.md from the cwd ON TOP of its
//// built-in task prompt — so a specialist learns to actually call the
//// NeoCompany business tools (via /plugins/tools/execute) instead of
//// fabricating a "dry-run" result, WITHOUT us replacing Hermes' default
//// assigned-issue workflow.

/** The per-agent working directory Hermes runs from (sibling of memories/). */
export function agentWorkspaceDir(home: string): string {
  return join(home, "workspace");
}

/**
 * The AGENTS.md content Hermes auto-injects from the run cwd. Role-aware:
 * the main coordinator routes (its chat promptTemplate already covers that),
 * specialists execute their assigned issue with the real business tools.
 */
function buildToolsGuide(role: string | null | undefined, name: string | null | undefined): string {
  const who = name ? name : "this agent";
  const r = (role ?? "").toLowerCase();
  if (r === "main") {
    return [
      `# ${who} — coordinator`,
      "",
      "You route work to specialists; you do not execute domain tasks yourself.",
      "Delegate ONLY via the Paperclip endpoint described in your chat instructions",
      "(POST /companies/{companyId}/issues/delegate). Never use Hermes' native",
      "delegate_task / todo / cronjob to hand work to a colleague — Paperclip issues",
      "are the single source of truth.",
      "",
    ].join("\n");
  }
  return [
    `# ${who} — using your NeoCompany business tools`,
    "",
    "You are working an assigned Paperclip issue. When the task needs a real",
    "business action (write/publish a blog post, send an email, generate an image,",
    "draft a social post, run an SEO/analytics check), you MUST call the real",
    "NeoCompany tool. NEVER fabricate the result, invent a metric/URL, or write a",
    "\"dry-run\" stand-in — do the real action or say plainly what you could not do.",
    "You may report an inability ONLY AFTER you actually ran the tool call and saw",
    "its real error. NEVER declare a tool/feature \"unavailable\", \"not configured\",",
    "or missing a key WITHOUT having executed it first — that is a fabrication.",
    "",
    "## CRITICAL — authenticate EVERY call",
    "Every request to `$PAPERCLIP_API_URL` — including GET/reads — MUST carry",
    "`-H \"Authorization: Bearer $PAPERCLIP_API_KEY\"` (plus",
    "`-H \"X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID\"` on writes). The key is already in",
    "your environment. A `401` means you OMITTED the header — add it and retry. A 401",
    "NEVER means the API, a tool, or image generation is \"unavailable\". Do NOT make",
    "exploratory GET calls to \"read\" your issue first — the task is already in this",
    "prompt. Go straight to your deliverable tool.",
    "",
    "## Be efficient and resilient",
    "Go STRAIGHT to the action tool for the task — do NOT run pre-checks first",
    "(e.g. don't call `wpSiteHealth` before `wpCreatePost`; just create the draft).",
    "If a tool call returns an error, do NOT retry it in a loop and do NOT get stuck:",
    "try the main action anyway, or report the failure honestly in your comment and",
    "finish the issue. Aim to complete in a handful of tool calls.",
    "",
    "## How to run a business tool",
    "Tools execute server-side with the company's stored credentials. Call them via",
    "the Paperclip tool endpoint, using the SAME API base you use for issues",
    "(`$PAPERCLIP_API_URL`):",
    "",
    "1. Write the body to `/tmp/tool.json` with the write_file tool:",
    '   {"tool":"<toolName>","parameters":{ ... }}',
    "2. Run it with the terminal tool:",
    '   curl -sS -X POST "$PAPERCLIP_API_URL/plugins/tools/execute" \\',
    '     -H "Authorization: Bearer $PAPERCLIP_API_KEY" \\',
    '     -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \\',
    '     -H "Content-Type: application/json" --data @/tmp/tool.json',
    "3. Read the JSON response. On error, report it honestly in your issue comment.",
    "",
    "## The deliverable per domain IS the tool's result — not a text file or issue document",
    "Pick the tools for your role and produce the REAL artifact. Writing the text",
    "into a file or an issue document is NOT the deliverable.",
    "- **Blog / website article** → create a WordPress DRAFT with `wpCreatePost`",
    "  (defaults to status=draft, safe). The deliverable is the WordPress draft, not",
    "  a `.md` file. Also: `wpUpdatePost`, `wpListPosts`, `wpListCategories`, `wpSiteHealth`.",
    "- **Social post (LinkedIn/Facebook/Instagram)** → generate copy with",
    "  `contentGenerateSocialPosts`, then create a DRAFT for human approval with",
    "  `socialDraftCreate` (params: `provider` [linkedin|facebook|instagram], `text`,",
    "  optional `imageId`). It lands in the Approvals screen; approval publishes it.",
    "  NEVER publish directly, NEVER fabricate a published post.",
    "- **Image / visual** → call the Paperclip `imageGenerate` tool via the curl",
    "  recipe above (POST /plugins/tools/execute). This is a PAPERCLIP TOOL, NOT a",
    "  Hermes-native capability. IGNORE any built-in / Nous Portal / Tool Gateway /",
    "  FAL image generation — none of that exists or is used here. The Paperclip",
    "  `imageGenerate` tool runs the server's Codex CLI (our subscription) and needs",
    "  NO API key, NO FAL_KEY, NO Nous Portal login. For ANY image request your FIRST",
    "  action MUST be the imageGenerate curl — do NOT reason about availability, do",
    "  NOT list issues first, just run it and wait (it takes ~2 min). NEVER write that",
    "  image generation is unavailable / missing FAL / missing a key — that is FALSE",
    "  and is a fabrication. The result lands in the image library. Also: `imageList`, `imageApprove`.",
    "- **Email** → `emailSendMessage` to send (only when the task clearly asks to send",
    "  to a real recipient); `emailListMessages` / `emailReadMessage` to read inbound.",
    "- **SEO / analytics** → read LIVE with `seoGa4Traffic`, `seoGscKeywords`,",
    "  `seoGscTopPages`, `seoPageSpeed`, `seoContentAudit`, `seoQuickWins`,",
    "  `seoTrendAnalysis`. If the company has no Google connection the tool errors —",
    "  report that honestly, never invent numbers.",
    "- **Ideas / strategy** → `contentTopicIdeas`, `contentGenerateSocialPosts`.",
    "",
    "If a tool returns an error (missing credentials/connection), say so plainly in",
    "your issue comment — do NOT fabricate the result or pass off a local file as",
    "the deliverable.",
    "",
    "## When done",
    "Post a comment on your assigned issue describing exactly what you did (and any",
    "draft/post ids), then set the issue status to done via the Paperclip API.",
    "",
  ].join("\n");
}

/** Create the workspace dir and write the role-aware AGENTS.md tools guide. */
//// Neocompany Modification — codex image-generation Hermes skill.
//// Hermes agents reach for their NATIVE image skills (creative/*, inference-sh
//// = FAL, the Nous Portal / Tool Gateway managed-FAL path) when asked for an
//// image, find them unconfigured, and give up — they ignore the AGENTS.md
//// prose that points them at the Paperclip `imageGenerate` curl. Skills are the
//// mechanism Hermes actively SELECTS for a task, so we ship a dominant
//// image-generation skill that routes to the Paperclip tool (which runs the
//// local Codex CLI, no key). Strong description + tags so the skill scanner
//// picks it over the FAL ones; explicit "do not use FAL/Nous Portal" so the
//// model stops confabulating unavailability.
function buildCodexImageSkill(): string {
  return [
    "---",
    "name: neocompany-image-generate",
    'description: "Generate ANY raster image — product photo, illustration, mockup, social visual, background, logo concept, picture — for a NeoCompany task. This is the ONLY working image generator on this instance: it runs the local Codex CLI via the Paperclip imageGenerate tool and needs NO API key, NO FAL, NO Nous Portal, NO OpenAI key. ALWAYS use this skill for any image/visual/picture/photo request. NEVER use inference-sh, FAL, built-in image_gen, or the Nous Portal / Tool Gateway path — they are not configured here and do not apply."',
    "version: 1.0.0",
    "author: NeoCompany",
    "license: MIT",
    "platforms: [linux]",
    "prerequisites:",
    "  env_vars: [PAPERCLIP_API_URL, PAPERCLIP_API_KEY, PAPERCLIP_RUN_ID]",
    "  commands: [curl]",
    "metadata:",
    "  hermes:",
    "    tags: [image, image-generation, generate-image, create-image, product-photo, illustration, visual, picture, photo, mockup, design, graphic, render]",
    "---",
    "",
    "# NeoCompany Image Generation (Codex CLI — no key)",
    "",
    "Generate an image for the current task. Image generation IS available here and",
    "needs NO API key. It runs the server's **Codex CLI** through the Paperclip",
    "`imageGenerate` tool. There is **NO FAL, NO Nous Portal, NO Tool Gateway, NO",
    "OpenAI key** involved — ignore any such requirement, it does not apply on this",
    "instance. The generated image is saved to the company image library.",
    "",
    "## When to use",
    "For ANY request to create / generate / draw / render / produce an image, photo,",
    "illustration, mockup, background, social visual, or picture. This is the ONLY",
    "image generator that works here. Do NOT reach for inference-sh, FAL, a built-in",
    "image tool, or `hermes model` / Nous Portal — they are NOT used and will not work.",
    "",
    "## How — this is your FIRST and only action for an image task",
    "1. Write the request body to `/tmp/imgtool.json` with the write_file tool",
    "   (pick width×height: 1024x1024 square, 1024x1536 portrait, 1536x1024 landscape):",
    '   {"tool":"imageGenerate","parameters":{"prompt":"<full descriptive prompt>","width":1024,"height":1024}}',
    "2. Run it with the terminal tool (it takes ~2 min while Codex renders — wait for it):",
    '   curl -sS -X POST "$PAPERCLIP_API_URL/plugins/tools/execute" \\',
    '     -H "Authorization: Bearer $PAPERCLIP_API_KEY" \\',
    '     -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \\',
    '     -H "Content-Type: application/json" --data @/tmp/imgtool.json',
    "3. On success the JSON result holds the generated image id and it is in the",
    "   library — report success with that id.",
    "4. If (and only if) the call returns an explicit error, report that EXACT error.",
    "   NEVER write that image generation is unavailable / missing FAL_KEY / needs a",
    "   key or Nous Portal login — that is FALSE here and is a fabrication.",
    "",
  ].join("\n");
}
//// End Neocompany Modification

async function seedAgentWorkspace(
  home: string,
  role: string | null | undefined,
  name: string | null | undefined,
): Promise<void> {
  const ws = agentWorkspaceDir(home);
  await mkdir(ws, { recursive: true });
  // Overwrite each run so the guide always reflects the current code.
  await writeFile(join(ws, "AGENTS.md"), buildToolsGuide(role, name), "utf8");
  //// Neocompany Modification — seed the codex image-generation skill so the
  //// Hermes skill scanner offers it (and the agent selects it) for image tasks
  //// instead of the FAL / Nous Portal native skills. Re-seeded each run.
  const skillDir = join(home, "skills", "neocompany", "image-generate");
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), buildCodexImageSkill(), "utf8");
  //// End Neocompany Modification
}

/**
 * Ensure the `HERMES_HOME` directory (and its `memories/` subdir) exists.
 * No-op + returns `null` when isolation is disabled. Returns the resolved
 * path on success so the caller can inject it into the adapter env.
 *
 * Also seeds `auth.json` + `config.yaml` from the default `~/.hermes/`
 * install when they are missing (idempotent). The Hermes CLI uses these
 * to talk to its provider — a fresh per-(company,user,agent) bucket has
 * neither, so without this step every chat run aborts with "Hermes isn't
 * configured yet".
 */
export async function ensureHermesHome(
  companyId: string,
  userId: string | null | undefined,
  agentId: string,
  //// Neocompany Modification — optional agent identity so the workspace
  //// AGENTS.md tools guide can be role-aware. Optional to keep existing
  //// callers (tests) working.
  opts?: { role?: string | null; name?: string | null },
  //// End Neocompany Modification
): Promise<string | null> {
  const home = resolveHermesHome(companyId, userId, agentId);
  if (!home) return null;
  await mkdir(join(home, "memories"), { recursive: true });
  await seedHermesHomeCredentials(home);
  //// Neocompany Modification — seed the per-agent workspace + tools guide.
  await seedAgentWorkspace(home, opts?.role, opts?.name);
  //// End Neocompany Modification
  return home;
}
