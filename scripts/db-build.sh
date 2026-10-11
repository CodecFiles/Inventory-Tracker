#!/usr/bin/env bash
# Builds a fresh, empty database from every migration.
# Usage: scripts/db-build.sh <database-name>
# Needs a PostgreSQL server (PGHOST/PGPORT/PGUSER). On Supabase the `auth` schema already exists;
# locally we create a minimal stand-in for it.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${1:?database name required}"

psql -q -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
SQL

for migration in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$migration"
done
echo "built $DB from $(ls supabase/migrations/*.sql | wc -l) migrations"
