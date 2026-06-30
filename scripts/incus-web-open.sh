#!/usr/bin/env bash
set -euo pipefail

url="${1:-}"
if [[ -z "$url" ]]; then
  echo "incus-web-open: missing URL" >&2
  exit 1
fi

case "$url" in
  http://*|https://*) ;;
  *)
    echo "incus-web-open: unsupported target: $url" >&2
    exit 1
    ;;
esac

printf '\nOpen this link in your browser:\n'
printf '\033]8;;%s\a%s\033]8;;\a\n\n' "$url" "$url"
