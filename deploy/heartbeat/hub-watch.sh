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
STATE="${STATE_FILE:-/tmp/scydehub-watch.state}"
LIMIT="${FAILS_BEFORE_ALERT:-2}"

notify() {
  local title="$1" msg="$2"
  [ -n "${NTFY_URL:-}" ] && curl -fsS -m 10 -H "Title: $title" -H "Priority: high" -d "$msg" "$NTFY_URL" >/dev/null
  [ -n "${TELEGRAM_TOKEN:-}" ] && curl -fsS -m 10 "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT}" --data-urlencode "text=${title}: ${msg}" >/dev/null
  return 0
}

fails=$(cat "$STATE" 2>/dev/null || echo 0)
if curl -fsS -m 10 "$HUB_URL/healthz" >/dev/null 2>&1; then
  if [ "$fails" -ge "$LIMIT" ]; then notify "SCYDE Hub je ponovno online" "$HUB_URL odgovara."; fi
  echo 0 > "$STATE"
else
  fails=$((fails + 1))
  echo "$fails" > "$STATE"
  if [ "$fails" -eq "$LIMIT" ]; then notify "SCYDE Hub je nedostupan" "$HUB_URL ne odgovara ${LIMIT} min — možda je pao Proxmox host."; fi
fi
