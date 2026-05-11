//// Neocompany Modification — Phase 2.E E2E platform smoke
//// Validates the runtime platform state against prod:
////
////   1. Exactly 2 plugins are activated (paperclip-chat + neocompany-tools),
////      both with status="ready".
////   2. neocompany-tools exposes 30 tools (catalog data handler).
////   3. neocompany-tools has 3 plugin jobs declared/active
////      (imap-poll, social-publisher, pixel-autopilot).
////
//// This is the cheapest test that catches "plugins failed to load",
//// "tools registry drifted", and "job scheduler regressed" — all of which
//// are silent regressions that the dashboard / chat / content E2Es would
//// only catch indirectly. The bash script smoke-prod-neocompany.sh does
//// the same checks from the server side; this spec mirrors them from the
//// client side so a CI run on a fresh deploy catches the same issues.
//// End Neocompany Modification

import { test, expect, type APIRequestContext } from "@playwright/test";

interface PluginView {
  id: string;
  pluginKey: string;
  status: string;
}

interface PluginJobView {
  jobId?: string;
  jobKey?: string;
  key?: string;
  status?: string;
  state?: string;
}

interface BridgeOk<T> {
  data: T;
}

interface ToolCatalog {
  toolCount: number;
  categories: Record<string, { label: string; tools: Array<{ name: string }> }>;
}

const NEOCOMPANY_TOOLS_KEY = "neocompany-tools";
const PAPERCLIP_CHAT_KEY = "paperclip-chat";
const EXPECTED_TOOL_COUNT = 30;
const EXPECTED_PLUGIN_KEYS = new Set([NEOCOMPANY_TOOLS_KEY, PAPERCLIP_CHAT_KEY]);
const EXPECTED_JOB_KEYS = new Set(["imap-poll", "social-publisher", "pixel-autopilot"]);

function bridgeHeaders(): Record<string, string> {
  const baseURL = process.env.PAPERCLIP_BASE_URL ?? "https://app.neocompany.ch";
  return { Origin: baseURL, Referer: baseURL };
}

async function listPlugins(request: APIRequestContext): Promise<PluginView[]> {
  const resp = await request.get("/api/plugins");
  expect(resp.ok(), "GET /api/plugins must succeed").toBeTruthy();
  return (await resp.json()) as PluginView[];
}

async function getNeoToolsPluginId(request: APIRequestContext): Promise<string> {
  const plugins = await listPlugins(request);
  const neo = plugins.find((p) => p.pluginKey === NEOCOMPANY_TOOLS_KEY);
  expect(neo, `${NEOCOMPANY_TOOLS_KEY} plugin must be installed`).toBeTruthy();
  return neo!.id;
}

async function callData<T>(
  request: APIRequestContext,
  pluginId: string,
  key: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const resp = await request.post(`/api/plugins/${pluginId}/data/${key}`, {
    headers: bridgeHeaders(),
    data: { params },
  });
  expect(
    resp.ok(),
    `POST /api/plugins/${pluginId}/data/${key} must succeed (got ${resp.status()}: ${await resp.text().catch(() => "")})`,
  ).toBeTruthy();
  const body = (await resp.json()) as BridgeOk<T>;
  return body.data;
}

// ---------------------------------------------------------------------------
// 1. Plugins activation contract
// ---------------------------------------------------------------------------

test.describe("smoke — plugins", () => {
  test("exactly the expected fork plugins are activated and ready", async ({ request }) => {
    const plugins = await listPlugins(request);

    // Restrict to the fork plugins — upstream may add platform plugins that
    // we don't want to police here. We assert presence + readiness only for
    // the ones we ship and care about.
    const ours = plugins.filter((p) => EXPECTED_PLUGIN_KEYS.has(p.pluginKey));
    const keys = new Set(ours.map((p) => p.pluginKey));
    for (const expected of EXPECTED_PLUGIN_KEYS) {
      expect(keys, `${expected} plugin must be installed`).toContain(expected);
    }
    for (const p of ours) {
      expect(
        p.status,
        `plugin ${p.pluginKey} must be ready (got status=${p.status})`,
      ).toBe("ready");
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Tool registry contract (catches drift in ALL_TOOLS or registry.ts)
// ---------------------------------------------------------------------------

test.describe("smoke — tools", () => {
  test("neocompany-tools exposes the expected number of tools", async ({ request }) => {
    const pluginId = await getNeoToolsPluginId(request);
    const catalog = await callData<ToolCatalog>(request, pluginId, "toolCatalog");
    expect(
      catalog.toolCount,
      `neocompany-tools must expose exactly ${EXPECTED_TOOL_COUNT} tools`,
    ).toBe(EXPECTED_TOOL_COUNT);

    // Sanity: every category has a label + at least one tool.
    for (const [key, value] of Object.entries(catalog.categories)) {
      expect(value.label, `category ${key} must have a label`).toBeTruthy();
      expect(
        value.tools.length,
        `category ${key} must contain at least one tool`,
      ).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Plugin jobs contract
// ---------------------------------------------------------------------------

test.describe("smoke — jobs", () => {
  test("neocompany-tools registers the 3 expected jobs", async ({ request }) => {
    const pluginId = await getNeoToolsPluginId(request);
    const resp = await request.get(`/api/plugins/${pluginId}/jobs`);
    expect(
      resp.ok(),
      `GET /api/plugins/${pluginId}/jobs must succeed (got ${resp.status()})`,
    ).toBeTruthy();
    const body = await resp.json();
    // Shape varies (array of jobs OR { jobs: [...] }); accept both.
    const jobs: PluginJobView[] = Array.isArray(body)
      ? (body as PluginJobView[])
      : (body.jobs as PluginJobView[] | undefined) ?? [];
    const keys = new Set(
      jobs
        .map((j) => j.jobKey ?? j.key ?? j.jobId)
        .filter((k): k is string => typeof k === "string"),
    );
    for (const expected of EXPECTED_JOB_KEYS) {
      expect(
        keys,
        `expected job key "${expected}" missing from /api/plugins/.../jobs (got: ${[...keys].join(", ") || "<empty>"})`,
      ).toContain(expected);
    }
  });
});
