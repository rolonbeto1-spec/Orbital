#!/usr/bin/env bash
#
# Verify security headers and the CSP nonce against REAL responses from a
# production build (§12 of the follow-up brief; §25, §26, §27, §53).
#
# WHY THIS IS NOT A UNIT TEST
#
# Asserting on the header strings that src/proxy.ts builds proves only that
# the strings are well formed. It cannot see what the framework actually
# serves. The bug this script was written to catch was invisible to config
# tests and fatal in production:
#
#   The CSP advertises `'strict-dynamic'` with a per-request nonce. Under CSP
#   Level 3, `'strict-dynamic'` makes `'self'` and every host-source in
#   script-src be IGNORED, so a nonce is the only thing that can allow a
#   script. The pages were statically prerendered, so no script tag carried a
#   nonce — and a prerendered page could not carry one, since it is baked once
#   and the nonce changes per request. Every script on every page would have
#   been blocked, in production only, where the policy is strictest.
#
# So this script builds, starts the real server, and reads real bytes.
#
# Usage: scripts/check-headers.sh [--no-build]     (needs a reachable DATABASE_URL)

set -uo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3199}"
BASE="http://127.0.0.1:$PORT"
failures=0

pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1"; failures=$((failures + 1)); }

check() { # check <description> <haystack-file> <grep-pattern>
  if grep -qiE "$3" "$2"; then pass "$1"; else fail "$1"; fi
}

if [ "${1:-}" != "--no-build" ]; then
  echo "Building…"
  npm run build:next >/tmp/header-check-build.log 2>&1 || {
    echo "Build failed; see /tmp/header-check-build.log"; exit 1; }
fi

echo "Starting the production server on port $PORT…"
npx next start -p "$PORT" >/tmp/header-check-server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

for _ in $(seq 1 60); do
  curl -sf -o /dev/null "$BASE/login" && break
  sleep 1
done
curl -sf -o /dev/null "$BASE/login" || { echo "Server never became ready"; cat /tmp/header-check-server.log; exit 1; }

echo
echo "== Public HTML page (/login) =="
curl -s -D /tmp/hc-head -o /tmp/hc-body "$BASE/login"

check "Content-Security-Policy present"            /tmp/hc-head "^content-security-policy:"
check "frame-ancestors 'none'"                     /tmp/hc-head "frame-ancestors 'none'"
check "object-src 'none'"                          /tmp/hc-head "object-src 'none'"
check "base-uri 'self'"                            /tmp/hc-head "base-uri 'self'"
check "form-action 'self'"                         /tmp/hc-head "form-action 'self'"
grep -i "^content-security-policy:" /tmp/hc-head | grep -q "unsafe-eval" \
  && fail "script-src must not allow 'unsafe-eval'" \
  || pass "script-src has no 'unsafe-eval'"
grep -i "^content-security-policy:" /tmp/hc-head | grep -q "script-src[^;]*unsafe-inline" \
  && fail "script-src must not allow 'unsafe-inline'" \
  || pass "script-src has no 'unsafe-inline'"
check "Strict-Transport-Security"                  /tmp/hc-head "^strict-transport-security: max-age=[0-9]{7,}"
check "X-Content-Type-Options: nosniff"            /tmp/hc-head "^x-content-type-options: nosniff"
check "X-Frame-Options: DENY"                      /tmp/hc-head "^x-frame-options: DENY"
check "Referrer-Policy"                            /tmp/hc-head "^referrer-policy: strict-origin"
check "Permissions-Policy"                         /tmp/hc-head "^permissions-policy:"
check "Cross-Origin-Opener-Policy"                 /tmp/hc-head "^cross-origin-opener-policy: same-origin"
grep -qi "^x-powered-by:" /tmp/hc-head && fail "X-Powered-By must not be sent" || pass "no X-Powered-By"

echo
echo "== The nonce is real =="
HDR_NONCE=$(grep -io "nonce-[A-Za-z0-9+/=]*" /tmp/hc-head | head -1 | cut -d- -f2-)
HTML_NONCE=$(grep -o 'nonce="[^"]*"' /tmp/hc-body | head -1 | cut -d'"' -f2)
SCRIPTS=$(grep -o '<script' /tmp/hc-body | wc -l | tr -d ' ')
NONCED=$(grep -o '<script[^>]*nonce=' /tmp/hc-body | wc -l | tr -d ' ')

[ -n "$HDR_NONCE" ] && pass "CSP header carries a nonce" || fail "CSP header carries a nonce"
[ -n "$HTML_NONCE" ] && pass "HTML script tags carry a nonce" || fail "HTML script tags carry a nonce (strict-dynamic blocks every script without one)"
[ "$HDR_NONCE" = "$HTML_NONCE" ] && pass "header and HTML nonces match" || fail "header nonce and HTML nonce differ"
[ "$SCRIPTS" = "$NONCED" ] && pass "all $SCRIPTS script tags carry the nonce" || fail "$((SCRIPTS - NONCED)) of $SCRIPTS script tags have no nonce"

N1=$(curl -s "$BASE/login" | grep -o 'nonce="[^"]*"' | head -1)
N2=$(curl -s "$BASE/login" | grep -o 'nonce="[^"]*"' | head -1)
[ -n "$N1" ] && [ "$N1" != "$N2" ] && pass "nonce differs on every request" \
  || fail "nonce is reused across requests (a cached page serves one visitor's nonce to all)"

grep -qiE "^cache-control:.*(s-maxage|public)" /tmp/hc-head \
  && fail "a nonce-bearing page must not be shared-cached" \
  || pass "nonce-bearing page is not shared-cached"

echo
echo "== Authenticated API surface =="
curl -s -D /tmp/hc-api -o /dev/null "$BASE/api/transactions"
check "unauthenticated API returns 401"            /tmp/hc-api "^HTTP/1.1 401"
check "API responses are no-store"                 /tmp/hc-api "^cache-control:.*no-store"
check "API responses are private"                  /tmp/hc-api "^cache-control:.*private"
check "API responses Vary on Cookie"               /tmp/hc-api "^vary:.*Cookie"
check "API responses carry HSTS"                   /tmp/hc-api "^strict-transport-security:"
grep -qiE "^cache-control:.*(public|s-maxage)" /tmp/hc-api \
  && fail "an authenticated API response must never be publicly cacheable" \
  || pass "no public caching on the API"

echo
echo "== Protected page redirects, and still carries headers =="
curl -s -D /tmp/hc-red -o /dev/null "$BASE/accounts"
check "protected page redirects when signed out"   /tmp/hc-red "^HTTP/1.1 30[27]"
check "redirect target is the login page"          /tmp/hc-red "^location: /login"
check "redirect carries the CSP"                   /tmp/hc-red "^content-security-policy:"

echo
if [ "$failures" -eq 0 ]; then
  echo "All header checks passed."
else
  echo "$failures header check(s) FAILED."
fi
exit "$failures"
