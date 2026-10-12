-- Migration 0010 — routers can be configured at a partner abroad (owner decision A8, 2026-10-12)
--
-- Routers may be shipped unconfigured with loose SIMs (R10); the partner configures them in their
-- country and MRD records which SIM (and IP) went into which router, exactly as in the office.
-- Replaces check_sim_assignment from 0007. Allowed places for a new assignment:
--   * MRD Office: router in_office/configured, SIM in_office  -> both become 'configured'
--   * the same partner's stock: both shipped_to_partner        -> status unchanged (location says where)

create or replace function check_sim_assignment() returns trigger
language plpgsql as $$
declare
  v_router  units%rowtype;
  v_sim     units%rowtype;
  v_office  boolean;
  v_partner boolean;
begin
  select * into v_router from units where id = new.router_unit_id;
  select * into v_sim    from units where id = new.sim_unit_id;
  if not (select requires_configuration from products where id = v_router.product_id) then
    raise exception 'Unit % is not a configurable router', new.router_unit_id using errcode = 'check_violation';
  end if;
  if tg_op <> 'INSERT' then
    return new;
  end if;

  if v_router.location_id is distinct from v_sim.location_id then
    raise exception 'Router % and SIM % are not in the same place', v_router.serial_number, v_sim.serial_number
      using errcode = 'check_violation';
  end if;
  v_office  := v_router.location_id = office_location_id();
  v_partner := (select type = 'partner_stock' from locations where id = v_router.location_id);

  if v_office then
    if v_router.status not in ('in_office', 'configured') then
      raise exception 'Router % is % and cannot be configured', v_router.serial_number, v_router.status
        using errcode = 'check_violation';
    end if;
    if v_sim.status <> 'in_office' then
      raise exception 'SIM % is % and cannot be put into a router', v_sim.serial_number, v_sim.status
        using errcode = 'check_violation';
    end if;
    update units set status = 'configured' where id in (new.router_unit_id, new.sim_unit_id);
  elsif v_partner then
    if v_router.status <> 'shipped_to_partner' or v_sim.status <> 'shipped_to_partner' then
      raise exception 'Router % and SIM % must both be in the partner''s stock', v_router.serial_number, v_sim.serial_number
        using errcode = 'check_violation';
    end if;
  else
    raise exception 'Routers are configured in MRD Office or at a partner, not at a facility'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
