#!/usr/bin/env bash
# Local preview: builds the demo database "mrd_dev" and starts `next dev` as the demo Super Admin.
# Usage: scripts/dev-preview.sh [port]   (needs the local PostgreSQL server, like the tests)
# Other demo users: MRD_DEV_USER_ID=6f1c2a3e-0000-4000-8000-000000000d02 (Editor), …d03 (Viewer).
set -euo pipefail
cd "$(dirname "$0")/.."
scripts/db-build.sh mrd_dev
psql -q -o /dev/null -d mrd_dev -f scripts/dev-seed.sql
echo "demo data loaded into mrd_dev"
export PGDATABASE=mrd_dev MRD_DEV_USER_ID="${MRD_DEV_USER_ID:-6f1c2a3e-0000-4000-8000-000000000d01}"
unset DATABASE_URL POSTGRES_URL
exec npx next dev -p "${1:-3000}"
