#!/usr/bin/env bash
# //// Neocompany Modification — provision the 3 standard test companies
# One-shot script that creates the standard test-company trio used by the
# tests/robustesse plan:
#   - __TEST_E2E__     — target of Playwright E2E suites
#   - __TEST_SMOKE__   — target of post-deploy smoke checks
#   - __TEST_MANUAL__  — dev sandbox for ad-hoc manual testing
#
# Idempotent: each provisioning is a no-op when the company already exists.
# Auth is automatic via scripts/lib/paperclip-admin-auth.sh.
#
# Usage:
#   bash scripts/provision-all-test-companies.sh
# //// End Neocompany Modification

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Names are chosen so they yield distinct 3-letter prefixes via the upstream
# deriveIssuePrefixBase logic (strips non-alpha, takes first 3 chars):
#   __E2E_TEST__    → EET
#   __SMOKE_TEST__  → SMO
#   __MANUAL_TEST__ → MAN
# Avoid names starting with TEST_ because they all collapse to "TES" and
# the upstream retry-with-suffix logic doesn't always detect the conflict
# error code from postgres.js (silently bubbles up as 500).
for NAME in __E2E_TEST__ __SMOKE_TEST__ __MANUAL_TEST__; do
  printf '\n\033[36m▸ Provisioning %s\033[0m\n' "${NAME}"
  "${SCRIPT_DIR}/provision-test-company.sh" "${NAME}"
done

printf '\n\033[32m✓ All 3 test companies provisioned (or already existed).\033[0m\n'
