#!/usr/bin/env bash
set -Eeuo pipefail

backup_file="${1:?Usage: verify-postgres-backup.sh /absolute/path/to/backup.dump}"

case "$backup_file" in
  /*) ;;
  *) echo "Backup path must be absolute" >&2; exit 2 ;;
esac

command -v pg_restore >/dev/null || {
  echo "pg_restore is required" >&2
  exit 127
}

test -s "$backup_file"
test -s "$backup_file.sha256"
sha256sum --check "$backup_file.sha256"
pg_restore --list "$backup_file" >/dev/null
printf 'Backup integrity verified: %s\n' "$backup_file"
