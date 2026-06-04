#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$root_dir/.env.local"

escape_env_value() {
  local value="$1"
  value="${value//$'\\n'/}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

read -r -p "GolfBox username: " username
read -r -s -p "GolfBox password: " password
printf '\n'

{
  printf 'GOLFBOX_PROVIDER=official\n'
  printf 'GOLFBOX_USERNAME=%s\n' "$(escape_env_value "$username")"
  printf 'GOLFBOX_PASSWORD=%s\n' "$(escape_env_value "$password")"
  printf 'GOLFBOX_COUNTRY=NO\n'
  printf 'GOLFBOX_REQUEST_TIMEOUT_MS=15000\n'
  printf 'GOLFBOX_WEB_REQUEST_TIMEOUT_MS=15000\n'
  printf 'GOLFBOX_ALLOW_UNTRUSTED_URLS=false\n'
  printf 'GOLFBOX_INCLUDE_ERROR_BODY_SNIPPETS=false\n'
  printf 'GOLFBOX_ENABLE_WRITE_TOOLS=false\n'
  printf 'GOLFBOX_REQUIRE_CONFIRMATION=true\n'
} > "$env_file"

chmod 600 "$env_file"
printf 'Wrote %s with permissions 600.\n' "$env_file"
