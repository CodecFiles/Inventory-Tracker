#!/usr/bin/env bash
# Builds a throwaway database from every migration, then runs the pgTAP tests and the
# concurrency test against it.
#
# Usage: scripts/db-test.sh
# Needs: a PostgreSQL server (PGHOST/PGPORT/PGUSER), the pgtap extension and pg_prove.
set -euo pipefail
cd "$(dirname "$0")/.."

scripts/db-build.sh mrd_test
pg_prove -d mrd_test supabase/tests/*.sql
scripts/db-concurrency-test.sh
