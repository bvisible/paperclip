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

for NAME in __TEST_E2E__ __TEST_SMOKE__ __TEST_MANUAL__; do
  printf '\n\033[36m▸ Provisioning %s\033[0m\n' "${NAME}"
  "${SCRIPT_DIR}/provision-test-company.sh" "${NAME}"
done

printf '\n\033[32m✓ All 3 test companies provisioned (or already existed).\033[0m\n'
