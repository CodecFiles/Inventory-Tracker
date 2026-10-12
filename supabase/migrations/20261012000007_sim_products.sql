-- Migration 0007 — SIM products and preparation rules
-- Design reference: docs/DATABASE.md §L1, §L7 (owner decisions R7, R8, 2026-10-12)
--
-- A product is marked once in the catalogue as "is a SIM card" (e.g. "Omantel Data SIM"). Each SIM
-- received for that product becomes a unit whose serial number is its ICCID; its SIM details are
-- saved in sim_details. The flag is what lets the app show an ICCID column when receiving and a
-- SIM dropdown when configuring a router.

alter table products add column is_sim boolean not null default false;

-- SIMs are tracked one by one, and a SIM itself is never "configured" like a router.
alter table products add constraint products_sim_rules
  check (not is_sim or (tracking_type = 'serialised' and not requires_configuration));

-- SIM details may only belong to a unit of a SIM product.
create function check_sim_details_unit() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from units u join products p on p.id = u.product_id
                 where u.id = new.unit_id and p.is_sim) then
    raise exception 'Unit % is not a SIM card', new.unit_id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger sim_details_rules before insert or update on sim_details
  for each row execute function check_sim_details_unit();

-- Putting a SIM into a router (replaces the 0004 version). New compared to 0004:
--   * the SIM must be free in the office (status in_office) — a retired, configured or deployed SIM is refused
--   * the router must be in the office and not retired/in repair (in_office, or configured when its SIM is swapped)
create or replace function check_sim_assignment() returns trigger
language plpgsql as $$
declare
  v_router units%rowtype;
  v_sim    units%rowtype;
begin
  select * into v_router from units where id = new.router_unit_id;
  select * into v_sim    from units where id = new.sim_unit_id;
  if not (select requires_configuration from products where id = v_router.product_id) then
    raise exception 'Unit % is not a configurable router', new.router_unit_id using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    if v_router.location_id <> office_location_id() or v_sim.location_id <> office_location_id() then
      raise exception 'Routers are configured in MRD Office; both router and SIM must be there'
        using errcode = 'check_violation';
    end if;
    if v_router.status not in ('in_office', 'configured') then
      raise exception 'Router % is % and cannot be configured', v_router.serial_number, v_router.status
        using errcode = 'check_violation';
    end if;
    if v_sim.status <> 'in_office' then
      raise exception 'SIM % is % and cannot be put into a router', v_sim.serial_number, v_sim.status
        using errcode = 'check_violation';
    end if;
    update units set status = 'configured' where id in (new.router_unit_id, new.sim_unit_id);
  end if;
  return new;
end;
$$;
