# Restores a pg_dump custom-format backup into a scratch database and checks
# that it holds what a backup of the backend's database must hold. Proves the
# dump can be restored, not just that a file exists.
#
#   verify-backup.sh <dump-file> [admin database]
#
# Connects with the usual PG* environment variables (PGHOST, PGPORT,
# PGUSER); the user must be allowed to create databases. The scratch
# database is always dropped again.
set -euo pipefail

dump="${1:?usage: verify-backup.sh <dump-file> [admin-database]}"
admin="${2:-postgres}"
scratch="restore_check_$(date +%s)_$$"

cleanup() {
  psql --no-psqlrc --quiet --dbname "$admin" \
    --command "DROP DATABASE IF EXISTS \"$scratch\"" >/dev/null 2>&1 || true
}
trap cleanup EXIT

[ -s "$dump" ] || { echo "backup $dump is missing or empty" >&2; exit 1; }

psql --no-psqlrc --quiet --dbname "$admin" --command "CREATE DATABASE \"$scratch\""
# --exit-on-error: a dump that restores "with errors" is not a good backup.
pg_restore --no-owner --no-privileges --exit-on-error \
  --dbname "$scratch" "$dump"

query() { psql --no-psqlrc --tuples-only --no-align --dbname "$scratch" --command "$1"; }

migrations=$(query "SELECT count(*) FROM effect_sql_migrations")
users=$(query "SELECT count(*) FROM users")
tables=$(query "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")

if [ "$migrations" -lt 1 ]; then
  echo "restored backup has no applied migrations" >&2
  exit 1
fi

echo "backup $dump restores: $tables tables, $migrations migrations, $users users"
