#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/find-code.sh paths [pattern]
  scripts/find-code.sh text <pattern>

Examples:
  scripts/find-code.sh paths feature-config
  scripts/find-code.sh text "expectedRevision"
EOF
}

mode="${1:-}"

if [[ -z "$mode" ]]; then
  usage
  exit 1
fi

shift || true

rg_excludes=(
  --hidden
  --glob '!.git/**'
  --glob '!node_modules/**'
  --glob '!dist/**'
  --glob '!coverage/**'
  --glob '!.next/**'
  --glob '!.turbo/**'
  --glob '!.cache/**'
)

case "$mode" in
  paths)
    pattern="${1:-.}"
    (
      cd "$ROOT_DIR"
      rg --files "${rg_excludes[@]}" | rg "$pattern"
    )
    ;;
  text)
    pattern="${1:-}"
    if [[ -z "$pattern" ]]; then
      usage
      exit 1
    fi
    (
      cd "$ROOT_DIR"
      rg -n "${rg_excludes[@]}" "$pattern"
    )
    ;;
  *)
    usage
    exit 1
    ;;
esac

