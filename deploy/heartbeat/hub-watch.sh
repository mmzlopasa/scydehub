#!/usr/bin/env bash
# External heartbeat for SCYDE Hub — run it on a machine that does NOT live on the same Proxmox host
# (e.g. the WHM/hosting server). If the Proxmox host dies, the Hub dies with it, so the Hub can't alert you itself.
#
# crontab -e:
#   * * * * * HUB_URL=https://hub.example.com NTFY_URL=https://ntfy.sh/your-topic /usr/local/bin/hub-watch.sh
#
# Optional: TELEGRAM_TOKEN + TELEGRAM_CHAT instead of / in addition to NTFY_URL. FAILS_BEFORE_ALERT (default 2).
set -u
HUB_URL="${HUB_URL:?set HUB_URL}"
# not /tmp: a world-writable directory lets another local user pre-create (or symlink) the state file
STATE="${STATE_FILE:-${HOME:-/var/tmp}/.scydehub-watch.state}"
LIMIT="${FAILS_BEFORE_ALERT:-2}"

notify() {
  local title="$1" msg="$2"
  if [ -n "${NTFY_URL:-}" ]; then curl -fsS -m 10 -H "Title: $title" -H "Priority: high" -d "$msg" "$NTFY_URL" >/dev/null || echo "hub-watch: ntfy notification failed" >&2; fi
  if [ -n "${TELEGRAM_TOKEN:-}" ] && [ -z "${TELEGRAM_CHAT:-}" ]; then echo "hub-watch: TELEGRAM_CHAT is not set" >&2; return 0; fi
  [ -n "${TELEGRAM_TOKEN:-}" ] && curl -fsS -m 10 "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT}" --data-urlencode "text=${title}: ${msg}" >/dev/null
  return 0
}

fails=$(cat "$STATE" 2>/dev/null || echo 0)
case "$fails" in ''|*[!0-9]*) fails=0 ;; esac   # empty or damaged state file
save() { printf '%s\n' "$1" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"; }
if curl -fsS -m 10 "$HUB_URL/healthz" >/dev/null 2>&1; then
  if [ "$fails" -ge "$LIMIT" ]; then notify "SCYDE Hub is back online" "$HUB_URL is responding again."; fi
  save 0
else
  fails=$((fails + 1))
  save "$fails"
  if [ "$fails" -eq "$LIMIT" ]; then notify "SCYDE Hub is unreachable" "$HUB_URL has not answered for ${LIMIT} min — the Proxmox host may be down."; fi
fi
