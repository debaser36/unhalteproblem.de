# Database

Login state, sessions and users live in Postgres. The database must exist; the
service creates its tables itself. At startup it applies all pending
migrations from `src/migrations/` in one transaction (recorded in
`effect_sql_migrations`) before it serves requests, and it doesn't start if
the database is unreachable or a migration fails.

Migrations are imported statically (`src/infrastructure/Database.ts`), because the
service runs as a single bundled file. Committed migrations are never edited;
changes go into a new, numbered migration. Tests run all migrations on an
in-memory PGlite database (`#testing/Database`).

## Long-running migrations

Pending migrations run at startup, all in one transaction, before the
service listens. That is simple and safe for the small tables here, and it
has consequences once a migration takes a while:

- **The deploy waits.** Until the migrations commit, the new container
  serves nothing, and the healthcheck (`/ready`) has its start period of 20
  seconds. A migration that needs minutes makes the unit look unhealthy and
  can be restarted in the middle, which rolls the whole transaction back and
  starts over. Run slow ones by hand first (see "Long-running migrations" above).
- **`POSTGRES_STATEMENT_TIMEOUT` (30 seconds) applies to migrations too.**
  A statement that runs longer is cancelled and the service doesn't start.
  For a deploy with a known-slow migration, raise it for that one start and
  remove it afterwards.
- **Locks.** `ALTER TABLE` and plain `CREATE INDEX` take locks that block
  writes (or everything) on the table while they run, and wait behind
  running transactions. On a big, busy table that stalls requests. Prefer
  the steps that don't: add nullable columns without a default, add
  constraints as `NOT VALID` and `VALIDATE CONSTRAINT` in a later migration,
  and split a risky change into expand (add, backfill) and contract (remove
  the old) over two deploys, so the old and the new version both work
  against the intermediate schema.
- **`CREATE INDEX CONCURRENTLY` can't run in a transaction**, so it can't be
  a migration. Create the index by hand beforehand, then write the migration
  with `CREATE INDEX IF NOT EXISTS` (a no-op there, and the real thing for a
  fresh database such as the tests):

  ```sh
  sudo -u postgres psql unhalteproblem \
    -c 'CREATE INDEX CONCURRENTLY IF NOT EXISTS users_x_idx ON users (x)'
  ```

- **Backfills** of many rows belong in batches, outside the migration
  (a script, or an outbox job), not in one statement.

Take a backup before a risky migration (`systemctl start
unhalteproblem-backup`, see "Backups" below): migrations are irreversible by
design, so a restore is the way back.

## Backups

The NixOS module can dump the database regularly
(`services.unhalteproblem-backend.backup.enable = true;`, needs
`services.postgresql` on the same host). `unhalteproblem-backup.service` runs
daily (`backup.startAt`) as the postgres user:

1. `pg_dump --format=custom` into `backup.location`
   (`/var/backup/unhalteproblem/<db>-<date>.dump`, mode 0700 directory).
2. **Restores that dump into a scratch database** and checks that it holds as
   many applied migrations as the live database (`nix/verify-backup.sh`),
   then drops the scratch database (and any left over by a run that could not
   drop it). A dump that fails is renamed to `*.dump.failed`, so the newest
   `*.dump` is always a proven one, and the unit fails instead of the problem
   sitting unnoticed until the day it is needed. **Nothing alerts you**: watch
   `systemctl --failed` or hook an alert to the unit. The timer is
   persistent, so a run missed while the machine was off happens at boot.
3. Only then deletes dumps (and failed ones) older than `backup.keepDays` (14).

The dumps contain everything, personal data included, and live on the same
machine as the database. Accounts users deleted
are still in the dumps until they age out (`keepDays`, plus any copy you took
off the machine). Copy them to another place (restic, rsync, a
provider's object storage) from `backup.location`; that part is not
automated here. Check a dump from anywhere with
`PGUSER=… bash nix/verify-backup.sh <dump>` (a Postgres of the same version
as the server).

To restore after losing the database:

```sh
systemctl stop podman-unhalteproblem-backend   # the container (docker-… with docker)
sudo -u postgres dropdb --if-exists unhalteproblem
sudo -u postgres createdb --owner unhalteproblem unhalteproblem
sudo -u postgres pg_restore --role unhalteproblem --no-owner \
  --exit-on-error --dbname unhalteproblem /var/backup/unhalteproblem/<dump>
systemctl start podman-unhalteproblem-backend
```

`--role` makes the backend's user own the restored tables. The dump includes
`effect_sql_migrations`, so the backend finds the schema up to date (or
applies the migrations that are newer than the dump). Sessions in the dump
are restored too; those that expired meanwhile are cleaned up as usual.
