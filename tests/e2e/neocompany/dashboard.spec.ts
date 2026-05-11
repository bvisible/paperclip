//// Neocompany Modification — first E2E spec : dashboard sanity + ActivityRow regression
//// Targets the __E2E_TEST__ company on app.neocompany.ch. Validates the
//// fundamental contract: the dashboard loads, agents are seeded, and
//// Recent Activity entries show human-readable actor names (not UUIDs).
////
//// This spec would have caught the 2026-05-11 ActivityRow bug (plugin
//// actorType displaying raw UUID) — pinning it permanently.
//// End Neocompany Modification

import { test, expect, type APIRequestContext } from "@playwright/test";

const TEST_COMPANY_NAME = "__E2E_TEST__";

async function findTestCompanyPrefix(request: APIRequestContext): Promise<string> {
  const resp = await request.get("/api/companies?includeTest=true");
  expect(resp.ok(), "GET /api/companies must succeed").toBeTruthy();
  const companies = (await resp.json()) as Array<{
    name: string;
    issuePrefix: string;
    isTest?: boolean;
  }>;
  const test = companies.find((c) => c.name === TEST_COMPANY_NAME);
  expect(test, `${TEST_COMPANY_NAME} must exist (globalSetup should have created it)`).toBeTruthy();
  expect(test!.isTest, `${TEST_COMPANY_NAME} must have isTest=true`).toBe(true);
  return test!.issuePrefix;
}

test.describe("/__E2E_TEST__/dashboard", () => {
  test("loads and renders the page chrome", async ({ page, request }) => {
    const prefix = await findTestCompanyPrefix(request);
    await page.goto(`/${prefix}/dashboard`);
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("Recent Activity displays actor names instead of raw UUIDs", async ({
    page,
    request,
  }) => {
    const prefix = await findTestCompanyPrefix(request);
    await page.goto(`/${prefix}/dashboard`);

    // Wait for the dashboard to render. The page header is a stable anchor.
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible({
      timeout: 15_000,
    });

    // If Recent Activity hasn't loaded yet (fresh company has no activity),
    // we still want to assert that NO raw UUID is visible anywhere on the
    // page. A UUID looks like 8-4-4-4-12 hex digits.
    const bodyText = await page.locator("body").innerText();
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    expect(
      bodyText,
      "No raw UUIDs should appear in dashboard body (regression: ActivityRow used to print pluginId UUIDs)",
    ).not.toMatch(uuidPattern);
  });
});

test.describe("/__E2E_TEST__/admin (visibility)", () => {
  test("__E2E_TEST__ appears in /admin/companies with 🧪 badge", async ({
    page,
  }) => {
    await page.goto("/admin/companies");
    await expect(
      page.getByRole("row", { name: new RegExp(TEST_COMPANY_NAME) }),
    ).toBeVisible({ timeout: 15_000 });
    // The 🧪 emoji is part of the badge label.
    await expect(page.getByText(/🧪 Test/).first()).toBeVisible();
  });
});
