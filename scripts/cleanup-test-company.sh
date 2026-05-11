#!/usr/bin/env bash
# //// Neocompany Modification — cleanup a test company between test runs
# Resets a test company to a clean baseline so E2E specs start from a known
# state. Operates server-side via API + DB calls. Auth is automatic via
# scripts/lib/paperclip-admin-auth.sh.
#
# What it cleans:
#   • plugin_entities rows older than --older-than-hours (default 24)
#     for the target company (drafts, generated images, brand templates
#     created by previous test runs).
#   • optionally: OpenClaw agent workspaces (--reset-memory, off by default
#     because it requires shell access to the host).
#
# What it does NOT touch:
#   • The company row itself (keep it across runs)
#   • The 9 seeded agents (kept; they have no per-run state in the DB)
#   • Plugin install state (kept)
#
# Usage:
#   bash scripts/cleanup-test-company.sh __TEST_E2E__
#   bash scripts/cleanup-test-company.sh __TEST_E2E__ --older-than-hours 0
#   bash scripts/cleanup-test-company.sh __TEST_E2E__ --reset-memory
# //// End Neocompany Modification

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/paperclip-admin-auth.sh
source "${SCRIPT_DIR}/lib/paperclip-admin-auth.sh"

BASE_URL="${PAPERCLIP_BASE_URL:-https://app.neocompany.ch}"
NAME=""
OLDER_THAN_HOURS=24
RESET_MEMORY=0

# ---------------------------------------------------------------------------
# Arg parsing
# ---------------------------------------------------------------------------

while [ $# -gt 0 ]; do
  case "$1" in
    --older-than-hours)
      OLDER_THAN_HOURS="$2"
      shift 2
      ;;
    --reset-memory)
      RESET_MEMORY=1
      shift
      ;;
    -h|--help)
      sed -n '2,25p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      if [ -z "${NAME}" ]; then
        NAME="$1"
        shift
      else
        echo "Unexpected argument: $1" >&2
        exit 64
      fi
      ;;
  esac
done

if [ -z "${NAME}" ]; then
  echo "Usage: $0 <COMPANY_NAME> [--older-than-hours N] [--reset-memory]" >&2
  exit 64
fi

ok()    { printf '\033[32m✓ %s\033[0m\n' "$*"; }
warn()  { printf '\033[33m! %s\033[0m\n' "$*"; }
fail()  { printf '\033[31m✗ %s\033[0m\n' "$*"; exit 1; }
info()  { printf '  %s\n' "$*"; }

paperclip_admin_auth || exit 1

curl_admin() {
  curl -sS -b "${PAPERCLIP_SESSION_COOKIE}" \
       -H "Content-Type: application/json" \
       -H "Origin: ${BASE_URL}" \
       -H "Referer: ${BASE_URL}/" \
       --max-time 30 \
       "$@"
}

# ---------------------------------------------------------------------------
# 1. Resolve company id by name (must be a test company)
# ---------------------------------------------------------------------------

companies=$(curl_admin "${BASE_URL}/api/companies?includeTest=true")
company_data=$(echo "${companies}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for c in data:
    if c.get('name') == '${NAME}':
        if not c.get('isTest'):
            print('NOT_TEST', file=sys.stderr)
            sys.exit(2)
        print(c['id'])
        print(c.get('issuePrefix', ''))
        break
" 2>&1) || true

if [ -z "${company_data}" ]; then
  fail "Company '${NAME}' not found. Run scripts/provision-test-company.sh ${NAME} first."
fi
if echo "${company_data}" | grep -q "NOT_TEST"; then
  fail "Refusing to cleanup '${NAME}' — it is NOT tagged as is_test=true. Aborting (safety)."
fi

COMPANY_ID=$(echo "${company_data}" | head -1)
COMPANY_PREFIX=$(echo "${company_data}" | sed -n '2p')

ok "Target: ${NAME} (id=${COMPANY_ID}, prefix=${COMPANY_PREFIX})"

# ---------------------------------------------------------------------------
# 2. Cleanup plugin_entities older than threshold (server-side via DB)
# ---------------------------------------------------------------------------
# We do this via a tiny custom endpoint that we'd add server-side OR via
# SSH + psql. Path of least resistance for now: SSH + psql against prod.
# Wrap it so this script remains the single entry point.

if [ -n "${PAPERCLIP_SSH_HOST:-}" ]; then
  SSH_HOST="${PAPERCLIP_SSH_HOST}"
  SSH_KEY="${PAPERCLIP_SSH_KEY:-$HOME/.ssh/id_neoservice}"
  info "Cleaning plugin_entities older than ${OLDER_THAN_HOURS}h via SSH..."
  ssh -o ConnectTimeout=10 -i "${SSH_KEY}" "${SSH_HOST}" \
    "sudo -u postgres psql -d paperclip -c \"DELETE FROM plugin_entities WHERE scope_id = '${COMPANY_ID}' AND created_at < NOW() - INTERVAL '${OLDER_THAN_HOURS} hours' RETURNING entity_type;\"" \
    2>&1 | tail -5 || warn "SSH cleanup failed (continuing)"
  ok "plugin_entities cleanup done"
else
  warn "PAPERCLIP_SSH_HOST not set — skipping plugin_entities cleanup."
  info "  Set PAPERCLIP_SSH_HOST=ubuntu@83.228.224.34 to enable DB cleanup."
fi

# ---------------------------------------------------------------------------
# 3. Optional: reset OpenClaw agent memory (per-agent workspaces)
# ---------------------------------------------------------------------------

if [ "${RESET_MEMORY}" = "1" ]; then
  if [ -z "${PAPERCLIP_SSH_HOST:-}" ]; then
    fail "--reset-memory requires PAPERCLIP_SSH_HOST=ubuntu@<host>"
  fi
  info "Resetting OpenClaw agent workspaces for ${COMPANY_ID}..."
  ssh -o ConnectTimeout=10 -i "${SSH_KEY}" "${SSH_HOST}" \
    "for role in main designer writer social seo community brand commercial support; do
       ws=\"\$HOME/.openclaw/workspaces/${COMPANY_ID}-\${role}\"
       if [ -d \"\$ws\" ]; then
         find \"\$ws\" -name 'MEMORY.md' -o -name 'JOURNAL.md' | xargs -r rm
       fi
     done" 2>&1 | tail -3 || warn "Memory reset failed (continuing)"
  ok "OpenClaw memory reset"
fi

printf '\n\033[32m✓ Cleanup complete for %s\033[0m\n' "${NAME}"
info "Company: ${BASE_URL}/${COMPANY_PREFIX}/dashboard"
