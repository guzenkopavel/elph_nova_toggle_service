#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3099}"
BASE_URL="http://localhost:$PORT"

echo "=== Auth smoke: anonymous request (no token) ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Platform: ios" -H "AppName: ElphNova" -H "AppVersion: 2.14.3" \
  "$BASE_URL/api/v1/feature-config")
[[ "$STATUS" == "200" ]] && echo "PASS: 200 anonymous" || { echo "FAIL: expected 200, got $STATUS"; exit 1; }

echo ""
echo "=== Auth smoke: malformed bearer token → 401 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Platform: ios" -H "AppName: ElphNova" -H "AppVersion: 2.14.3" \
  -H "Authorization: Bearer notavalidjwt" \
  "$BASE_URL/api/v1/feature-config")
[[ "$STATUS" == "401" ]] && echo "PASS: 401 invalid token" || { echo "FAIL: expected 401, got $STATUS"; exit 1; }

echo ""
echo "=== Auth smoke: no SSO config + bearer token → 503 ==="
echo "NOTE: this scenario requires the server to be started without SSO_JWKS_URI."
echo "      When SSO_JWKS_URI is set, a real JWT signed by the JWKS key is needed."
echo "      Automated coverage for this path lives in C5 of feature-config.test.ts."

echo ""
echo "All auth smoke scenarios passed."
echo ""
echo "Deferred (require real SSO setup or CI with JWKS server):"
echo "  - valid JWT → 200 authenticated"
echo "  - JWKS network failure → 503"
