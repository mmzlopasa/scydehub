#!/usr/bin/env bash
# Obtain the first Let's Encrypt certificate for $DOMAIN, then start nginx + certbot.
# Safe to run again: an existing real certificate is kept (renewal is automatic).
# Usage: ./deploy/init-letsencrypt.sh [--staging]
set -euo pipefail
cd "$(dirname "$0")/.."

# .env is read as data, never executed as a shell script
envval() {
  [ -f .env ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" .env | tail -n 1 | sed -e 's/[[:space:]]*$//' -e "s/^\(['\"]\)\(.*\)\1\$/\2/"
}
DOMAIN="${DOMAIN:-$(envval DOMAIN)}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-$(envval CERTBOT_EMAIL)}"
HUB_BIND_VALUE="${HUB_BIND:-$(envval HUB_BIND)}"
[ -n "$DOMAIN" ] || { echo "Set DOMAIN in .env" >&2; exit 1; }
[ -n "$CERTBOT_EMAIL" ] || { echo "Set CERTBOT_EMAIL in .env" >&2; exit 1; }
case "$DOMAIN" in *[!A-Za-z0-9.-]*|hub.example.com) echo "DOMAIN in .env is not a usable host name: $DOMAIN" >&2; exit 1 ;; esac
case "$CERTBOT_EMAIL" in *[!A-Za-z0-9@._+-]*|you@example.com) echo "CERTBOT_EMAIL in .env is not a usable address" >&2; exit 1 ;; esac
if [ "$HUB_BIND_VALUE" != "127.0.0.1" ]; then
  echo "WARNING: HUB_BIND is not 127.0.0.1 - port 8484 stays reachable directly, bypassing nginx (HTTPS and the allowlist)." >&2
  echo "         Set HUB_BIND=127.0.0.1 in .env unless you want that." >&2
fi
STAGING=""
[ "${1:-}" = "--staging" ] && STAGING="--staging"

CONF=deploy/certbot/conf
LIVE="$CONF/live/$DOMAIN"
mkdir -p "$CONF" deploy/certbot/www

if [ -f "$LIVE/fullchain.pem" ] && [ ! -f "$LIVE/.temporary" ]; then
  echo "### A certificate for $DOMAIN already exists - keeping it"
  docker compose --profile proxy up -d
  echo "Done -> https://$DOMAIN"
  exit 0
fi

echo "### Creating a temporary self-signed certificate so nginx can start"
mkdir -p "$LIVE"
docker compose --profile proxy run --rm --entrypoint "\
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
    -out /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
    -subj /CN=localhost" certbot
docker compose --profile proxy run --rm --entrypoint "touch /etc/letsencrypt/live/$DOMAIN/.temporary" certbot

echo "### Starting hub + nginx"
docker compose --profile proxy up -d hub nginx

echo "### Removing the temporary certificate"
docker compose --profile proxy run --rm --entrypoint "\
  rm -rf /etc/letsencrypt/live/$DOMAIN /etc/letsencrypt/archive/$DOMAIN /etc/letsencrypt/renewal/$DOMAIN.conf" certbot

echo "### Requesting the Let's Encrypt certificate for $DOMAIN"
docker compose --profile proxy run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot $STAGING \
    --email $CERTBOT_EMAIL --agree-tos --no-eff-email \
    -d $DOMAIN --rsa-key-size 4096" certbot

echo "### Reloading nginx and starting the renewal loop"
docker compose --profile proxy exec nginx nginx -s reload
docker compose --profile proxy up -d
echo "Done -> https://$DOMAIN"
