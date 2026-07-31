#!/usr/bin/env bash
# Ensures app/.env has a SESSION_SECRET, generating one on first install.
# Safe to re-run: leaves an existing SESSION_SECRET untouched so sessions
# aren't invalidated on every install.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

touch "$ENV_FILE"

if grep -q '^SESSION_SECRET=.\+' "$ENV_FILE"; then
  echo "SESSION_SECRET already set in $ENV_FILE, leaving it untouched."
  exit 0
fi

SECRET="$(generate_secret)"

if grep -q '^SESSION_SECRET=' "$ENV_FILE"; then
  sed -i.bak "s/^SESSION_SECRET=.*/SESSION_SECRET=${SECRET}/" "$ENV_FILE"
  rm -f "$ENV_FILE.bak"
else
  echo "SESSION_SECRET=${SECRET}" >> "$ENV_FILE"
fi

echo "Generated a new SESSION_SECRET in $ENV_FILE"
