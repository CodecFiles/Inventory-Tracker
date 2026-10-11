-- Migration 0004 — document codes, deployments, shipments, SIM assignments
-- Design reference: docs/DATABASE.md §L1, §L4
--
-- Deployments and shipments are "documents": they can be drafted and scheduled freely, and stock
-- only moves when one is completed/shipped. Completion is a single database function so every
-- item moves in ONE transaction — all items or none. The server checks permissions before calling it.

-- ---------------------------------------------------------------------------------------------
-- Automatic document codes: TEL-2026-001, DEP-2026-031, SHP-2026-002 …
-- The counter row is locked while a number is taken, so two people never get the same code.
-- ---------------------------------------------------------------------------------------------
create table document_counters (
  prefix       text    not null,
  year         integer not null,
  last_number  integer not null default 0 check (last_number >= 0),
  primary key (prefix, year)
);

create function next_document_code(p_prefix text) returns text
language plpgsql as $$
declare
  v_year   integer := extract(year from current_date);
  v_number integer;
begin
  insert into document_counters (prefix, year, last_number) values (p_prefix, v_year, 1)
    on conflict (prefix, year) do update set last_number = document_counters.last_number + 1
    returning last_number into v_number;
  return p_prefix || '-' || v_year || '-' || lpad(v_number::text, 3, '0');
end;
$$;

-- Batch codes come from the supplier's prefix unless one is typed in (Q1: manual entry later).
create function set_batch_code() returns trigger
language plpgsql as $$
begin
  if new.code is null then
    new.code := next_document_code((select code_prefix from suppliers where id = new.supplier_id));
  end if;
  return new;
end;
$$;
create trigger batches_code before insert on batches for each row execute function set_batch_code();

-- lets other tables point at (unit, product) together, so a line's product must match its unit
alter table units add constraint units_id_product_key unique (id, product_id);

-- ---------------------------------------------------------------------------------------------
-- Deployments
-- ---------------------------------------------------------------------------------------------
create type deployment_type   as enum ('poc', 'contract');
create type deployment_status as enum ('draft', 'scheduled', 'completed', 'cancelled');
create type shipment_status   as enum ('draft', 'shipped', 'received_by_partner', 'cancelled');

create table deployments (
  id                bigint generated always as identity primary key,
  code              text not null unique default next_document_code('DEP'),
  facility_id       bigint not null references facilities (id) on delete restrict,
  deployment_type   deployment_type not null,
  status            deployment_status not null default 'draft',
  deployment_date   date,
  created_by        uuid not null references users (id) on delete restrict,
  completed_by      uuid references users (id) on delete restrict,
  completed_at      timestamptz,
  notes             text,
  created_at        timestamptz not null default now(),
  check (status <> 'completed' or (deployment_date is not null and completed_by is not null))
);

create table deployment_items (
  id             bigint generated always as identity primary key,
  deployment_id  bigint not null references deployments (id) on delete restrict,
  product_id     bigint not null references products (id) on delete restrict,
  unit_id        bigint,
  quantity       integer not null default 1 check (quantity > 0),
  building       text,
  position       text,
  removed_at     timestamptz,
  check (unit_id is null or quantity = 1),
  foreign key (unit_id, product_id) references units (id, product_id) on delete restrict
);
-- THE double-deployment rule: a unit can be on only one live deployment line at a time
create unique index deployment_items_one_live_unit on deployment_items (unit_id)
  where unit_id is not null and removed_at is null;

create table shipments (
  id               bigint generated always as identity primary key,
  code             text not null unique default next_document_code('SHP'),
  partner_id       bigint not null references partners (id) on delete restrict,
  status           shipment_status not null default 'draft',
  courier          text,
  tracking_number  text,
  shipped_on       date,
  created_by       uuid not null references users (id) on delete restrict,
  shipped_by       uuid references users (id) on delete restrict,
  notes            text,
  created_at       timestamptz not null default now(),
  check (status in ('draft', 'cancelled') or (shipped_on is not null and shipped_by is not null))
);

create table shipment_items (
  id           bigint generated always as identity primary key,
  shipment_id  bigint not null references shipments (id) on delete restrict,
  product_id   bigint not null references products (id) on delete restrict,
  unit_id      bigint,
  quantity     integer not null default 1 check (quantity > 0),
  removed_at   timestamptz,
  check (unit_id is null or quantity = 1),
  foreign key (unit_id, product_id) references units (id, product_id) on delete restrict
);
create unique index shipment_items_one_live_unit on shipment_items (unit_id)
  where unit_id is not null and removed_at is null;

-- Serialised products need a unit on the line; quantity products must not have one.
create function check_item_tracking() returns trigger
language plpgsql as $$
declare v_tracking tracking_type;
begin
  select tracking_type into v_tracking from products where id = new.product_id;
  if v_tracking = 'serialised' and new.unit_id is null then
    raise exception 'Choose the exact unit (serial number) for this product' using errcode = 'check_violation';
  elsif v_tracking = 'quantity' and new.unit_id is not null then
    raise exception 'This product is counted by quantity and has no units' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger deployment_items_tracking before insert or update on deployment_items
  for each row execute function check_item_tracking();
create trigger shipment_items_tracking before insert or update on shipment_items
  for each row execute function check_item_tracking();

-- Lines can only be changed while the document is still a draft or scheduled.
create function check_document_editable() returns trigger
language plpgsql as $$
declare v_status text;
begin
  if tg_table_name = 'deployment_items' then
    select status::text into v_status from deployments where id = coalesce(new.deployment_id, old.deployment_id);
  else
    select status::text into v_status from shipments where id = coalesce(new.shipment_id, old.shipment_id);
  end if;
  -- removed_at may still be set later (item returned); anything else needs an open document
  if v_status not in ('draft', 'scheduled')
     and not (tg_op = 'UPDATE' and new.removed_at is distinct from old.removed_at
              and (to_jsonb(new) - 'removed_at') = (to_jsonb(old) - 'removed_at')) then
    raise exception 'This document is % and its items can no longer be changed', v_status
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger deployment_items_editable before insert or update or delete on deployment_items
  for each row execute function check_document_editable();
create trigger shipment_items_editable before insert or update or delete on shipment_items
  for each row execute function check_document_editable();

-- Cancelling a document frees its units for other deployments/shipments.
create function release_cancelled_items() returns trigger
language plpgsql as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    if old.status not in ('draft', 'scheduled') then
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
create trigger deployments_cancel after update of status on deployments
  for each row execute function release_cancelled_items();
create trigger shipments_cancel after update of status on shipments
  for each row execute function release_cancelled_items();

-- ---------------------------------------------------------------------------------------------
-- Movements remember which document caused them
-- ---------------------------------------------------------------------------------------------
alter table stock_movements
  add column deployment_id bigint references deployments (id) on delete restrict,
  add column shipment_id   bigint references shipments (id) on delete restrict;

-- ---------------------------------------------------------------------------------------------
-- SIM assignments — which SIM is in which router, with which IP, from when to when
-- ---------------------------------------------------------------------------------------------
create table sim_assignments (
  id              bigint generated always as identity primary key,
  router_unit_id  bigint not null references units (id) on delete restrict,
  sim_unit_id     bigint not null references sim_details (unit_id) on delete restrict,
  ip_address      inet,
  assigned_at     timestamptz not null default now(),
  assigned_by     uuid not null references users (id) on delete restrict,
  ended_at        timestamptz,
  ended_by        uuid references users (id) on delete restrict,
  check (router_unit_id <> sim_unit_id),
  check (ended_at is null or ended_at >= assigned_at)
);
-- one SIM per router at a time (R1), a SIM in one router at a time, an IP used once at a time
create unique index sim_assignments_one_per_router on sim_assignments (router_unit_id) where ended_at is null;
create unique index sim_assignments_one_per_sim    on sim_assignments (sim_unit_id)    where ended_at is null;
create unique index sim_assignments_one_per_ip     on sim_assignments (ip_address)     where ended_at is null and ip_address is not null;

create function check_sim_assignment() returns trigger
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
  if tg_op = 'INSERT' and (v_router.location_id <> office_location_id() or v_sim.location_id <> office_location_id()) then
    raise exception 'Routers are configured in MRD Office; both router and SIM must be there'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    update units set status = 'configured' where id in (new.router_unit_id, new.sim_unit_id) and status = 'in_office';
  end if;
  return new;
end;
$$;
create trigger sim_assignments_rules before insert or update on sim_assignments
  for each row execute function check_sim_assignment();

-- ---------------------------------------------------------------------------------------------
-- When a unit leaves a facility (returned, sent for repair, written off), its live deployment
-- line is closed so the unit can be deployed again later.
-- ---------------------------------------------------------------------------------------------
create function close_deployment_line() returns trigger
language plpgsql as $$
begin
  if new.unit_id is not null and new.movement_type in ('return', 'send_repair', 'write_off') then
    update deployment_items set removed_at = new.moved_at
      where unit_id = new.unit_id and removed_at is null
        and deployment_id in (select id from deployments where status = 'completed');
  end if;
  return new;
end;
$$;
create trigger stock_movements_close_line after insert on stock_movements
  for each row execute function close_deployment_line();

-- ---------------------------------------------------------------------------------------------
-- Completing a deployment: every item moves in one transaction (all or nothing)
-- ---------------------------------------------------------------------------------------------
create function complete_deployment(p_deployment_id bigint, p_user uuid, p_date date default current_date)
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
          select v_type, product_id, id, 1, v_from, v_to, d.id, p_user, 'SIM inside router ' || item.unit_id
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
create function ship_shipment(p_shipment_id bigint, p_user uuid, p_date date default current_date)
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
          select 'ship', product_id, id, 1, office_location_id(), v_to, s.id, p_user, 'SIM inside router ' || item.unit_id
          from units where id = v_sim;
      end if;
    end if;
  end loop;

  update shipments set status = 'shipped', shipped_by = p_user, shipped_on = coalesce(p_date, current_date)
    where id = s.id;
end;
$$;

alter table document_counters enable row level security;
alter table deployments       enable row level security;
alter table deployment_items  enable row level security;
alter table shipments         enable row level security;
alter table shipment_items    enable row level security;
alter table sim_assignments   enable row level security;
