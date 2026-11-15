#!/bin/bash
# Build and (re)start the app on the server. Called by user_data on first boot and by
# `soc.ps1 deploy` afterwards. First boot restores the latest S3 backup, or seeds.
set -euo pipefail
source /opt/soc/instance.env
SRC=/opt/soc/src
SERVER="$SRC/infra/server"

param() { aws ssm get-parameter --with-decryption --name "$SSM_PREFIX/$1" --query Parameter.Value --output text; }

umask 077
DB_PASSWORD="$(param db_password)"
cat > /opt/soc/app.env <<EOF
NODE_ENV=production
AUTH_MODE=local
API_HOST=0.0.0.0
API_PORT=4000
DATABASE_URL=postgres://soc:${DB_PASSWORD}@db:5432/soc
POSTGRES_PASSWORD=${DB_PASSWORD}
SESSION_SECRET=$(param session_secret)
SEED_PASSWORD=$(param seed_password)
ORIGIN_SECRET=$(param origin_secret)
STORAGE_DIR=/data/storage
MAIL_DIR=/data/mail
COOKIE_SECURE=true
TRUST_PROXY_HOPS=2
LOG_LEVEL=info
# Postcode lookup: postcodes_io (free). Switch to os_places + OS_PLACES_API_KEY with the council's PSGA access.
ADDRESS_PROVIDER=postcodes_io
EOF
umask 022

export DOCKER_BUILDKIT=0 # classic builder: no buildx plugin needed

# 1) Dependency image (Node packages + Chromium): keyed by a hash of the manifests.
#    local image → S3 cache → build (and upload to S3 in the background for next time).
DEPS_HASH="$(cat "$SRC/package.json" "$SRC/pnpm-lock.yaml" "$SRC/pnpm-workspace.yaml" \
  "$SRC"/apps/*/package.json "$SRC"/packages/*/package.json "$SERVER/Dockerfile.api-deps" | sha256sum | cut -c1-16)"
DEPS_TAG="soc-api-deps:$DEPS_HASH"
DEPS_S3="s3://$BUCKET/cache/api-deps-$DEPS_HASH.tar.gz"
if docker image inspect "$DEPS_TAG" >/dev/null 2>&1; then
  echo "== dependency image $DEPS_HASH: already on this server"
elif aws s3 ls "$DEPS_S3" >/dev/null 2>&1; then
  echo "== dependency image $DEPS_HASH: downloading from S3 cache"
  aws s3 cp --only-show-errors "$DEPS_S3" - | gunzip | docker load -q
else
  echo "== dependency image $DEPS_HASH: building (packages or lockfile changed; ~10 min on t4g.micro)"
  docker build -q -t "$DEPS_TAG" -f "$SERVER/Dockerfile.api-deps" "$SRC"
  ( docker save "$DEPS_TAG" | gzip -1 | aws s3 cp --only-show-errors - "$DEPS_S3" \
      && echo "cached $DEPS_TAG in S3" ) >> /var/log/soc-cache-upload.log 2>&1 &
fi
docker tag "$DEPS_TAG" soc-api-deps:latest

# 2) Code image: just the source on top (~30-60 s).
echo "== building code image"
docker build -q -t soc-api:latest -f "$SERVER/Dockerfile.api" "$SRC"

# Caddy config at a stable path (src/ is replaced on every deploy).
install -m 644 "$SERVER/Caddyfile" /opt/soc/Caddyfile

COMPOSE=(docker compose -f "$SERVER/docker-compose.yml" --env-file /opt/soc/app.env)
"${COMPOSE[@]}" up -d db
for i in $(seq 1 120); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' soc-db 2>/dev/null)" = healthy ] && break
  sleep 2
done

if [ ! -f /opt/soc/.initialised ]; then
  bash "$SERVER/restore.sh"
  touch /opt/soc/.initialised
fi

echo "== migrations"
"${COMPOSE[@]}" run --rm --no-deps -w /app/packages/db api /app/node_modules/.bin/tsx src/migrate.ts

"${COMPOSE[@]}" up -d --remove-orphans
docker restart soc-web >/dev/null # pick up a changed Caddyfile (restart takes ~1 s)
# Remove dangling layers and old dependency images (keep the current one).
docker images --format '{{.Repository}}:{{.Tag}}' | grep '^soc-api-deps:' | grep -v -e ":$DEPS_HASH\$" -e ':latest$' | xargs -r docker rmi -f >/dev/null 2>&1 || true
docker rmi soc-web:latest >/dev/null 2>&1 || true # web image no longer used (web is on S3)
docker image prune -f >/dev/null

# Daily backup at 02:30 UTC while the server is up (down also backs up first).
cat > /etc/systemd/system/soc-backup.service <<EOF
[Unit]
Description=Kingston SOC backup to S3
[Service]
Type=oneshot
ExecStart=/bin/bash $SERVER/backup.sh
EOF
cat > /etc/systemd/system/soc-backup.timer <<EOF
[Unit]
Description=Daily Kingston SOC backup
[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now soc-backup.timer >/dev/null

echo "DEPLOY_OK"
