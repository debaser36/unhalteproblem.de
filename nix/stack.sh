# The local stack for checking a feature in the real app: a throwaway
# Postgres, the backend, the website, and a seeded login. Wrapped by
# flake.nix (writeShellApplication adds `set -euo pipefail` and puts Postgres,
# curl and jq on the PATH); inside `nix develop` it is the `stack` command.
#
# Everything it creates lives in the git-ignored .dev/ directory of the
# checkout, so each worktree has its own database and cookies.

root=$(git rev-parse --show-toplevel)
state=$root/.dev
pgdata=$state/postgres
cookies=$state/cookies

# The backend and Postgres ports differ from the defaults (3000, 5432) so the
# stack does not collide with something else running on the machine.
pg_port=${STACK_PG_PORT:-54329}
backend_port=${STACK_BACKEND_PORT:-3100}
web_port=${STACK_WEB_PORT:-5173}
web_origin=http://localhost:$web_port

all_roles=normalUser,admin,superAdmin,foodPlanner

usage() {
  cat <<EOF
Usage: stack <command>

  up                        start Postgres, backend and website, log in a seeded admin
  down                      stop all three (the data stays)
  status                    what is running, and whether it answers
  logs [postgres|backend|web]
                            follow a log (default: backend)
  psql [args]               psql on the stack's database
  login [user] [roles]      seed a user and a session, print the cookie
                            (defaults: dev-admin, $all_roles)
  shot <path> [file.png] [--user name] [--full]
                            screenshot of a page, e.g. 'stack shot /admin'
  reset                     stop everything and delete .dev/ (database included)

Website: $web_origin   Backend: http://127.0.0.1:$backend_port
Login is not possible (no Keycloak); 'stack login' seeds the session instead.
Secrets such as STRIPE_SECRET_KEY are read from .env if it exists.
EOF
}

# --- processes -------------------------------------------------------------

# Starts a command detached in its own session, so 'stack down' can stop it
# together with the children pnpm and node --watch start.
spawn() {
  local name=$1
  shift
  mkdir -p "$state"
  # shellcheck disable=SC2016  # $$ and $@ are meant for the inner shell
  setsid bash -c 'echo $$ >"$0"; exec "$@"' "$state/$name.pid" "$@" \
    >"$state/$name.log" 2>&1 </dev/null &
}

stop_spawned() {
  local name=$1 pid
  [ -f "$state/$name.pid" ] || return 0
  pid=$(cat "$state/$name.pid")
  if kill -0 "$pid" 2>/dev/null; then
    kill -- "-$pid" 2>/dev/null || true
    for _ in $(seq 1 50); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -9 -- "-$pid" 2>/dev/null || true
  fi
  rm -f "$state/$name.pid"
}

is_running() {
  [ -f "$state/$1.pid" ] && kill -0 "$(cat "$state/$1.pid")" 2>/dev/null
}

# node --watch and vite keep running after a crash, so the log tells.
wait_for() {
  local name=$1 url=$2
  for _ in $(seq 1 120); do
    if curl -sf -o /dev/null "$url"; then
      return 0
    fi
    if grep -q "Failed running" "$state/$name.log" 2>/dev/null; then
      tail -n 15 "$state/$name.log" >&2
      echo "stack: $name crashed; see above ('stack logs $name')" >&2
      return 1
    fi
    sleep 1
  done
  echo "stack: $name did not answer at $url within 2 minutes; see 'stack logs $name'" >&2
  return 1
}

# --- postgres --------------------------------------------------------------

run_psql() {
  psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$pg_port" \
    -U unhalteproblem -d unhalteproblem "$@"
}

pg_running() {
  pg_ctl -D "$pgdata" status >/dev/null 2>&1
}

start_postgres() {
  if pg_running; then
    return 0
  fi
  if [ ! -d "$pgdata" ]; then
    mkdir -p "$state"
    # Trust auth on loopback only: the cluster is throwaway and listens on
    # 127.0.0.1 alone.
    initdb -D "$pgdata" -U unhalteproblem --auth=trust --encoding=UTF8 \
      >"$state/initdb.log" 2>&1
  fi
  # No unix socket: its path would exceed the length limit in deep checkouts.
  pg_ctl -D "$pgdata" -l "$state/postgres.log" -w \
    -o "-p $pg_port -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
    start >/dev/null
  psql -X -q -h 127.0.0.1 -p "$pg_port" -U unhalteproblem -d postgres \
    -tAc "SELECT 1 FROM pg_database WHERE datname = 'unhalteproblem'" |
    grep -q 1 ||
    psql -X -q -h 127.0.0.1 -p "$pg_port" -U unhalteproblem -d postgres \
      -c 'CREATE DATABASE unhalteproblem'
}

# --- app -------------------------------------------------------------------

start_backend() {
  is_running backend && return 0
  # Secrets (Stripe, Anthropic) come from .env; the fixed values below win.
  # OIDC_ISSUER points at a closed port: the backend starts and migrates,
  # but the Keycloak login cannot work, which is what 'stack login' is for.
  # shellcheck disable=SC2016  # the script runs in the inner shell
  spawn backend env -C "$root" bash -c '
    if [ -f .env ]; then set -a; . ./.env; set +a; fi
    export PORT='"$backend_port"' HOST=127.0.0.1 LOG_FORMAT=pretty
    export POSTGRES_HOST=127.0.0.1 POSTGRES_PORT='"$pg_port"'
    export POSTGRES_DB=unhalteproblem POSTGRES_USER=unhalteproblem
    export OIDC_ISSUER=https://127.0.0.1:9/realms/dev OIDC_CLIENT_SECRET=dev
    export KEYCLOAK_ADMIN_CLIENT_SECRET=dev
    export PUBLIC_ORIGIN='"$web_origin"'
    # Generous unless .env sets it: the end-to-end tests send a contact
    # message on every run, and the limit only resets with a restart.
    export CONTACT_RATE_LIMIT=${CONTACT_RATE_LIMIT:-1000}
    exec pnpm --filter @unhalteproblem.de/backend dev
  '
}

start_web() {
  is_running web && return 0
  spawn web env -C "$root" BACKEND_URL="http://127.0.0.1:$backend_port" \
    pnpm --filter @unhalteproblem.de/website dev \
    --host 127.0.0.1 --port "$web_port" --strictPort
}

port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# A leftover process on a port would make the new one fail while the old one
# keeps answering the readiness checks, so refuse early.
check_ports_free() {
  local name=$1 port=$2
  if ! is_running "$name" && port_busy "$port"; then
    echo "stack: port $port is in use by another process; set STACK_${3}_PORT" >&2
    exit 1
  fi
}

cmd_up() {
  check_ports_free backend "$backend_port" BACKEND
  check_ports_free web "$web_port" WEB
  start_postgres
  start_backend
  start_web
  wait_for backend "http://127.0.0.1:$backend_port/ready"
  wait_for web "$web_origin/"
  cmd_login dev-admin "$all_roles" >/dev/null
  echo "website   $web_origin"
  echo "backend   http://127.0.0.1:$backend_port"
  echo "postgres  postgresql://unhalteproblem@127.0.0.1:$pg_port/unhalteproblem"
  echo "admin     cookie in $cookies/dev-admin ('stack login' prints it)"
}

cmd_down() {
  stop_spawned web
  stop_spawned backend
  if pg_running; then
    pg_ctl -D "$pgdata" -m fast -w stop >/dev/null
  fi
  echo "stopped"
}

report() {
  local name=$1 url=$2 text
  if ! is_running "$name"; then
    text=stopped
  elif curl -sf -o /dev/null "$url"; then
    text="running, answers"
  else
    text="running, not answering yet"
  fi
  echo "$name  $text ($url)"
}

cmd_status() {
  local pg=stopped
  if pg_running; then pg=running; fi
  echo "postgres  $pg (127.0.0.1:$pg_port)"
  report backend "http://127.0.0.1:$backend_port/ready"
  report web "$web_origin/"
}

cmd_logs() {
  local which=${1:-backend}
  tail -n 50 -f "$state/$which.log"
}

# Seeds a user and a logged-in session and prints the cookie value. Needs the
# backend to have migrated, because it writes to its tables.
cmd_login() {
  local name=${1:-dev-admin} roles=${2:-$all_roles} cookie
  cookie=$(head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n')
  run_psql -v name="$name" -v roles="$roles" -v cookie="$cookie" <<'SQL'
WITH u AS (
  INSERT INTO users (id, subject, username, name, email, email_verified,
                     created_at, updated_at, last_login_at)
  VALUES (gen_random_uuid(), 'local-' || :'name', :'name', :'name',
          :'name' || '@example.invalid', true, date_trunc('milliseconds', now()),
          date_trunc('milliseconds', now()), date_trunc('milliseconds', now()))
  ON CONFLICT (subject) DO UPDATE
    SET last_login_at = date_trunc('milliseconds', now())
  RETURNING id, subject
), drop_roles AS (
  DELETE FROM user_roles
  WHERE user_id IN (SELECT id FROM u)
    AND role <> ALL (string_to_array(:'roles', ','))
), drop_sessions AS (
  DELETE FROM auth_sessions WHERE user_id IN (SELECT subject FROM u)
), grant_roles AS (
  INSERT INTO user_roles (user_id, role)
  SELECT u.id, r FROM u, unnest(string_to_array(:'roles', ',')) AS r
  ON CONFLICT DO NOTHING
)
INSERT INTO auth_sessions (id_hash, user_id, claims, expires_at)
SELECT sha256(convert_to(:'cookie', 'UTF8')), u.subject,
       jsonb_build_object('preferred_username', :'name', 'name', :'name',
                          'email', :'name' || '@example.invalid',
                          'email_verified', true),
       now() + interval '30 days'
FROM u;
SQL
  mkdir -p "$cookies"
  printf '%s' "$cookie" >"$cookies/$name"
  echo "__Host-session=$cookie"
}

cmd_shot() {
  local path=${1:?usage: stack shot <path> [file.png] [--user name] [--full]}
  shift
  local out=$state/shot.png user=dev-admin full=0
  while [ $# -gt 0 ]; do
    case $1 in
      --user) user=${2:?--user needs a name}; shift ;;
      --full) full=1 ;;
      *) out=$1 ;;
    esac
    shift
  done
  [ -f "$cookies/$user" ] || cmd_login "$user" >/dev/null
  STACK_URL="$web_origin$path" STACK_OUT=$out STACK_FULL=$full \
    STACK_COOKIE="__Host-session=$(cat "$cookies/$user")" \
    env -u LD_LIBRARY_PATH node "$STACK_SHOT_SCRIPT"
  echo "$out"
}

cmd_reset() {
  cmd_down
  rm -rf "$state"
  echo "removed $state"
}

cmd=${1:-help}
if [ $# -gt 0 ]; then shift; fi
case $cmd in
  up) cmd_up ;;
  down) cmd_down ;;
  status) cmd_status ;;
  logs) cmd_logs "$@" ;;
  psql) run_psql "$@" ;;
  login) cmd_login "$@" ;;
  shot) cmd_shot "$@" ;;
  reset) cmd_reset ;;
  help | -h | --help) usage ;;
  *)
    usage >&2
    exit 1
    ;;
esac
