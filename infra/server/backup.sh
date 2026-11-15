#!/bin/bash
# Database dump + photos/PDFs/emails → S3 (backups/latest and backups/archive/<timestamp>).
set -euo pipefail
source /opt/soc/instance.env
TS="$(date -u +%Y%m%dT%H%M%SZ)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

docker exec soc-db pg_dump -U soc -d soc -Fc > "$TMP/db.dump"
tar -czf "$TMP/data.tar.gz" -C /opt/soc/data .

for f in db.dump data.tar.gz; do
  aws s3 cp --only-show-errors "$TMP/$f" "s3://$BUCKET/backups/archive/$TS/$f"
  aws s3 cp --only-show-errors "$TMP/$f" "s3://$BUCKET/backups/latest/$f"
done
echo "BACKUP_OK $TS ($(du -h "$TMP/db.dump" | cut -f1) db, $(du -h "$TMP/data.tar.gz" | cut -f1) files)"
