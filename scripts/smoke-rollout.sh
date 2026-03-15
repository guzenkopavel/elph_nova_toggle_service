#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:${PORT:-3000}}"
PASS=0
FAIL=0

check() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "PASS [$name]"
    PASS=$((PASS+1))
  else
    echo "FAIL [$name]: expected '$expected' got '$actual'"
    FAIL=$((FAIL+1))
  fi
}

echo "=== Smoke rollout: $BASE_URL ==="
echo ""

# S1: Health liveness
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health/live")
check "S1: health liveness" "200" "$status"

# S2: Health readiness
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health/ready")
check "S2: health readiness" "200" "$status"

# S3: Anonymous public config
response=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/v1/feature-config" \
  -H "Platform: ios" -H "AppName: ElphNova" -H "AppVersion: 1.0.0")
status=$(echo "$response" | tail -1)
body=$(echo "$response" | head -n -1)
check "S3: anonymous config 200" "200" "$status"
if echo "$body" | grep -q '"features"'; then
  echo "PASS [S3: features field present]"
  PASS=$((PASS+1))
else
  echo "FAIL [S3: features field missing from response body]"
  FAIL=$((FAIL+1))
fi

# S4: Invalid token → 401 (when JWKS configured) or 503 (when JWKS not configured)
# With SSO_JWKS_URI set: malformed token fails cryptographic check → 401
# Without SSO_JWKS_URI: token verification unavailable → 503 (infra error)
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/feature-config" \
  -H "Platform: ios" -H "AppName: ElphNova" -H "AppVersion: 1.0.0" \
  -H "Authorization: Bearer invalid.token.here")
if [[ "$status" == "401" || "$status" == "503" ]]; then
  echo "PASS [S4: invalid token returns $status (401=JWKS configured, 503=no JWKS)]"
  PASS=$((PASS+1))
else
  echo "FAIL [S4: invalid token]: expected 401 or 503 got '$status'"
  FAIL=$((FAIL+1))
fi

# S5: Security headers present on public endpoint
headers=$(curl -sI "$BASE_URL/api/v1/feature-config" \
  -H "Platform: ios" -H "AppName: ElphNova" -H "AppVersion: 1.0.0" 2>/dev/null)
if echo "$headers" | grep -qi "x-content-type-options"; then
  echo "PASS [S5: x-content-type-options present]"
  PASS=$((PASS+1))
else
  echo "FAIL [S5: x-content-type-options missing]"
  FAIL=$((FAIL+1))
fi

# S6: Admin without auth → 401
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/admin/api/rules")
check "S6: admin no auth 401" "401" "$status"

# S7: Cache-Control: no-store on public config
cc=$(curl -sI "$BASE_URL/api/v1/feature-config" \
  -H "Platform: ios" -H "AppName: ElphNova" -H "AppVersion: 1.0.0" 2>/dev/null \
  | grep -i "cache-control" || echo "")
if echo "$cc" | grep -qi "no-store"; then
  echo "PASS [S7: cache-control no-store]"
  PASS=$((PASS+1))
else
  echo "FAIL [S7: cache-control no-store missing]"
  FAIL=$((FAIL+1))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [[ $FAIL -eq 0 ]]; then
  echo "All smoke checks passed."
  exit 0
else
  echo "Some smoke checks failed."
  exit 1
fi
