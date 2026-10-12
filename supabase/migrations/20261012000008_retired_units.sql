-- Migration 0008 — retired units stay retired
--
-- A write-off keeps the unit's last location (units.location_id is required), so without this rule
-- a retired unit still looks like it is "in MRD Office" and could be deployed or shipped again.
-- Only a Super Admin correction (Stage 5) may bring a retired unit back.
--
-- Trigger order matters: PostgreSQL runs BEFORE triggers in name order, and this check must see the
-- unit before stock_movements_apply changes it — hence the "0_" in the name.

create function check_unit_not_retired() returns trigger
language plpgsql as $$
begin
  if new.unit_id is not null and new.movement_type <> 'correction'
     and (select status from units where id = new.unit_id) = 'retired' then
    raise exception 'Unit % is retired and cannot be moved', new.unit_id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger stock_movements_0_not_retired before insert on stock_movements
  for each row execute function check_unit_not_retired();
