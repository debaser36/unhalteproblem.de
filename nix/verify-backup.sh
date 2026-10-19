# Restores a pg_dump custom-format backup into a scratch database and checks
# that it holds what a backup of the backend's database must hold. Proves the
# dump can be restored, not just that a file exists.
#
#   verify-backup.sh <dump-file> [admin database] [expected migrations]
#
# Connects with the usual PG* environment variables (PGHOST, PGPORT,
# PGUSER); the user must be allowed to create databases. The scratch
# database holds a full copy of the data, so it is dropped again at the end,
# and any left behind by an earlier run that could not drop it (killed, or
# the drop failed) is dropped first. With "expected migrations" the dump must
# have applied exactly that many; without, at least one.
set -euo pipefail

dump="${1:?usage: verify-backup.sh <dump-file> [admin-database] [expected-migrations]}"
admin="${2:-postgres}"
expected="${3:-}"
scratch="restore_check_$(date +%s)_$$"

admin_psql() { psql --no-psqlrc --quiet --dbname "$admin" "$@"; }

drop_scratch() {
  admin_psql --command "DROP DATABASE IF EXISTS \"$1\"" >/dev/null ||
    echo "warning: could not drop scratch database $1, it holds a copy of the data" >&2
}

cleanup() { drop_scratch "$scratch"; }
trap cleanup EXIT

[ -s "$dump" ] || { echo "backup $dump is missing or empty" >&2; exit 1; }

# Scratch databases of earlier runs (names are generated above, never input).
for stale in $(admin_psql --tuples-only --no-align \
  --command "SELECT datname FROM pg_database WHERE datname LIKE 'restore\_check\_%'"); do
  drop_scratch "$stale"
done

admin_psql --command "CREATE DATABASE \"$scratch\""
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
if [ -n "$expected" ] && [ "$migrations" -ne "$expected" ]; then
  echo "restored backup has $migrations migrations, the database has $expected" >&2
  exit 1
fi

echo "backup $dump restores: $tables tables, $migrations migrations, $users users"
