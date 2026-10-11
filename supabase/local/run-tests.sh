#!/usr/bin/env bash
# Local DB test run without Docker: plain PostgreSQL 17 + PostGIS + pgTAP and a shim of the Supabase objects.
# Recreates the database, applies shim -> migrations -> seed, then runs every supabase/tests/*.sql.
# Usage: PGBIN=/path/to/pgsql/bin supabase/local/run-tests.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-$LOCALAPPDATA/kgp-tools/pgsql/bin}"
PGDATA="${PGDATA:-$LOCALAPPDATA/kgp-tools/pgdata}"
PORT="${PGPORT:-54329}"
DB=kgp_test
export PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER=postgres PGCLIENTENCODING=UTF8

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  "$PGBIN/initdb" -D "$PGDATA" -U postgres -A trust -E UTF8 --locale=C >/dev/null
fi
if ! "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PORT" -l "$PGDATA/server.log" -w start >/dev/null
fi

psql() { "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 "$@"; }

psql -d postgres -c "drop database if exists $DB" -c "create database $DB"
# Roles are cluster-wide: drop leftovers from a previous run before the shim recreates them.
psql -d postgres -c "do \$\$ declare r text; begin
  foreach r in array array['authenticator','anon','authenticated','service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('drop owned by %I cascade', r);
      execute format('drop role %I', r);
    end if;
  end loop; end \$\$" 2>/dev/null || true
psql -d "$DB" -c "alter database $DB set search_path = \"\$user\", public, extensions"

psql -d "$DB" -f "$ROOT/supabase/local/shim.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate  $(basename "$f")"
  psql -d "$DB" -f "$f" >/dev/null
done
echo "seed     seed.sql"
psql -d "$DB" -f "$ROOT/supabase/seed.sql" >/dev/null

fail=0; total=0
for f in "$ROOT"/supabase/tests/*.sql; do
  out="$("$PGBIN/psql" -X -q -t -A -d "$DB" -f "$f" 2>&1 || true)"
  ok=$(grep -c '^ok ' <<<"$out" || true)
  bad=$(grep -E '^not ok|ERROR|Looks like' <<<"$out" || true)
  total=$((total + ok))
  if [ -n "$bad" ]; then
    fail=1
    echo "FAIL     $(basename "$f") ($ok ok)"
    grep -E -A3 '^not ok|ERROR|Looks like' <<<"$out" | sed 's/^/         /'
  else
    echo "ok       $(basename "$f") ($ok assertions)"
  fi
done
echo "total    $total assertions"
exit $fail
