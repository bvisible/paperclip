//// Neocompany Modification — Playwright config for NeoCompany E2E suite
//// Targets prod (app.neocompany.ch) by default, hitting the __TEST_E2E__
//// company that scripts/provision-all-test-companies.sh provisioned.
//// Auth is handled by globalSetup which signs in once and caches the
//// storage state in tests/e2e/neocompany/.auth/admin.json — every spec
//// reuses it, so no per-test login overhead.
////
//// Run:
////   pnpm run test:e2e:neocompany               (headless)
////   pnpm run test:e2e:neocompany:headed        (live, for debugging)
////   PAPERCLIP_BASE_URL=http://localhost:3100 pnpm run test:e2e:neocompany  (local)
//// End Neocompany Modification

import { defineConfig } from "@playwright/test";

const BASE_URL =
  process.env.PAPERCLIP_BASE_URL ?? "https://app.neocompany.ch";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: BASE_URL,
    headless: process.env.PWDEBUG ? false : true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
    // Reuse the cached admin session from globalSetup.
    storageState: "tests/e2e/neocompany/.auth/admin.json",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  outputDir: "./test-results",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "./playwright-report" }],
  ],
});
