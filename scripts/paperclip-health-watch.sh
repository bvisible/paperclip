#!/usr/bin/env bash
# paperclip-health-watch.sh — emit metrics + alerts for the Paperclip stack on
# small-RAM instances (Osiris, ~4 GB). Run from cron every 5 min:
#
#   */5 * * * * root /usr/local/bin/paperclip-health-watch.sh >> /var/log/paperclip-health.log 2>&1
#
# Required env (read from /etc/paperclip-health-watch.env if present):
#   PAPERCLIP_PG_DB         - paperclip database name (default: paperclip)
#   PAPERCLIP_PG_USER       - psql user, must be local trust or .pgpass-able (default: postgres)
#   PAPERCLIP_PROCESS_PATTERN - pgrep pattern to find the server process (default: 'paperclip|node.*server')
#   PAPERCLIP_ALERT_EMAIL   - destination for mail alerts (default: jeremy@bvisible.ch)
#   PAPERCLIP_ALERT_HYSTERESIS_S - re-alert minimum interval (default: 3600)
#
# This is a defensive script: it never fails noisily. Anything that goes wrong
# during measurement is logged and the metric is emitted as 'unknown'.

set -euo pipefail

CONFIG_FILE="/etc/paperclip-health-watch.env"
if [[ -f "${CONFIG_FILE}" ]]; then
  # shellcheck disable=SC1090
  . "${CONFIG_FILE}"
fi

PG_DB="${PAPERCLIP_PG_DB:-paperclip}"
PG_USER="${PAPERCLIP_PG_USER:-postgres}"
# Match the Paperclip server entrypoint specifically. The previous broader
# pattern caught Frappe socketio + plugin workers and produced false-positive
# Node RSS readings (~2 GB instead of ~270 MB). Override via env if the install
# layout differs.
PROCESS_PATTERN="${PAPERCLIP_PROCESS_PATTERN:-paperclip/server/src/index.ts}"
ALERT_EMAIL="${PAPERCLIP_ALERT_EMAIL:-jeremy@bvisible.ch}"
HYSTERESIS_S="${PAPERCLIP_ALERT_HYSTERESIS_S:-3600}"
HOSTNAME_SHORT="$(hostname -s)"

METRICS_CSV="/var/log/paperclip-health.metrics.csv"
LAST_ALERT_FILE="/var/run/paperclip-health-watch.last-alert"

# ---- thresholds (warn, critical) ------------------------------------------
ACTIVITY_LOG_WARN_MB=200
ACTIVITY_LOG_CRIT_MB=500
ISSUE_COMMENTS_WARN_MB=100
ISSUE_COMMENTS_CRIT_MB=300
PG_CONN_WARN=8
PG_CONN_CRIT=12
NODE_RSS_WARN_MB=600
NODE_RSS_CRIT_MB=1024
SWAP_WARN_PCT=50
SWAP_CRIT_PCT=80

now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ---- helpers --------------------------------------------------------------
log() { echo "[paperclip-health-watch] $*"; }

psql_one() {
  # $1 = SQL returning a single integer; on error returns "" (interpreted as unknown)
  local sql="$1"
  sudo -u "${PG_USER}" psql -d "${PG_DB}" -tAc "${sql}" 2>/dev/null || echo ""
}

table_size_mb() {
  local table="$1"
  local raw
  raw="$(psql_one "SELECT pg_total_relation_size('public.${table}')")"
  if [[ -z "${raw}" ]]; then echo "unknown"; return; fi
  awk -v b="${raw}" 'BEGIN { printf "%d", b / 1024 / 1024 }'
}

postgres_paperclip_conn_count() {
  psql_one "SELECT count(*) FROM pg_stat_activity WHERE datname = '${PG_DB}' AND application_name LIKE '%postgres.js%'"
}

node_rss_mb() {
  local pids rss_total
  pids="$(pgrep -f -d, "${PROCESS_PATTERN}" || true)"
  if [[ -z "${pids}" ]]; then echo "unknown"; return; fi
  rss_total=0
  for pid in ${pids//,/ }; do
    local rss_kb
    rss_kb="$(awk '/VmRSS:/ { print $2 }' "/proc/${pid}/status" 2>/dev/null || echo 0)"
    rss_total=$((rss_total + rss_kb))
  done
  echo $((rss_total / 1024))
}

swap_pct() {
  awk '/SwapTotal:/ { total=$2 } /SwapFree:/ { free=$2 }
       END {
         if (total == 0) { print "0"; exit }
         printf "%d", (total - free) * 100 / total
       }' /proc/meminfo
}

# ---- collect --------------------------------------------------------------
activity_log_mb="$(table_size_mb activity_log)"
issue_comments_mb="$(table_size_mb issue_comments)"
heartbeat_runs_mb="$(table_size_mb heartbeat_runs)"
plugin_logs_mb="$(table_size_mb plugin_logs)"
pg_conn_count="$(postgres_paperclip_conn_count)"
node_rss="$(node_rss_mb)"
swap_used_pct="$(swap_pct)"

# ---- write CSV row --------------------------------------------------------
if [[ ! -f "${METRICS_CSV}" ]]; then
  echo "timestamp,host,activity_log_mb,issue_comments_mb,heartbeat_runs_mb,plugin_logs_mb,pg_conn_count,node_rss_mb,swap_used_pct" >> "${METRICS_CSV}"
fi
echo "${now_iso},${HOSTNAME_SHORT},${activity_log_mb},${issue_comments_mb},${heartbeat_runs_mb},${plugin_logs_mb},${pg_conn_count},${node_rss},${swap_used_pct}" >> "${METRICS_CSV}"

# ---- evaluate -------------------------------------------------------------
alerts=()
status="ok"

threshold_check() {
  # name, value, warn, crit, unit
  local name="$1" value="$2" warn="$3" crit="$4" unit="$5"
  if [[ "${value}" == "unknown" ]]; then return; fi
  if (( value >= crit )); then
    alerts+=("CRITICAL: ${name} = ${value} ${unit} (threshold ${crit})")
    status="critical"
  elif (( value >= warn )); then
    alerts+=("WARN: ${name} = ${value} ${unit} (threshold ${warn})")
    [[ "${status}" == "ok" ]] && status="warn"
  fi
}

threshold_check "activity_log size"   "${activity_log_mb}"   "${ACTIVITY_LOG_WARN_MB}"   "${ACTIVITY_LOG_CRIT_MB}"   "MB"
threshold_check "issue_comments size" "${issue_comments_mb}" "${ISSUE_COMMENTS_WARN_MB}" "${ISSUE_COMMENTS_CRIT_MB}" "MB"
threshold_check "Postgres conn"       "${pg_conn_count}"     "${PG_CONN_WARN}"           "${PG_CONN_CRIT}"           "conn"
threshold_check "Node RSS"            "${node_rss}"          "${NODE_RSS_WARN_MB}"       "${NODE_RSS_CRIT_MB}"       "MB"
threshold_check "Swap usage"          "${swap_used_pct}"     "${SWAP_WARN_PCT}"          "${SWAP_CRIT_PCT}"          "%"

log "status=${status} activity_log_mb=${activity_log_mb} issue_comments_mb=${issue_comments_mb} pg_conn=${pg_conn_count} node_rss_mb=${node_rss} swap_pct=${swap_used_pct}"

# ---- alerting (with hysteresis) ------------------------------------------
if (( ${#alerts[@]} > 0 )); then
  should_alert=1
  if [[ -f "${LAST_ALERT_FILE}" ]]; then
    last_ts="$(stat -c %Y "${LAST_ALERT_FILE}" 2>/dev/null || echo 0)"
    now_ts="$(date +%s)"
    if (( now_ts - last_ts < HYSTERESIS_S )); then
      should_alert=0
      log "alert suppressed (hysteresis: $((HYSTERESIS_S - (now_ts - last_ts))) s remaining)"
    fi
  fi

  if (( should_alert == 1 )); then
    subject="[paperclip-health-watch] ${HOSTNAME_SHORT} ${status^^}"
    body=$(printf "Host: %s\nTime: %s\nStatus: %s\n\nThresholds breached:\n%s\n\nMetrics:\n  activity_log:   %s MB\n  issue_comments: %s MB\n  heartbeat_runs: %s MB\n  plugin_logs:    %s MB\n  pg conn:        %s\n  node RSS:       %s MB\n  swap used:      %s%%\n" \
      "${HOSTNAME_SHORT}" "${now_iso}" "${status}" \
      "$(printf '  %s\n' "${alerts[@]}")" \
      "${activity_log_mb}" "${issue_comments_mb}" "${heartbeat_runs_mb}" "${plugin_logs_mb}" \
      "${pg_conn_count}" "${node_rss}" "${swap_used_pct}")

    if command -v mail >/dev/null 2>&1; then
      printf "%s" "${body}" | mail -s "${subject}" "${ALERT_EMAIL}" || log "mail send failed"
    else
      log "mail command not available; alert body follows"
      printf "%s\n" "${body}"
    fi
    touch "${LAST_ALERT_FILE}"
  fi
fi

exit 0
