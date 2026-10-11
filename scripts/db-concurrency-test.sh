#!/usr/bin/env bash
# Concurrency test: two people deploy 6 of the same 10 cables at the same moment.
# Uses two real, separate database connections. Expected: exactly one succeeds, the other is
# rejected, and the office is left with 4 — never -2.
#
# Run after scripts/db-test.sh has built the mrd_test database.
set -euo pipefail
DB="mrd_test"
q() { psql -qtA -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }

# --- committed sample data (pgTAP tests roll back, this one must be visible to both sessions)
psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000c1');
insert into users (id, email, full_name, role, status)
  values ('00000000-0000-0000-0000-0000000000c1', 'race@test.local', 'Race Tester', 'editor', 'approved');
insert into categories (name) values ('Race cables');
insert into products (name, brand, model, category_id, tracking_type)
  select 'Race cable', 'Generic', 'RACE-1', id, 'quantity' from categories where name = 'Race cables';
insert into clients (name) values ('Race client');
insert into facilities (name, client_id, country_id)
  select 'Race site', c.id, k.id from clients c, countries k where c.name = 'Race client' and k.iso_code = 'OM';
insert into stock_movements (movement_type, product_id, quantity, to_location_id, performed_by)
  select 'receive', id, 10, office_location_id(), '00000000-0000-0000-0000-0000000000c1'
  from products where model = 'RACE-1';
SQL

deploy_six='
begin;
insert into stock_movements (movement_type, product_id, quantity, from_location_id, to_location_id, performed_by)
  select '\''deploy'\'', p.id, 6, office_location_id(), l.id, '\''00000000-0000-0000-0000-0000000000c1'\''
  from products p, locations l join facilities f on f.id = l.facility_id
  where p.model = '\''RACE-1'\'' and f.name = '\''Race site'\'';
select pg_sleep(1);   -- hold the transaction open so the two really overlap
commit;'

# --- start both "technicians" at the same time
out_a=$(mktemp); out_b=$(mktemp)
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "$deploy_six" >"$out_a" 2>&1 & pid_a=$!
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "$deploy_six" >"$out_b" 2>&1 & pid_b=$!
ok=0
wait $pid_a && ok=$((ok + 1)) || true
wait $pid_b && ok=$((ok + 1)) || true

office=$(q "select quantity from stock_levels s join products p on p.id = s.product_id
            where p.model = 'RACE-1' and s.location_id = office_location_id()")
site=$(q "select coalesce(sum(quantity), 0) from stock_levels s join products p on p.id = s.product_id
          join locations l on l.id = s.location_id join facilities f on f.id = l.facility_id
          where p.model = 'RACE-1' and f.name = 'Race site'")

echo "successful deployments: $ok (expected 1)"
echo "office stock:           $office (expected 4)"
echo "site stock:             $site (expected 6)"
grep -h "ERROR" "$out_a" "$out_b" | sed 's/^/rejected with: /' || true
rm -f "$out_a" "$out_b"

if [[ "$ok" == 1 && "$office" == 4 && "$site" == 6 ]]; then
  echo "Result: PASS"
else
  echo "Result: FAIL"; exit 1
fi
