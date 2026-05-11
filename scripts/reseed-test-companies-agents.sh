#!/usr/bin/env bash
# //// Neocompany Modification — reseed seed-agent fleet on existing companies
#
# After deploying the seed-agents fix on 2026-05-11 (commit e98669f8) the
# /api/companies POST flow seeds the 9-agent fleet (Nora/Lyra/Nova/Maya/
# Ella/Atlas/Scout/Iris/Pixel) on every new company. But rows that
# existed BEFORE the fix (and any test company that was created with
# isTest=true while the seed call was missing) still have 0 agents.
#
# This script iterates a list of company names and POSTs to the
# `reseed-agents` admin bridge route. The route is idempotent (skips
# seedKeys already present), so it is safe to re-run.
#
# Defaults to the 3 persistent test companies. Override with arguments:
#
#   bash scripts/reseed-test-companies-agents.sh                  # 3 test companies
#   bash scripts/reseed-test-companies-agents.sh __TEST_E2E__ acme  # custom list
#
# //// End Neocompany Modification
set -euo pipefail

PAPERCLIP_BASE_URL="${PAPERCLIP_BASE_URL:-https://app.neocompany.ch}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default targets — match the persistent test companies on prod.
COMPANY_NAMES=("__E2E_TEST__" "__SMOKE_TEST__" "__MANUAL_TEST__")
if [ "$#" -gt 0 ]; then
  COMPANY_NAMES=("$@")
fi

# Authenticate as instance admin and source PAPERCLIP_SESSION_COOKIE.
# shellcheck source=lib/paperclip-admin-auth.sh
source "${SCRIPT_DIR}/lib/paperclip-admin-auth.sh"
paperclip_admin_auth

# Pull the company list once and build name → id.
companies_json="$(curl -fsS \
  -b "${PAPERCLIP_SESSION_COOKIE}" \
  "${PAPERCLIP_BASE_URL}/api/companies?includeTest=true")"

reseed_one() {
  local name="$1"
  local company_id
  company_id="$(printf '%s' "${companies_json}" | python3 -c "
import json, sys
target = '${name}'
for c in json.load(sys.stdin):
    if c.get('name') == target:
        print(c['id'])
        sys.exit(0)
sys.exit(1)
" || true)"
  if [ -z "${company_id}" ]; then
    echo "  ✗ ${name}: not found on ${PAPERCLIP_BASE_URL} (skipping)"
    return 0
  fi

  echo "▸ ${name} (${company_id})"
  local resp
  resp="$(curl -sS \
    -X POST \
    -H "Content-Type: application/json" \
    -H "Origin: ${PAPERCLIP_BASE_URL}" \
    -H "Referer: ${PAPERCLIP_BASE_URL}" \
    -b "${PAPERCLIP_SESSION_COOKIE}" \
    -d "{\"companyId\":\"${company_id}\"}" \
    "${PAPERCLIP_BASE_URL}/api/plugins/neocompany-tools/bridge/reseed-agents")"

  local created_count
  created_count="$(printf '%s' "${resp}" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print('?')
    sys.exit(0)
created = d.get('created') or []
already = d.get('alreadyPresent') or []
print(f\"created={len(created)} already={len(already)}\")
" || echo "?")"
  echo "  ${created_count}"
}

echo "Reseeding ${#COMPANY_NAMES[@]} company(ies) on ${PAPERCLIP_BASE_URL}…"
for name in "${COMPANY_NAMES[@]}"; do
  reseed_one "${name}"
done

echo "✓ Done. Verify with: pnpm run test:e2e:neocompany"
