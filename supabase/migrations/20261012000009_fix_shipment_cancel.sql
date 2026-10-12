-- Migration 0009 — fix: cancelling a shipment failed
--
-- release_cancelled_items (0004) is shared by deployments and shipments and compared the status with
-- 'scheduled'. Shipments have no 'scheduled' status, so PostgreSQL rejected the comparison
-- ("invalid input value for enum shipment_status") and no shipment could be cancelled.
-- Found by the backend tests in Stage 5.6. Comparing as text works for both tables.

create or replace function release_cancelled_items() returns trigger
language plpgsql as $$
begin
  if new.status::text = 'cancelled' and old.status::text <> 'cancelled' then
    if old.status::text not in ('draft', 'scheduled') then
      raise exception 'Only a draft or scheduled document can be cancelled' using errcode = 'check_violation';
    end if;
    if tg_table_name = 'deployments' then
      update deployment_items set removed_at = now() where deployment_id = new.id and removed_at is null;
    else
      update shipment_items set removed_at = now() where shipment_id = new.id and removed_at is null;
    end if;
  end if;
  return new;
end;
$$;
