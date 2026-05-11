#!/usr/bin/env bash
# //// Neocompany Modification — provision a hidden test company on prod
# Creates a company with is_test=true on app.neocompany.ch (or any target) so
# E2E / smoke / manual dev workflows can target a stable surface without
# polluting client-visible UIs.
#
# Auth: fully automated via scripts/lib/paperclip-admin-auth.sh. Credentials
# live in ~/.config/paperclip-admin.env. No manual cookie extraction.
#
# Usage:
#   bash scripts/provision-test-company.sh <NAME>
#   bash scripts/provision-test-company.sh __TEST_E2E__
#   bash scripts/provision-test-company.sh __TEST_SMOKE__
#   bash scripts/provision-test-company.sh __TEST_MANUAL__
#
# Idempotent: if a company with the given name already exists, exits 0 with
# a friendly message rather than failing or duplicating.
# //// End Neocompany Modification

set -euo pipefail

# Source the auth helper (resolves and exports PAPERCLIP_SESSION_COOKIE).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/paperclip-admin-auth.sh
source "${SCRIPT_DIR}/lib/paperclip-admin-auth.sh"

BASE_URL="${PAPERCLIP_BASE_URL:-https://app.neocompany.ch}"
NAME="${1:-}"

if [ -z "${NAME}" ]; then
  echo "Usage: $0 <COMPANY_NAME>" >&2
  echo "Suggested names: __TEST_E2E__, __TEST_SMOKE__, __TEST_MANUAL__" >&2
  exit 64
fi

paperclip_admin_auth || exit 1

curl_admin() {
  curl -sS -b "${PAPERCLIP_SESSION_COOKIE}" \
       -H "Content-Type: application/json" \
       --max-time 30 \
       "$@"
}

ok()    { printf '\033[32m✓ %s\033[0m\n' "$*"; }
warn()  { printf '\033[33m! %s\033[0m\n' "$*"; }
fail()  { printf '\033[31m✗ %s\033[0m\n' "$*"; exit 1; }
info()  { printf '  %s\n' "$*"; }

# ---------------------------------------------------------------------------
# 1. Verify auth (sanity check: the helper already validated the cookie, but
#    we double-check the user is an instance admin since only admins can
#    create test companies).
# ---------------------------------------------------------------------------

session_response=$(curl_admin "${BASE_URL}/api/auth/get-session" || echo "{}")
if ! echo "${session_response}" | grep -q '"user"'; then
  fail "Authentication failed. Re-check ~/.config/paperclip-admin.env."
fi
ok "Authenticated as ${PAPERCLIP_ADMIN_EMAIL:-(cached)}"

# ---------------------------------------------------------------------------
# 2. Idempotency check: does a company with this name already exist?
# ---------------------------------------------------------------------------

existing=$(curl_admin "${BASE_URL}/api/companies?includeTest=true" || echo "[]")
existing_id=$(echo "${existing}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for c in data:
    if c.get('name') == '${NAME}':
        print(c['id'])
        break
" 2>/dev/null || true)

if [ -n "${existing_id}" ]; then
  info "Company '${NAME}' already exists (id=${existing_id}) — nothing to do."
  exit 0
fi

# ---------------------------------------------------------------------------
# 3. Create the test company
# ---------------------------------------------------------------------------

payload=$(cat <<EOF
{
  "name": "${NAME}",
  "description": "Hidden test company provisioned by scripts/provision-test-company.sh — do not delete unless you know what you're doing.",
  "isTest": true
}
EOF
)

response=$(curl_admin -X POST -d "${payload}" "${BASE_URL}/api/companies")
new_id=$(echo "${response}" | python3 -c "import json, sys; print(json.load(sys.stdin).get('id', ''))" 2>/dev/null || true)

if [ -z "${new_id}" ]; then
  fail "Create failed. Response: ${response}"
fi
ok "Created company '${NAME}' (id=${new_id}, isTest=true)"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

prefix=$(echo "${response}" | python3 -c "import json, sys; print(json.load(sys.stdin).get('issuePrefix', ''))" 2>/dev/null || true)
printf '\n\033[32m✓ Test company ready\033[0m\n'
info "Name:    ${NAME}"
info "ID:      ${new_id}"
info "Prefix:  ${prefix}"
info "URL:     ${BASE_URL}/${prefix}/dashboard  (visible only to instance admins)"
info ""
info "Next steps:"
info "  • Verify in /admin/companies — the company should have a 🧪 Test badge."
info "  • Seed-agents will auto-provision 9 agents (Atlas/Ella/Iris/Lyra/Maya/Nora/Nova/Pixel/Scout)."
info "  • Install plugins via /admin/companies → drawer → Plugins tab."
info "  • For E2E tests, point Playwright at: ${BASE_URL}/${prefix}/*"
