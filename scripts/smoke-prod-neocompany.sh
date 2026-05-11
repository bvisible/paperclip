#!/usr/bin/env bash
# //// Neocompany Modification — post-deploy smoke test for app.neocompany.ch
# Run after every `git checkout neocompany && pnpm -r build && systemctl --user restart paperclip`.
# Exits 0 if the deployment is healthy, non-zero with a clear reason otherwise.
# Safe to run from cron, CI, or interactively.
# //// End Neocompany Modification

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BASE_URL="${PAPERCLIP_BASE_URL:-https://app.neocompany.ch}"
WAIT_SECONDS="${PAPERCLIP_SMOKE_WAIT_SECONDS:-20}"   # how long to wait for service to come up
EXPECTED_PLUGINS="${PAPERCLIP_EXPECTED_PLUGINS:-paperclip-chat neocompany-tools}"
EXPECTED_TOOL_COUNT="${PAPERCLIP_EXPECTED_TOOL_COUNT:-30}"
JOURNAL_LINES="${PAPERCLIP_JOURNAL_LINES:-200}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ok()    { printf '\033[32m✓ %s\033[0m\n' "$*"; }
warn()  { printf '\033[33m! %s\033[0m\n' "$*"; }
fail()  { printf '\033[31m✗ %s\033[0m\n' "$*"; exit 1; }
info()  { printf '  %s\n' "$*"; }

# ---------------------------------------------------------------------------
# 1. Wait for service to settle
# ---------------------------------------------------------------------------

info "Waiting ${WAIT_SECONDS}s for paperclip to settle..."
sleep "${WAIT_SECONDS}"

# ---------------------------------------------------------------------------
# 2. HTTP reachability
# ---------------------------------------------------------------------------

http_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "${BASE_URL}/" || true)
if [ "${http_code}" != "200" ]; then
  fail "HTTP ${http_code} on ${BASE_URL}/ (expected 200)"
fi
ok "HTTP 200 on ${BASE_URL}/"

# ---------------------------------------------------------------------------
# 3. Service health
# ---------------------------------------------------------------------------

if ! systemctl --user is-active --quiet paperclip; then
  fail "systemd service 'paperclip' is not active"
fi
ok "systemd service 'paperclip' is active"

# ---------------------------------------------------------------------------
# 4. Plugin activation in journal since service start
# ---------------------------------------------------------------------------

# Read all logs since the current service started — covers fresh restarts AND
# long-running services. Falls back to last N lines if we can't get the start time.
service_start=$(systemctl --user show paperclip --property=ActiveEnterTimestamp --value 2>/dev/null || true)
if [ -n "${service_start}" ] && [ "${service_start}" != "n/a" ]; then
  journal=$(journalctl --user -u paperclip --no-pager --since "${service_start}" 2>/dev/null || true)
  info "Reading journal since service start: ${service_start}"
else
  journal=$(journalctl --user -u paperclip --no-pager -n "${JOURNAL_LINES}" 2>/dev/null || true)
  info "Reading journal last ${JOURNAL_LINES} lines (fallback)"
fi

missing_plugins=()
for plugin in ${EXPECTED_PLUGINS}; do
  # Two-stage grep — narrower & less fragile than a single regex with escapes.
  if ! printf '%s\n' "${journal}" | grep "plugin activated successfully" | grep -q "${plugin}"; then
    missing_plugins+=("${plugin}")
  fi
done

if [ ${#missing_plugins[@]} -gt 0 ]; then
  fail "Plugins not activated in last ${JOURNAL_LINES} log lines: ${missing_plugins[*]}"
fi
ok "All expected plugins activated: ${EXPECTED_PLUGINS}"

# ---------------------------------------------------------------------------
# 5. Tool count
# ---------------------------------------------------------------------------

tool_count_line=$(printf '%s\n' "${journal}" | grep -o 'registered [0-9]* tool(s)' | tail -1 || true)
if [ -z "${tool_count_line}" ]; then
  warn "Could not find a 'registered N tool(s)' line in the journal — skipping tool count check"
else
  tool_count=$(printf '%s' "${tool_count_line}" | awk '{print $2}')
  if [ "${tool_count}" -lt "${EXPECTED_TOOL_COUNT}" ]; then
    fail "Tool count ${tool_count} < expected ${EXPECTED_TOOL_COUNT}"
  fi
  ok "Tool count: ${tool_count} (>= ${EXPECTED_TOOL_COUNT})"
fi

# ---------------------------------------------------------------------------
# 6. No fatal errors in journal
# ---------------------------------------------------------------------------

fatal_lines=$(printf '%s\n' "${journal}" | grep -E "ERROR|FATAL|UnhandledPromise|uncaughtException" | grep -vE "fatal: |error_count" || true)
if [ -n "${fatal_lines}" ]; then
  warn "Found error-like lines in journal:"
  printf '%s\n' "${fatal_lines}" | head -5 | sed 's/^/    /'
  # Don't fail — just warn. Some plugin RPC errors are recoverable.
fi

# ---------------------------------------------------------------------------
# 7. /api/health endpoint (optional, may not exist on all builds)
# ---------------------------------------------------------------------------

health_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "${BASE_URL}/api/health" || true)
case "${health_code}" in
  200) ok "/api/health returned 200" ;;
  404) info "/api/health not exposed (skipping)" ;;
  *)   warn "/api/health returned ${health_code}" ;;
esac

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

printf '\n\033[32m✓ All smoke checks passed for %s\033[0m\n' "${BASE_URL}"
exit 0
