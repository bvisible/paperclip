//// Neocompany Modification — Phase 2.B E2E content pipeline
//// Validates the user-facing content pipeline end-to-end against the
//// __E2E_TEST__ company on prod (or PAPERCLIP_BASE_URL if overridden):
////
////   1. Brand template lifecycle  (templateSave → templateList → templateDelete)
////   2. Library image lifecycle   (libraryUpload → imageList → imageApprove → imageDelete)
////   3. Calendar / draft pipeline (draftCreate → approveDraftPost → socialPostsList
////                                  → rescheduleSocialPost → cancelSocialPost)
////
//// All three pipelines are idempotent: each test cleans up its own
//// artifacts in the `afterEach`/`finally`, so re-running the suite on the
//// same company never accumulates garbage. The names include a `e2e-`
//// prefix + UUID so an interrupted run leaves identifiable rows that
//// `scripts/cleanup-test-company.sh` can flush.
////
//// The heavy `imageGenerate` (codex-cli subprocess, ~30s-2min) is NOT
//// covered here — see `content-pipeline-codex.spec.ts` (gated by
//// PAPERCLIP_E2E_CODEX=1) for that path. We intentionally skip it in CI
//// to stay under the 10/h quota and keep the standard suite < 30s.
//// End Neocompany Modification

import { test, expect, type APIRequestContext } from "@playwright/test";

const TEST_COMPANY_NAME = "__E2E_TEST__";
const NEOCOMPANY_TOOLS_KEY = "neocompany-tools";

// 1×1 transparent PNG, base64 — smallest possible payload for libraryUpload.
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";

interface CompanyView {
  id: string;
  name: string;
  issuePrefix: string;
  isTest?: boolean;
}

interface PluginView {
  id: string;
  pluginKey: string;
  status: string;
}

interface BridgeOk<T> {
  data: T;
}

interface TemplateRow {
  id: string;
  name?: string;
  width?: number;
  height?: number;
}

interface ImageRow {
  id: string;
  status: "pending" | "approved" | "rejected";
  source?: "generated" | "upload";
  tags?: string[];
}

interface SocialPostRow {
  id: string;
  text?: string;
  status: string;
  scheduledAt?: string;
  proposedAt?: string;
}

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

async function resolveCompanyId(request: APIRequestContext): Promise<string> {
  const resp = await request.get("/api/companies?includeTest=true");
  expect(resp.ok(), "GET /api/companies must succeed").toBeTruthy();
  const companies = (await resp.json()) as CompanyView[];
  const target = companies.find((c) => c.name === TEST_COMPANY_NAME);
  expect(target, `${TEST_COMPANY_NAME} must exist (globalSetup creates it)`).toBeTruthy();
  return target!.id;
}

async function resolvePluginId(request: APIRequestContext): Promise<string> {
  const resp = await request.get("/api/plugins");
  expect(resp.ok(), "GET /api/plugins must succeed").toBeTruthy();
  const plugins = (await resp.json()) as PluginView[];
  const neo = plugins.find((p) => p.pluginKey === NEOCOMPANY_TOOLS_KEY);
  expect(neo, `${NEOCOMPANY_TOOLS_KEY} plugin must be installed`).toBeTruthy();
  expect(neo!.status, "plugin must be ready").toBe("ready");
  return neo!.id;
}

// The server's boardMutationGuard rejects POSTs that don't carry an Origin
// matching the configured base URL. Playwright's APIRequestContext from the
// `request` fixture doesn't fill it in by default, so we add it explicitly.
function bridgeHeaders(): Record<string, string> {
  const baseURL = process.env.PAPERCLIP_BASE_URL ?? "https://app.neocompany.ch";
  return { Origin: baseURL, Referer: baseURL };
}

async function callData<T>(
  request: APIRequestContext,
  pluginId: string,
  key: string,
  companyId: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const resp = await request.post(`/api/plugins/${pluginId}/data/${key}`, {
    headers: bridgeHeaders(),
    data: { companyId, params: { companyId, ...params } },
  });
  expect(
    resp.ok(),
    `POST /api/plugins/${pluginId}/data/${key} must succeed (got ${resp.status()}: ${await resp.text().catch(() => "")})`,
  ).toBeTruthy();
  const body = (await resp.json()) as BridgeOk<T>;
  return body.data;
}

async function callAction<T>(
  request: APIRequestContext,
  pluginId: string,
  key: string,
  companyId: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const resp = await request.post(`/api/plugins/${pluginId}/actions/${key}`, {
    headers: bridgeHeaders(),
    data: { companyId, params: { companyId, ...params } },
  });
  expect(
    resp.ok(),
    `POST /api/plugins/${pluginId}/actions/${key} must succeed (got ${resp.status()}: ${await resp.text().catch(() => "")})`,
  ).toBeTruthy();
  const body = (await resp.json()) as BridgeOk<T>;
  return body.data;
}

// ---------------------------------------------------------------------------
// Pipeline 1 — Brand template lifecycle
// ---------------------------------------------------------------------------

test.describe("content pipeline — brand templates", () => {
  test("create, list, delete a brand template", async ({ request }) => {
    const companyId = await resolveCompanyId(request);
    const pluginId = await resolvePluginId(request);
    const tag = `e2e-tpl-${Date.now()}`;
    const templateName = `E2E template ${tag}`;
    let createdTemplateId: string | undefined;

    try {
      // 1. Create
      const created = await callAction<{ ok: boolean; templateId: string }>(
        request,
        pluginId,
        "templateSave",
        companyId,
        {
          data: {
            name: templateName,
            description: tag,
            width: 1080,
            height: 1080,
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
        },
      );
      expect(created.ok, "templateSave should return ok:true").toBe(true);
      expect(created.templateId, "templateSave should return a templateId").toBeTruthy();
      createdTemplateId = created.templateId;

      // 2. List → should contain our template
      const listed = await callData<{ templates: TemplateRow[] }>(
        request,
        pluginId,
        "templateList",
        companyId,
      );
      const ours = listed.templates.find((t) => t.id === createdTemplateId);
      expect(ours, `template ${createdTemplateId} must appear in templateList`).toBeTruthy();
      expect(ours!.name).toBe(templateName);
      expect(ours!.width).toBe(1080);
      expect(ours!.height).toBe(1080);
    } finally {
      // 3. Delete (best-effort cleanup, ignore failures so the test still
      // reports the real assertion that failed above).
      if (createdTemplateId) {
        await callAction<{ ok: boolean }>(request, pluginId, "templateDelete", companyId, {
          templateId: createdTemplateId,
        }).catch(() => undefined);

        // 4. Verify it's gone
        const afterDelete = await callData<{ templates: TemplateRow[] }>(
          request,
          pluginId,
          "templateList",
          companyId,
        );
        const stillThere = afterDelete.templates.find((t) => t.id === createdTemplateId);
        expect(stillThere, `template ${createdTemplateId} must be gone after delete`).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Pipeline 2 — Library image lifecycle (upload → list → approve → delete)
// ---------------------------------------------------------------------------

test.describe("content pipeline — library images", () => {
  test("upload, list, approve, delete a library image", async ({ request }) => {
    const companyId = await resolveCompanyId(request);
    const pluginId = await resolvePluginId(request);
    const filename = `e2e-img-${Date.now()}.png`;
    let imageId: string | undefined;

    try {
      // 1. Upload a tiny PNG (libraryUpload requires a data: URL).
      const uploaded = await callAction<{
        imageId: string;
        width: number;
        height: number;
        status: string;
      }>(request, pluginId, "libraryUpload", companyId, {
        imageDataUrl: TINY_PNG_DATA_URL,
        width: 1,
        height: 1,
        filename,
        tags: ["e2e"],
      });
      expect(uploaded.imageId).toBeTruthy();
      // libraryUpload pre-approves uploaded images.
      expect(uploaded.status).toBe("approved");
      imageId = uploaded.imageId;

      // 2. List → must contain our upload (includeImages=false to avoid
      // pulling MB-sized data URLs back).
      const listed = await callData<{ images: ImageRow[] }>(
        request,
        pluginId,
        "imageList",
        companyId,
        { includeImages: false, source: "upload" },
      );
      const ours = listed.images.find((i) => i.id === imageId);
      expect(ours, `uploaded image ${imageId} must appear in imageList`).toBeTruthy();
      expect(ours!.source).toBe("upload");

      // 3. Re-approve (no-op for an already-approved upload, but exercises
      // the approve path so we know it round-trips through the worker).
      const approved = await callAction<{ imageId: string; status: string }>(
        request,
        pluginId,
        "imageApprove",
        companyId,
        { imageId, status: "approved", feedback: "ok by e2e suite" },
      );
      expect(approved.status).toBe("approved");
    } finally {
      // 4. Delete the image we created.
      if (imageId) {
        await callAction<{ ok: boolean }>(request, pluginId, "imageDelete", companyId, {
          imageId,
        }).catch(() => undefined);

        // 5. Verify it's gone.
        const afterDelete = await callData<{ images: ImageRow[] }>(
          request,
          pluginId,
          "imageList",
          companyId,
          { includeImages: false, source: "upload" },
        );
        const stillThere = afterDelete.images.find((i) => i.id === imageId);
        expect(stillThere, `image ${imageId} must be gone after delete`).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Pipeline 3 — Calendar / draft lifecycle
// (draftCreate → approveDraftPost → socialPostsList → reschedule → cancel)
// ---------------------------------------------------------------------------

test.describe("content pipeline — calendar drafts", () => {
  test("create, approve, reschedule, cancel a draft post", async ({ request }) => {
    const companyId = await resolveCompanyId(request);
    const pluginId = await resolvePluginId(request);
    const initialProposedAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const rescheduledAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    let postId: string | undefined;

    try {
      // 1. Create a draft post (pending_review).
      const draft = await callAction<{ postId: string; status: string }>(
        request,
        pluginId,
        "draftCreate",
        companyId,
        {
          channel: { provider: "linkedin", channelKey: "e2e-channel" },
          text: `E2E draft ${Date.now()}`,
          proposedAt: initialProposedAt,
        },
      );
      expect(draft.postId).toBeTruthy();
      expect(draft.status).toBe("pending_review");
      postId = draft.postId;

      // 2. Approve the draft → status moves to "scheduled".
      const approved = await callAction<{ ok: boolean; status: string }>(
        request,
        pluginId,
        "approveDraftPost",
        companyId,
        { postId },
      );
      expect(approved.ok ?? true, "approveDraftPost should succeed").toBeTruthy();

      // 3. Verify it's now in the calendar list with status=scheduled.
      const listed = await callData<{ posts: SocialPostRow[] }>(
        request,
        pluginId,
        "socialPostsList",
        companyId,
        { limit: 100 },
      );
      const ours = listed.posts.find((p) => p.id === postId);
      expect(ours, `post ${postId} must appear in socialPostsList after approval`).toBeTruthy();
      expect(ours!.status).toBe("scheduled");

      // 4. Reschedule it 24h later — exercises the calendar drag-drop path.
      const rescheduled = await callAction<{ ok: boolean; scheduledAt: string }>(
        request,
        pluginId,
        "rescheduleSocialPost",
        companyId,
        { postId, scheduledAt: rescheduledAt },
      );
      expect(rescheduled.scheduledAt).toBe(rescheduledAt);
    } finally {
      // 5. Cancel (= delete) the test post.
      if (postId) {
        await callAction<{ ok: boolean }>(request, pluginId, "cancelSocialPost", companyId, {
          postId,
        }).catch(() => undefined);

        // 6. Verify it's gone.
        const afterCancel = await callData<{ posts: SocialPostRow[] }>(
          request,
          pluginId,
          "socialPostsList",
          companyId,
          { limit: 100 },
        );
        const stillThere = afterCancel.posts.find((p) => p.id === postId);
        expect(stillThere, `post ${postId} must be gone after cancel`).toBeUndefined();
      }
    }
  });
});
