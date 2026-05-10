#!/usr/bin/env bash
# //// Neocompany Modification — pure addition (Neocompany fork on top of paperclipai/paperclip)
# //// This file does not exist upstream. Safe across upstream merges.
# Provision OpenClaw isolated agents for a NeoCompany company.
#
# Creates one isolated agent per role (main, designer, writer, social, …) with
# a dedicated workspace and agent-dir. Each agent gets its own memory,
# sessions, and paperclip-claimed-api-key.json — so conversations and learned
# context do NOT leak between companies.
#
# Usage (on the server, where the `openclaw` CLI is installed):
#   ./openclaw-provision-company.sh <COMPANY_ID>
#
# Optional env vars:
#   OPENCLAW_BIN            path to openclaw (default: /usr/local/bin/openclaw)
#   WORKSPACE_ROOT          where to place workspaces
#                           (default: /home/ubuntu/.openclaw/workspaces)
#   AGENT_DIR_ROOT          where to place agent-dirs
#                           (default: /home/ubuntu/.openclaw/agents)
#   ROLES                   space-separated list of roles to provision
#                           (default: the 9 NeoCompany seed roles)
#
# Exit codes: 0 on full success; 1 on any error (best-effort continue per agent).

set -euo pipefail

COMPANY_ID="${1:-}"
if [[ -z "$COMPANY_ID" ]]; then
  echo "Usage: $0 <COMPANY_ID>" >&2
  exit 2
fi

OPENCLAW_BIN="${OPENCLAW_BIN:-/usr/local/bin/openclaw}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-/home/ubuntu/.openclaw/workspaces}"
AGENT_DIR_ROOT="${AGENT_DIR_ROOT:-/home/ubuntu/.openclaw/agents}"
ROLES_DEFAULT="main designer writer social seo community brand commercial support"
ROLES="${ROLES:-$ROLES_DEFAULT}"

if ! command -v "$OPENCLAW_BIN" >/dev/null 2>&1 && [[ ! -x "$OPENCLAW_BIN" ]]; then
  echo "openclaw CLI not found at $OPENCLAW_BIN" >&2
  exit 1
fi

mkdir -p "$WORKSPACE_ROOT" "$AGENT_DIR_ROOT"

failed=0
created=0
skipped=0

for role in $ROLES; do
  agent_id="${COMPANY_ID}-${role}"
  workspace="$WORKSPACE_ROOT/$agent_id"
  agent_dir="$AGENT_DIR_ROOT/$agent_id/agent"

  if "$OPENCLAW_BIN" agents list 2>/dev/null | grep -q "^- ${agent_id}\b"; then
    echo "SKIP    $agent_id (already exists)"
    skipped=$((skipped + 1))
    continue
  fi

  if "$OPENCLAW_BIN" agents add "$agent_id" \
      --workspace "$workspace" \
      --agent-dir "$agent_dir" \
      --non-interactive >/dev/null 2>&1; then
    echo "CREATE  $agent_id"
    echo "          workspace=$workspace"
    echo "          agent-dir=$agent_dir"
    created=$((created + 1))
  else
    echo "FAIL    $agent_id (openclaw agents add errored)" >&2
    failed=$((failed + 1))
  fi
done

echo ""
echo "Summary for company $COMPANY_ID:"
echo "  created=$created  skipped=$skipped  failed=$failed"
echo ""
echo "Next steps (to wire these into Paperclip):"
echo "  1. For each agent in company $COMPANY_ID, update adapter_config:"
echo "       UPDATE agents SET adapter_config = adapter_config || jsonb_build_object("
echo "         'agentId', '${COMPANY_ID}-' || role,"
echo "         'claimedApiKeyPath',"
echo "         '$WORKSPACE_ROOT/${COMPANY_ID}-' || role || '/paperclip-claimed-api-key.json'"
echo "       ) WHERE company_id = '${COMPANY_ID}';"
echo ""
echo "  2. Claim a Paperclip API key for each agent into its isolated workspace:"
echo "       cd /home/ubuntu/paperclip && \\"
echo "         pnpm paperclipai agent local-cli <agentId> -C $COMPANY_ID \\"
echo "           --openclaw-workspace $WORKSPACE_ROOT/${COMPANY_ID}-<role>"
echo ""
echo "  3. Restart the gateway so it picks up the new agents:"
echo "       systemctl --user restart openclaw-gateway"

if [[ $failed -gt 0 ]]; then
  exit 1
fi
exit 0
