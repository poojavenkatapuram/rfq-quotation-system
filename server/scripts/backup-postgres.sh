#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${BACKUP_DIRECTORY:?BACKUP_DIRECTORY must be an absolute directory path}"

case "$BACKUP_DIRECTORY" in
  /*) ;;
  *) echo "BACKUP_DIRECTORY must be absolute" >&2; exit 2 ;;
esac

command -v pg_dump >/dev/null || {
  echo "pg_dump is required" >&2
  exit 127
}

umask 077
mkdir -p "$BACKUP_DIRECTORY"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$BACKUP_DIRECTORY/rfq-quotation-$timestamp.dump"

if [ -e "$backup_file" ]; then
  echo "Refusing to overwrite an existing backup" >&2
  exit 1
fi

# libpq accepts a connection string through PGDATABASE without placing it in
# the process command line.
export PGDATABASE="$DATABASE_URL"
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$backup_file"

test -s "$backup_file"
sha256sum "$backup_file" > "$backup_file.sha256"
printf 'Backup created: %s\n' "$backup_file"
