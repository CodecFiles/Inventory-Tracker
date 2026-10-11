#!/usr/bin/env bash
# Builds a throwaway database from every migration, then runs the pgTAP tests against it.
#
# Usage: scripts/db-test.sh
# Needs: a PostgreSQL server (PGHOST/PGPORT/PGUSER), the pgtap extension and pg_prove.
# On Supabase the `auth` schema already exists; locally we create a minimal stand-in for it.
set -euo pipefail

cd "$(dirname "$0")/.."
DB="mrd_test"

psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"

psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
SQL

for migration in supabase/migrations/*.sql; do
  echo "applying $(basename "$migration")"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$migration"
done

pg_prove -d "$DB" supabase/tests/*.sql

scripts/db-concurrency-test.sh
