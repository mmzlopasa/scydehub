#!/bin/sh
# Builds /etc/nginx/conf.d/allowlist.inc from ALLOW_CIDRS (comma separated). Empty → allow everyone.
set -e
OUT=/etc/nginx/conf.d/allowlist.inc
: > "$OUT"
if [ -n "$ALLOW_CIDRS" ]; then
  echo "$ALLOW_CIDRS" | tr ',' '\n' | while read -r c; do
    c=$(echo "$c" | tr -d ' ')
    [ -n "$c" ] && echo "allow $c;" >> "$OUT"
  done
  echo "deny all;" >> "$OUT"
fi
