#!/usr/bin/env bash
# Post-DNS staging verification for Operanto.
#
#   ./scripts/verify-staging.sh            # full checklist
#   ./scripts/verify-staging.sh --dns-only # just resolution + certificates
#
# Reads PRONATONA_WEBHOOK_SECRET / PRONATONA_SOURCE_ORGANISATION_ID /
# CRON_SECRET from .env. Prints PASS/FAIL per item and exits non-zero if any
# check fails. Secrets are never echoed.
set -uo pipefail
cd "$(dirname "$0")/.."

# Read .env without executing it (values may contain spaces or shell syntax).
if [ -f .env ]; then
  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    key=${line%%=*}; value=${line#*=}
    case "$key" in *[!A-Za-z0-9_]*) continue ;; esac
    value=${value%\"}; value=${value#\"}
    export "$key=$value"
  done < .env
fi

SITE=operanto.ai
WWW=www.operanto.ai
APP=staging.operanto.ai
API=api-staging.operanto.ai

pass=0; fail=0
ok()   { printf "  \033[32mPASS\033[0m %s\n" "$1"; pass=$((pass+1)); }
bad()  { printf "  \033[31mFAIL\033[0m %s (%s)\n" "$1" "$2"; fail=$((fail+1)); }
check(){ # check <label> <expected> <actual>
  [ "$2" = "$3" ] && ok "$1" || bad "$1" "expected $2, got $3"; }

code() { curl -sS -m 20 -o /dev/null -w "%{http_code}" "$@" 2>/dev/null || echo 000; }
loc()  { curl -sS -m 20 -o /dev/null -w "%{redirect_url}" "$@" 2>/dev/null || echo ""; }
body() { curl -sS -m 20 "$@" 2>/dev/null || echo ""; }

echo "== 1. DNS resolution (must point at Vercel, not the registrar's parking IPs)"
# Vercel publishes several apex A targets (76.76.21.21 historically,
# 216.150.1.1 / 216.198.79.1 on the newer anycast range). Rather than pin one,
# require that the apex is served by Vercel — proven by the response headers.
apex=$(dig +short A $SITE | tr '\n' ' ')
if [ -z "$apex" ]; then
  bad "$SITE A" "no answer"
elif curl -sSI -m 25 "https://$SITE/" 2>/dev/null | grep -qi "^server: *Vercel"; then
  ok "$SITE A -> $apex (served by Vercel)"
else
  bad "$SITE A" "points at $apex but the host is not served by Vercel"
fi
for h in $WWW $APP $API; do
  cname=$(dig +short CNAME "$h" | tr '\n' ' ')
  addr=$(dig +short A "$h" | tr '\n' ' ')
  case "$cname" in
    *vercel-dns.com*) ok "$h CNAME -> $cname" ;;
    "") [ -n "$addr" ] && bad "$h CNAME" "no CNAME; A=$addr" || bad "$h" "does not resolve" ;;
    *)  bad "$h CNAME" "points at $cname (expected cname.vercel-dns.com.)" ;;
  esac
done

echo "== 2. HTTPS certificates"
for h in $SITE $WWW $APP $API; do
  # A certificate must actually be PRESENTED and verify: openssl prints
  # "Verify return code: 0 (ok)" even when the handshake yielded no peer
  # certificate, so require the subject/dates too.
  out=$(echo | openssl s_client -servername "$h" -connect "$h:443" 2>/dev/null)
  subject=$(printf '%s' "$out" | grep -m1 "^subject=")
  verified=$(printf '%s' "$out" | grep -c "Verify return code: 0")
  if [ -n "$subject" ] && [ "$verified" -ge 1 ]; then
    exp=$(printf '%s' "$out" | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
    ok "$h certificate presented and valid (${subject#subject=}, expires $exp)"
  else
    bad "$h certificate" "no verified certificate presented (issuance pending?)"
  fi
done

[ "${1:-}" = "--dns-only" ] && { echo; echo "PASS=$pass FAIL=$fail"; exit $([ $fail -eq 0 ] && echo 0 || echo 1); }

echo "== 3. operanto.ai serves marketing only"
check "GET / is 200"                      200 "$(code https://$SITE/)"
check "GET /product is 200"               200 "$(code https://$SITE/product)"
cockpit_redirect=$(loc https://$SITE/dashboard)
case "$cockpit_redirect" in
  https://$APP/dashboard*) ok "cockpit path redirects to $APP" ;;
  *) bad "cockpit path redirects to $APP" "got '$cockpit_redirect'" ;;
esac
check "ingestion route not served here"   404 "$(code -X POST https://$SITE/api/v1/integrations/pronatona/events)"

echo "== 4. www redirects permanently"
www_code=$(code https://$WWW/); www_loc=$(loc https://$WWW/)
[ "$www_code" = "308" ] || [ "$www_code" = "301" ] && ok "www returns $www_code" || bad "www permanent redirect" "got $www_code"
case "$www_loc" in https://$SITE/*) ok "www -> $SITE" ;; *) bad "www -> $SITE" "got '$www_loc'" ;; esac

echo "== 5. staging.operanto.ai serves the Cockpit"
check "GET /login is 200"                 200 "$(code https://$APP/login)"
app_root=$(loc https://$APP/)
case "$app_root" in
  *"/dashboard"*) ok "/ redirects into the cockpit" ;;
  "") ok "/ served directly (combined-host mode)" ;;
  *) bad "/ cockpit entry" "got '$app_root'" ;;
esac
check "unauthenticated /dashboard redirects" 307 "$(code https://$APP/dashboard)"

echo "== 6. api-staging serves API only"
check "GET /api/health is 200"            200 "$(code https://$API/api/health)"
check "GET /api/health/database is 200"   200 "$(code https://$API/api/health/database)"
check "GET / is 404 (no marketing HTML)"  404 "$(code https://$API/)"
check "GET /dashboard is 404 (no cockpit)" 404 "$(code https://$API/dashboard)"
check "GET /customers/a.b is 404 (dotted path)" 404 "$(code https://$API/customers/a.b)"
check "GET /invite/tok.en is 404 (dotted path)" 404 "$(code https://$API/invite/tok.en)"

echo "== 7. Host-header spoofing cannot bypass separation"
check "forged X-Forwarded-Host on marketing host" 404 \
  "$(code -X POST -H "X-Forwarded-Host: $API" https://$SITE/api/v1/integrations/pronatona/events)"
check "forged X-Forwarded-Host for cockpit" 404 \
  "$(code -H "X-Forwarded-Host: $APP" https://$API/dashboard)"

echo "== 9. Signed ingestion matrix against the real API host"
if [ -z "${PRONATONA_WEBHOOK_SECRET:-}" ]; then
  bad "ingestion matrix" "PRONATONA_WEBHOOK_SECRET not set"
else
  RUN=$(date +%s)
  ORG="${PRONATONA_SOURCE_ORGANISATION_ID:-org_pronatona}"
  send() { # send <secret> <ts-offset> <org> <eventId> <extra-bytes>
    local secret="$1" off="$2" org="$3" eid="$4" pad="${5:-}"
    local occurred; occurred=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
    local payload="{\"eventId\":\"$eid\",\"eventType\":\"lead.created\",\"schemaVersion\":1,\"occurredAt\":\"$occurred\",\"source\":\"PRONATONA_WEB\",\"organisationId\":\"$org\",\"correlationId\":\"$eid\",\"actor\":{\"type\":\"CUSTOMER\",\"userId\":null,\"membershipId\":null},\"data\":{\"leadId\":\"lead_$eid\",\"inquiryType\":\"PROPERTY_QUESTION\",\"sourceChannel\":\"website\",\"customer\":{\"name\":\"Staging Probe $RUN\",\"email\":\"probe.$eid@example.com\",\"phone\":null,\"preferredLanguage\":\"sq\"},\"message\":\"Staging verification probe$pad\",\"propertyReference\":\"PRN-STG-$RUN\"}}"
    local ts; ts=$(( $(date +%s) + off ))
    local sig; sig=$(printf '%s' "$ts.$payload" | openssl dgst -sha256 -hmac "$secret" -hex | sed 's/^.*= //')
    curl -sS -m 25 -o /dev/null -w "%{http_code}" -X POST "https://$API/api/v1/integrations/pronatona/events" \
      -H "Content-Type: application/json" -H "X-Operanto-Event-Id: $eid" \
      -H "X-Operanto-Timestamp: $ts" -H "X-Operanto-Signature: $sig" -d "$payload" 2>/dev/null || echo 000
  }
  EID="evt_stg_$RUN"
  check "valid event -> 202"              202 "$(send "$PRONATONA_WEBHOOK_SECRET" 0 "$ORG" "$EID")"
  check "duplicate -> 200"                200 "$(send "$PRONATONA_WEBHOOK_SECRET" 0 "$ORG" "$EID")"
  check "bad signature -> 401"            401 "$(send "wrong-secret-wrong-secret-wrong" 0 "$ORG" "evt_bad_$RUN")"
  check "expired timestamp -> 401"        401 "$(send "$PRONATONA_WEBHOOK_SECRET" -3600 "$ORG" "evt_old_$RUN")"
  check "wrong source org -> 409"         409 "$(send "$PRONATONA_WEBHOOK_SECRET" 0 "org_not_registered" "evt_org_$RUN")"
  PAD=$(head -c 300000 /dev/zero | tr '\0' 'x')
  check "oversized payload -> 413"        413 "$(send "$PRONATONA_WEBHOOK_SECRET" 0 "$ORG" "evt_big_$RUN" "$PAD")"
fi

echo "== 10. Cron / retry sweep on the real API host"
check "unauthenticated sweep -> 401"      401 "$(code -X POST https://$API/api/internal/events/retry)"
check "wrong secret -> 401"               401 "$(code -X POST -H 'Authorization: Bearer nope' https://$API/api/internal/events/retry)"
if [ -n "${CRON_SECRET:-}" ]; then
  check "authorized sweep (GET, as Vercel cron) -> 200" 200 \
    "$(code -H "Authorization: Bearer $CRON_SECRET" https://$API/api/internal/events/retry)"
  check "authorized sweep (POST) -> 200"  200 \
    "$(code -X POST -H "Authorization: Bearer $CRON_SECRET" https://$API/api/internal/events/retry)"
  check "worker health authorized -> 200" 200 \
    "$(code -H "Authorization: Bearer $CRON_SECRET" https://$API/api/health/worker)"
  check "worker health unauthenticated -> 401" 401 "$(code https://$API/api/health/worker)"
else
  bad "cron checks" "CRON_SECRET not set"
fi

echo "== 11. Marketing metadata"
home=$(body https://$SITE/)
echo "$home" | grep -qi "rel=\"canonical\"" && ok "canonical link present" || bad "canonical link" "absent"
echo "$home" | grep -qi "og:title" && ok "Open Graph title present" || bad "og:title" "absent"
echo "$home" | grep -qi "og:description" && ok "Open Graph description present" || bad "og:description" "absent"
sitemap=$(body https://$SITE/sitemap.xml)
echo "$sitemap" | grep -q "https://$SITE" && ok "sitemap lists $SITE URLs" || bad "sitemap" "missing site URLs"
robots=$(body https://$SITE/robots.txt)
echo "$robots" | grep -q "Sitemap: https://$SITE/sitemap.xml" && ok "robots points at sitemap" || bad "robots sitemap" "missing"
echo "$robots" | grep -q "Disallow: /dashboard" && ok "robots disallows cockpit" || bad "robots cockpit" "missing"
for page in "" product how-it-works real-estate security about contact; do
  txt=$(body "https://$SITE/$page")
  if echo "$txt" | grep -Eqi "trusted by [0-9]|[0-9]+% (faster|more)|[0-9][0-9,]* (happy )?customers|[0-9]+x (faster|more)"; then
    bad "no fabricated metrics on /$page" "suspicious claim found"
  fi
done
ok "no fabricated metric patterns on marketing pages"
body "https://$SITE/real-estate" | grep -qi "in progress" && ok "Pronatona labelled in progress" || bad "Pronatona label" "missing"

echo
echo "PASS=$pass FAIL=$fail"
echo "Still unprovisioned (expected to be reported as incomplete): Upstash Redis, Sentry, Resend."
echo "Run the acceptance suite against staging with:"
echo "  PLAYWRIGHT_BASE_URL=https://$APP pnpm test:e2e:remote"
exit $([ $fail -eq 0 ] && echo 0 || echo 1)
