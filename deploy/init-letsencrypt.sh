#!/usr/bin/env bash
# One-time: obtain the first Let's Encrypt certificate for $DOMAIN, then start nginx + certbot.
# Usage: ./deploy/init-letsencrypt.sh [--staging]
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
: "${DOMAIN:?Set DOMAIN in .env}"
: "${CERTBOT_EMAIL:?Set CERTBOT_EMAIL in .env}"
STAGING=""
[ "${1:-}" = "--staging" ] && STAGING="--staging"

CONF=deploy/certbot/conf
mkdir -p "$CONF" deploy/certbot/www


echo "### Creating a temporary self-signed certificate so nginx can start"
mkdir -p "$CONF/live/$DOMAIN"
docker compose --profile proxy run --rm --entrypoint "\
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
    -out /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
    -subj /CN=localhost" certbot

echo "### Starting hub + nginx"
docker compose --profile proxy up -d hub nginx

echo "### Removing the temporary certificate"
docker compose --profile proxy run --rm --entrypoint "\
  rm -rf /etc/letsencrypt/live/$DOMAIN /etc/letsencrypt/archive/$DOMAIN /etc/letsencrypt/renewal/$DOMAIN.conf" certbot

echo "### Requesting the Let's Encrypt certificate for $DOMAIN"
docker compose --profile proxy run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot $STAGING \
    --email $CERTBOT_EMAIL --agree-tos --no-eff-email \
    -d $DOMAIN --rsa-key-size 4096 --force-renewal" certbot

echo "### Reloading nginx and starting the renewal loop"
docker compose --profile proxy exec nginx nginx -s reload
docker compose --profile proxy up -d
echo "Done → https://$DOMAIN"
