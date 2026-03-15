#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAP_FILE="$ROOT_DIR/docs/REPO_MAP.md"

if [[ ! -f "$MAP_FILE" ]]; then
  echo "docs/REPO_MAP.md not found" >&2
  exit 1
fi

while IFS= read -r file; do
  rel="${file#./}"

  case "$rel" in
    .git/*|node_modules/*|dist/*|coverage/*|.next/*|.turbo/*|.cache/*|*.DS_Store)
      continue
      ;;
  esac

  if ! grep -Fq "$rel" "$MAP_FILE"; then
    printf '%s\n' "$rel"
  fi
done < <(
  cd "$ROOT_DIR"
  find . -type f \
    ! -path './.git/*' \
    ! -path './node_modules/*' \
    ! -path './dist/*' \
    ! -path './coverage/*' \
    ! -path './.next/*' \
    ! -path './.turbo/*' \
    ! -path './.cache/*' \
    ! -name '.DS_Store' \
    | sort
)
