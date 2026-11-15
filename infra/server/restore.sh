#!/bin/bash
# First boot: restore the latest S3 backup if one exists; otherwise create the schema and
# seed demo data (users' password = SSM <prefix>/seed_password, never the local dev one).
set -euo pipefail
source /opt/soc/instance.env
SERVER=/opt/soc/src/infra/server
COMPOSE=(docker compose -f "$SERVER/docker-compose.yml" --env-file /opt/soc/app.env)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if aws s3 ls "s3://$BUCKET/backups/latest/db.dump" >/dev/null 2>&1; then
  echo "== restoring latest backup"
  aws s3 cp --only-show-errors "s3://$BUCKET/backups/latest/db.dump" "$TMP/db.dump"
  docker exec -i soc-db pg_restore -U soc -d soc --clean --if-exists --no-owner < "$TMP/db.dump"
  if aws s3 cp --only-show-errors "s3://$BUCKET/backups/latest/data.tar.gz" "$TMP/data.tar.gz"; then
    tar -xzf "$TMP/data.tar.gz" -C /opt/soc/data
  fi
  echo "RESTORE_OK"
else
  echo "== no backup found: fresh database + demo seed"
  "${COMPOSE[@]}" run --rm --no-deps -w /app/packages/db api /app/node_modules/.bin/tsx src/migrate.ts
  "${COMPOSE[@]}" run --rm --no-deps -w /app/packages/db api /app/node_modules/.bin/tsx src/seed.ts
  echo "SEED_OK"
fi
