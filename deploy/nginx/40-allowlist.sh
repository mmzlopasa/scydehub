#!/bin/sh
# Builds /etc/nginx/conf.d/allowlist.inc from ALLOW_CIDRS (comma separated). Empty -> allow everyone.
# Written so that a stray comma or space can never end the script before "deny all" is added.
set -eu
OUT="${ALLOWLIST_OUT:-/etc/nginx/conf.d/allowlist.inc}"
TMP="$OUT.tmp"
: > "$TMP"
if [ -n "${ALLOW_CIDRS:-}" ]; then
  for c in $(printf '%s' "$ALLOW_CIDRS" | tr ',' ' '); do
    case "$c" in
      *[!0-9a-fA-F.:/]*) echo "40-allowlist: ignoring invalid entry '$c'" >&2 ;;
      *) echo "allow $c;" >> "$TMP" ;;
    esac
  done
  echo "deny all;" >> "$TMP"
fi
mv "$TMP" "$OUT"
