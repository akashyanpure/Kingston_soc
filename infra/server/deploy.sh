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

echo "== building images (first build on t4g.micro takes ~10 min)"
export DOCKER_BUILDKIT=0 # classic builder: no buildx plugin needed
docker build -q -t soc-api:latest -f "$SERVER/Dockerfile.api" "$SRC"
docker build -q -t soc-web:latest -f "$SERVER/Dockerfile.web" "$SRC"

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
