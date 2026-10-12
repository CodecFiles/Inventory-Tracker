-- Migration 0013 — readable notes when a SIM travels inside its router
--
-- complete_deployment and ship_shipment (0004) wrote "SIM inside router 17" — the router's internal
-- id. People search and read serial numbers, so the note now names the router's serial number.
-- Only the two note texts change; everything else is copied unchanged from 0004.

create or replace function complete_deployment(p_deployment_id bigint, p_user uuid, p_date date default current_date)
returns void
language plpgsql as $$
declare
  d          deployments%rowtype;
  f          facilities%rowtype;
  v_abroad   boolean;
  v_from     bigint;
  v_to       bigint;
  v_type     movement_type;
  item       deployment_items%rowtype;
  v_sim      bigint;
begin
  select * into d from deployments where id = p_deployment_id for update;
  if d.status not in ('draft', 'scheduled') then
    raise exception 'Deployment % is already %', d.code, d.status using errcode = 'check_violation';
  end if;
  if not exists (select 1 from deployment_items where deployment_id = d.id and removed_at is null) then
    raise exception 'Deployment % has no items', d.code using errcode = 'check_violation';
  end if;

  select * into f from facilities where id = d.facility_id;
  v_abroad := (select iso_code from countries where id = f.country_id) <> 'OM';
  select id into v_to from locations where facility_id = f.id;
  if v_abroad then
    select id into v_from from locations where partner_id = f.partner_id;
    v_type := 'deploy_abroad';
  else
    v_from := office_location_id();
    v_type := 'deploy';
  end if;

  for item in select * from deployment_items where deployment_id = d.id and removed_at is null order by id loop
    insert into stock_movements (movement_type, product_id, unit_id, quantity, from_location_id,
                                 to_location_id, deployment_id, performed_by)
      values (v_type, item.product_id, item.unit_id, item.quantity, v_from, v_to, d.id, p_user);

    -- the router's SIM travels with it
    if item.unit_id is not null then
      select sim_unit_id into v_sim from sim_assignments where router_unit_id = item.unit_id and ended_at is null;
      if v_sim is not null then
        insert into stock_movements (movement_type, product_id, unit_id, quantity, from_location_id,
                                     to_location_id, deployment_id, performed_by, note)
          select v_type, product_id, id, 1, v_from, v_to, d.id, p_user, 'SIM inside router ' || (select serial_number from units where id = item.unit_id)
          from units where id = v_sim;
      end if;
    end if;
  end loop;

  update deployments
    set status = 'completed', completed_by = p_user, completed_at = now(),
        deployment_date = coalesce(p_date, current_date)
    where id = d.id;
end;
$$;

-- Shipping: everything on the shipment moves from MRD Office to the partner's stock
create or replace function ship_shipment(p_shipment_id bigint, p_user uuid, p_date date default current_date)
returns void
language plpgsql as $$
declare
  s      shipments%rowtype;
  v_to   bigint;
  item   shipment_items%rowtype;
  v_sim  bigint;
begin
  select * into s from shipments where id = p_shipment_id for update;
  if s.status <> 'draft' then
    raise exception 'Shipment % is already %', s.code, s.status using errcode = 'check_violation';
  end if;
  if not exists (select 1 from shipment_items where shipment_id = s.id and removed_at is null) then
    raise exception 'Shipment % has no items', s.code using errcode = 'check_violation';
  end if;
  select id into v_to from locations where partner_id = s.partner_id;

  for item in select * from shipment_items where shipment_id = s.id and removed_at is null order by id loop
    insert into stock_movements (movement_type, product_id, unit_id, quantity, from_location_id,
                                 to_location_id, shipment_id, performed_by)
      values ('ship', item.product_id, item.unit_id, item.quantity, office_location_id(), v_to, s.id, p_user);
    if item.unit_id is not null then
      select sim_unit_id into v_sim from sim_assignments where router_unit_id = item.unit_id and ended_at is null;
      if v_sim is not null then
        insert into stock_movements (movement_type, product_id, unit_id, quantity, from_location_id,
                                     to_location_id, shipment_id, performed_by, note)
          select 'ship', product_id, id, 1, office_location_id(), v_to, s.id, p_user, 'SIM inside router ' || (select serial_number from units where id = item.unit_id)
          from units where id = v_sim;
      end if;
    end if;
  end loop;

  update shipments set status = 'shipped', shipped_by = p_user, shipped_on = coalesce(p_date, current_date)
    where id = s.id;
end;
$$;
