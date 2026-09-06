#!/usr/bin/env bash
#
# Run the whole test suite against a real PostgreSQL server.
#
# WHY THIS EXISTS
#
# The suite's default engine is SQLite, which is fast and needs no server. But
# SQLite and PostgreSQL disagree in ways that matter, and every disagreement is
# invisible to a SQLite-only run:
#
#   * `Int` is 64-bit on SQLite and 32-bit on PostgreSQL. Money columns
#     declared `Int` silently accepted balances in tests that production
#     rejected outright with `integer out of range`.
#   * `LIKE` is case-insensitive on SQLite and case-sensitive on PostgreSQL,
#     so search filters matched in tests and quietly returned nothing in
#     production.
#   * SQLite serialises writers. Concurrency tests that "prove" only one of
#     ten racing writers wins prove very little when the engine never let them
#     race in the first place.
#
# Both of the first two were live defects in this repository, found only by
# running this script. Treat a green SQLite run as necessary, not sufficient.
#
# Usage:  scripts/test-postgres.sh [vitest args...]
#   Set PGTEST_URL to point at an existing server, or let the script start a
#   throwaway local cluster.

set -euo pipefail
cd "$(dirname "$0")/.."

PGPORT_LOCAL="${PGPORT_LOCAL:-55432}"
PGDATA_LOCAL="${PGDATA_LOCAL:-/var/lib/mettapg}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DB_NAME="${DB_NAME:-metta_test}"

if [ -z "${PGTEST_URL:-}" ]; then
  if ! psql -h /tmp -p "$PGPORT_LOCAL" -U metta -d postgres -c 'select 1' >/dev/null 2>&1; then
    echo "Starting a throwaway PostgreSQL cluster on port $PGPORT_LOCAL…"
    rm -rf "$PGDATA_LOCAL"; mkdir -p "$PGDATA_LOCAL"
    id pgtest >/dev/null 2>&1 || useradd -M pgtest
    chown -R pgtest "$PGDATA_LOCAL"
    su pgtest -c "$PGBIN/initdb -D $PGDATA_LOCAL -U metta --auth=trust" >/dev/null
    su pgtest -c "$PGBIN/pg_ctl -D $PGDATA_LOCAL -o '-p $PGPORT_LOCAL -k /tmp' -l /tmp/pg.log start" >/dev/null
    sleep 1
  fi
  psql -h /tmp -p "$PGPORT_LOCAL" -U metta -d postgres \
    -c "DROP DATABASE IF EXISTS $DB_NAME;" -c "CREATE DATABASE $DB_NAME;" >/dev/null
  PGTEST_URL="postgresql://metta@localhost:$PGPORT_LOCAL/$DB_NAME?host=/tmp"
fi

# Restore the committed SQLite provider on the way out, however we exit: the
# schema file is checked in with `sqlite`, and a stray `postgresql` in a diff
# is exactly the kind of change that gets committed by accident.
cleanup() { node scripts/switch-db.js sqlite >/dev/null && npx prisma generate >/dev/null 2>&1 || true; }
trap cleanup EXIT

node scripts/switch-db.js postgres >/dev/null
npx prisma generate >/dev/null 2>&1

# Deploy the committed migrations rather than pushing the schema: this also
# verifies that the production deploy path actually applies cleanly.
DATABASE_URL="$PGTEST_URL" npx prisma migrate deploy >/dev/null

DATABASE_URL="$PGTEST_URL" npx vitest run "$@"
