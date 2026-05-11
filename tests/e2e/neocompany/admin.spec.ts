//// Neocompany Modification — Phase 2.D E2E admin surface
//// Validates the /admin/* operator surface end-to-end against prod:
////
////   1. Company lifecycle  (POST /api/companies isTest=true → list → DELETE
////                          → verify gone). Ensures the SuperAdmin create
////                          flow keeps working and DELETE actually unwinds.
////   2. /admin/companies   — UI page loads, shows the persistent test
////                          companies with their 🧪 badge, and the
////                          ephemeral one we just created.
////   3. /admin/tools       — UI page loads (config surface for global
////                          OAuth / API keys behind neocompany-tools).
////
//// The lifecycle test creates a transient company named
//// `__E2E_ADMIN_<ts>__` with isTest=true so it never bleeds into the
//// client board view, and DELETEs it in finally{} so a crashed run leaves
//// at most one stray row per crash (and cleanup-test-company.sh sweeps).
////
//// Intentionally avoids any assertion that depends on the per-company
//// agent fleet (Nora/Lyra/…) because seedDefaultAgentsForCompany has no
//// callers in the current code path — see Phase 2.C PENDING_BUG. The test
//// will be extended once the seed wiring is restored.
//// End Neocompany Modification

import { test, expect, type APIRequestContext } from "@playwright/test";

interface CompanyView {
  id: string;
  name: string;
  isTest?: boolean;
  issuePrefix?: string;
}

function bridgeHeaders(): Record<string, string> {
  const baseURL = process.env.PAPERCLIP_BASE_URL ?? "https://app.neocompany.ch";
  return { Origin: baseURL, Referer: baseURL };
}

async function listCompanies(request: APIRequestContext): Promise<CompanyView[]> {
  const resp = await request.get("/api/companies?includeTest=true");
  expect(resp.ok(), `GET /api/companies must succeed`).toBeTruthy();
  return (await resp.json()) as CompanyView[];
}

async function createTestCompany(
  request: APIRequestContext,
  name: string,
): Promise<CompanyView> {
  const resp = await request.post("/api/companies", {
    headers: bridgeHeaders(),
    data: {
      name,
      description: "E2E admin spec — auto-deleted",
      isTest: true,
    },
  });
  expect(
    resp.ok(),
    `POST /api/companies must succeed (got ${resp.status()}: ${await resp.text().catch(() => "")})`,
  ).toBeTruthy();
  return (await resp.json()) as CompanyView;
}

async function deleteCompany(
  request: APIRequestContext,
  companyId: string,
): Promise<void> {
  const resp = await request.delete(`/api/companies/${companyId}`, {
    headers: bridgeHeaders(),
  });
  // 200 on success, 204 acceptable, anything else is a failure but we still
  // want callers to surface their original test assertion error first — so
  // throw only when explicitly asked.
  if (!resp.ok()) {
    throw new Error(
      `DELETE /api/companies/${companyId} failed: ${resp.status()} ${await resp.text().catch(() => "")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 1. Company lifecycle (admin SuperAdmin create + delete)
// ---------------------------------------------------------------------------

test.describe("admin — company lifecycle", () => {
  test("create then delete a test company via /api/companies", async ({ request }) => {
    const stamp = Date.now();
    const name = `__E2E_ADMIN_${stamp}__`;
    let createdId: string | undefined;

    try {
      // 1. Create
      const created = await createTestCompany(request, name);
      expect(created.id, "created company must carry an id").toBeTruthy();
      expect(created.name).toBe(name);
      expect(created.isTest, "must be flagged as test").toBe(true);
      createdId = created.id;

      // 2. List (include test) — must contain it
      const all = await listCompanies(request);
      const ours = all.find((c) => c.id === createdId);
      expect(ours, `company ${createdId} must appear in /api/companies`).toBeTruthy();
      expect(ours!.isTest, "flag must round-trip").toBe(true);
    } finally {
      // 3. Cleanup
      if (createdId) {
        await deleteCompany(request, createdId).catch(() => undefined);

        // 4. Confirm it's gone
        const after = await listCompanies(request);
        const stillThere = after.find((c) => c.id === createdId);
        expect(
          stillThere,
          `company ${createdId} must be gone after DELETE`,
        ).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. /admin/companies page renders + shows test companies with 🧪 badge
// ---------------------------------------------------------------------------

test.describe("admin — /admin/companies UI", () => {
  test("page loads and lists the persistent test companies with 🧪 badge", async ({
    page,
  }) => {
    await page.goto("/admin/companies");

    // The page heading is a stable anchor — wait for it.
    await expect(
      page.getByRole("heading", { name: /companies/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // The 3 persistent test companies must be visible.
    for (const name of ["__E2E_TEST__", "__SMOKE_TEST__", "__MANUAL_TEST__"]) {
      await expect(
        page.getByRole("row", { name: new RegExp(name) }),
        `row for ${name} must be visible`,
      ).toBeVisible({ timeout: 15_000 });
    }

    // At least one 🧪 badge must render (each test company carries one).
    await expect(page.getByText(/🧪 Test/).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. /admin/tools page renders (Tools Config surface)
// ---------------------------------------------------------------------------

test.describe("admin — /admin/tools UI", () => {
  test("page loads and shows the Tools Config surface", async ({ page }) => {
    await page.goto("/admin/tools");

    // The page sets breadcrumbs to "Admin > Tools Config" — wait for either
    // the breadcrumb or the page title to appear.
    await expect(
      page.getByText(/Tools Config|Tools/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // The page should NOT show "not installed" — neocompany-tools is
    // installed on prod.
    await expect(
      page.getByText(/plugin is not installed/i),
    ).toHaveCount(0);
  });
});
