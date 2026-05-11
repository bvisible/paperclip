#!/usr/bin/env bash
# //// Neocompany Modification — paperclip admin auth helper (automation-first)
# Sourceable bash script that:
#   1. Reads admin credentials from ~/.config/paperclip-admin.env
#      (PAPERCLIP_ADMIN_EMAIL + PAPERCLIP_ADMIN_PASSWORD)
#   2. Re-uses a cached session cookie at ~/.cache/paperclip-admin/session.cookie
#      when it is still valid (verified via GET /api/auth/get-session)
#   3. Otherwise, signs in via POST /api/auth/sign-in/email, stores the cookie
#      in the cache (file mode 0600), and exports PAPERCLIP_SESSION_COOKIE.
#
# Usage from another script:
#   source "$(dirname "$0")/lib/paperclip-admin-auth.sh"
#   paperclip_admin_auth     # populates PAPERCLIP_SESSION_COOKIE in env
#   curl -b "$PAPERCLIP_SESSION_COOKIE" "${PAPERCLIP_BASE_URL}/api/companies"
#
# First-time setup:
#   mkdir -p ~/.config
#   cat > ~/.config/paperclip-admin.env <<'EOF'
#   PAPERCLIP_ADMIN_EMAIL=jeremy@neoservice.ai
#   PAPERCLIP_ADMIN_PASSWORD=<your password>
#   EOF
#   chmod 600 ~/.config/paperclip-admin.env
#
# Then any script that sources this helper can run unattended.
# //// End Neocompany Modification

# Resolve paths consistently whether the script is sourced or executed.
_PCA_CRED_FILE="${PAPERCLIP_ADMIN_ENV_FILE:-$HOME/.config/paperclip-admin.env}"
_PCA_CACHE_DIR="${PAPERCLIP_ADMIN_CACHE_DIR:-$HOME/.cache/paperclip-admin}"
_PCA_COOKIE_FILE="${_PCA_CACHE_DIR}/session.cookie"
_PCA_BASE_URL="${PAPERCLIP_BASE_URL:-https://app.neocompany.ch}"

# ---------------------------------------------------------------------------
# Logging helpers (only when running interactively / verbose)
# ---------------------------------------------------------------------------

_pca_log() {
  if [ "${PAPERCLIP_ADMIN_AUTH_QUIET:-}" != "1" ]; then
    printf '  [auth] %s\n' "$*" >&2
  fi
}

_pca_fail() {
  printf '\033[31m[auth] ✗ %s\033[0m\n' "$*" >&2
  return 1
}

# ---------------------------------------------------------------------------
# Load credentials
# ---------------------------------------------------------------------------

_pca_load_credentials() {
  # Allow env-provided creds to win (useful for CI where you mount secrets).
  if [ -n "${PAPERCLIP_ADMIN_EMAIL:-}" ] && [ -n "${PAPERCLIP_ADMIN_PASSWORD:-}" ]; then
    return 0
  fi
  if [ ! -f "${_PCA_CRED_FILE}" ]; then
    _pca_fail "Credentials file not found: ${_PCA_CRED_FILE}"
    _pca_fail "Create it with PAPERCLIP_ADMIN_EMAIL and PAPERCLIP_ADMIN_PASSWORD, chmod 600."
    return 1
  fi
  # shellcheck disable=SC1090
  set -a
  source "${_PCA_CRED_FILE}"
  set +a
  if [ -z "${PAPERCLIP_ADMIN_EMAIL:-}" ] || [ -z "${PAPERCLIP_ADMIN_PASSWORD:-}" ]; then
    _pca_fail "Credentials file missing PAPERCLIP_ADMIN_EMAIL or PAPERCLIP_ADMIN_PASSWORD"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Cookie cache I/O
# ---------------------------------------------------------------------------

_pca_load_cached_cookie() {
  if [ ! -f "${_PCA_COOKIE_FILE}" ]; then
    return 1
  fi
  PAPERCLIP_SESSION_COOKIE="$(cat "${_PCA_COOKIE_FILE}")"
  if [ -z "${PAPERCLIP_SESSION_COOKIE}" ]; then
    return 1
  fi
  export PAPERCLIP_SESSION_COOKIE
}

_pca_save_cookie() {
  mkdir -p "${_PCA_CACHE_DIR}"
  printf '%s' "${PAPERCLIP_SESSION_COOKIE}" > "${_PCA_COOKIE_FILE}"
  chmod 600 "${_PCA_COOKIE_FILE}"
}

# ---------------------------------------------------------------------------
# Cookie validity check
# ---------------------------------------------------------------------------

_pca_cookie_is_valid() {
  if [ -z "${PAPERCLIP_SESSION_COOKIE:-}" ]; then
    return 1
  fi
  local response
  response=$(curl -sS -b "${PAPERCLIP_SESSION_COOKIE}" --max-time 10 \
                "${_PCA_BASE_URL}/api/auth/get-session" 2>/dev/null || echo "")
  # Better Auth returns the session object when valid, or null/empty when not.
  if echo "${response}" | grep -q '"user"'; then
    return 0
  fi
  return 1
}

# ---------------------------------------------------------------------------
# Login flow
# ---------------------------------------------------------------------------

_pca_sign_in() {
  _pca_load_credentials || return 1
  local payload
  payload=$(python3 -c "
import json, os
print(json.dumps({
  'email': os.environ['PAPERCLIP_ADMIN_EMAIL'],
  'password': os.environ['PAPERCLIP_ADMIN_PASSWORD'],
}))" 2>/dev/null) || {
    _pca_fail "python3 is required to build the sign-in payload"
    return 1
  }

  _pca_log "Signing in as ${PAPERCLIP_ADMIN_EMAIL}..."

  local headers
  headers=$(curl -sS -D - -o /dev/null --max-time 15 \
              -X POST \
              -H "Content-Type: application/json" \
              -d "${payload}" \
              "${_PCA_BASE_URL}/api/auth/sign-in/email" 2>/dev/null || echo "")
  # Better Auth sends Set-Cookie with the session token. Extract the first
  # Set-Cookie line and keep the `name=value` pair before the first `;`.
  local cookie_line
  cookie_line=$(printf '%s\n' "${headers}" | grep -i '^set-cookie:' | head -1 || true)
  if [ -z "${cookie_line}" ]; then
    _pca_fail "Sign-in failed: no Set-Cookie header returned. Verify credentials."
    return 1
  fi
  PAPERCLIP_SESSION_COOKIE="$(printf '%s' "${cookie_line}" \
    | sed -E 's/^[Ss]et-[Cc]ookie:[[:space:]]*([^;]*).*/\1/' \
    | tr -d '\r\n')"
  if [ -z "${PAPERCLIP_SESSION_COOKIE}" ]; then
    _pca_fail "Failed to parse session cookie from Set-Cookie header"
    return 1
  fi
  export PAPERCLIP_SESSION_COOKIE
  _pca_save_cookie
  _pca_log "Signed in. Cookie cached at ${_PCA_COOKIE_FILE}."
}

# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

paperclip_admin_auth() {
  # Try the cache first.
  if _pca_load_cached_cookie && _pca_cookie_is_valid; then
    _pca_log "Reusing cached session cookie."
    export PAPERCLIP_SESSION_COOKIE
    return 0
  fi
  # Cache miss or expired — sign in fresh.
  _pca_sign_in
}

# If executed (not sourced), perform the auth and print the cookie so callers
# can capture it: `cookie=$(scripts/lib/paperclip-admin-auth.sh)`.
# Detect sourcing by checking if BASH_SOURCE[0] == $0.
if [ "${BASH_SOURCE[0]:-}" = "$0" ] || [ -z "${BASH_SOURCE[0]:-}" ]; then
  paperclip_admin_auth || exit 1
  printf '%s\n' "${PAPERCLIP_SESSION_COOKIE}"
fi
