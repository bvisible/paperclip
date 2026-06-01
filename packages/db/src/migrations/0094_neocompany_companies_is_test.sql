-- //// Neocompany Modification — is_test flag for hidden dev/test companies
-- Companies tagged is_test=true are filtered out of board-level company
-- lists for non-instance-admins. Used to host __TEST_E2E__ / __TEST_SMOKE__ /
-- __TEST_MANUAL__ companies on app.neocompany.ch so tests run against the
-- real prod plugins/DB/codex-cli without polluting client-visible UIs.
-- //// End Neocompany Modification
ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "is_test" boolean NOT NULL DEFAULT false;
