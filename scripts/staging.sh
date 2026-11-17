#!/usr/bin/env bash
# Safe wrapper for the ISOLATED staging stack. Every command is pinned to the staging project, file and env file, so a
# forgotten flag can never run the production docker-compose.yml that sits in the same checkout.
#
#   scripts/staging.sh preflight   render the config and run the isolation checks (starts nothing)
#   scripts/staging.sh build       preflight, then build the two staging images (one at a time, low memory)
#   scripts/staging.sh up          preflight, then start the staging stack
#   scripts/staging.sh status      ps + published ports + integration switch log lines
#   scripts/staging.sh logs [svc]  follow logs (tail 100)
#   scripts/staging.sh stop        stop containers, KEEP the staging database volume
#   scripts/staging.sh destroy     remove staging containers, network, images AND the staging database volume (asks first)
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="qonnect-fieldops-staging"
FILE="docker-compose.staging.yml"
ENVFILE=".env.staging"
DC=(docker compose -p "$PROJECT" -f "$FILE" --env-file "$ENVFILE")

die() { echo "staging.sh: $*" >&2; exit 1; }
[ -f "$FILE" ] || die "$FILE not found (run from the repository root)"
[ -f "$ENVFILE" ] || die "$ENVFILE not found — copy .env.staging.example to .env.staging and fill in the staging secrets"
[ "$(stat -c %a "$ENVFILE" 2>/dev/null || echo 600)" -le 640 ] || die "$ENVFILE must not be world-readable (chmod 600 $ENVFILE)"

preflight() {
  # No `|| true` anywhere: any failure (compose cannot render, a rule is broken) stops the script.
  local json
  json="$("${DC[@]}" config --format json)" || die "docker compose could not render $FILE with $ENVFILE"
  printf '%s' "$json" | node scripts/validate_staging_compose.mjs || die "preflight FAILED — nothing was started"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  preflight) preflight ;;
  build)     preflight; "${DC[@]}" build backend; "${DC[@]}" build frontend ;;
  up)        preflight; "${DC[@]}" up -d ;;
  status)    "${DC[@]}" ps; echo; "${DC[@]}" port frontend 80 || true; echo; "${DC[@]}" logs --no-color backend 2>/dev/null | grep -E '"type":"(integration_switches|staging_isolation_ok|integration_blocked)"' | tail -5 || true ;;
  logs)      "${DC[@]}" logs -f --tail 100 "$@" ;;
  stop)      "${DC[@]}" stop ;;
  destroy)
    echo "This removes the staging containers, network, images and the staging DATABASE VOLUME (${PROJECT}_pgdata). Production is not touched."
    read -r -p "Type the project name ($PROJECT) to continue: " ans
    [ "$ans" = "$PROJECT" ] || die "not confirmed — nothing removed"
    "${DC[@]}" down -v
    # only the two images this project built; never postgres:16-alpine (production uses it too)
    docker image rm qonnect-fieldops-staging/backend:local qonnect-fieldops-staging/frontend:local 2>/dev/null || true
    ;;
  *) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
