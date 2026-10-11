-- Migration 0003 — stock movements (the ledger) and stock levels (the balance)
-- Design reference: docs/DATABASE.md §L3
--
-- How it works: the application only ever INSERTS a row into stock_movements. A trigger then
-- applies that movement in the same transaction:
--   * counted items  -> subtract from the source balance, add to the destination balance
--   * serialised unit -> check the unit really is at the source, then move it and set its status
-- If any rule fails, the whole insert is undone — nothing is half-saved.

create type movement_type as enum (
  'receive', 'serialise', 'deploy', 'ship', 'deploy_abroad', 'return',
  'send_repair', 'back_from_repair', 'return_to_supplier', 'write_off', 'correction'
);

create table stock_levels (
  location_id  bigint not null references locations (id) on delete restrict,
  product_id   bigint not null references products (id) on delete restrict,
  quantity     integer not null check (quantity >= 0),   -- the "no negative stock" guarantee
  primary key (location_id, product_id)
);

create table stock_movements (
  id                bigint generated always as identity primary key,
  movement_type     movement_type not null,
  product_id        bigint not null references products (id) on delete restrict,
  unit_id           bigint references units (id) on delete restrict,
  quantity          integer not null check (quantity > 0),
  from_location_id  bigint references locations (id) on delete restrict,
  to_location_id    bigint references locations (id) on delete restrict,
  batch_id          bigint references batches (id) on delete restrict,
  performed_by      uuid not null references users (id) on delete restrict,
  moved_at          timestamptz not null default now(),
  note              text,
  check (unit_id is null or quantity = 1),
  check (from_location_id is not null or movement_type in ('receive', 'correction')),
  check (to_location_id   is not null or movement_type in ('write_off', 'correction', 'serialise')),
  check (from_location_id is distinct from to_location_id),
  check (from_location_id is not null or to_location_id is not null)
);
create index stock_movements_unit_idx    on stock_movements (unit_id);
create index stock_movements_product_idx on stock_movements (product_id, moved_at);

-- Which kinds of place a movement may go from and to (docs/DATABASE.md §L3, F9, F10, Q3).
create function check_movement_route(
  p_type movement_type, p_from location_type, p_to location_type,
  p_from_abroad boolean, p_to_abroad boolean
) returns boolean
language sql immutable as $$
  select case p_type
    when 'receive'            then p_from is null and p_to = 'office'
    when 'serialise'          then p_from = 'office' and p_to is null
    when 'deploy'             then p_from = 'office' and p_to = 'facility' and not p_to_abroad
    when 'ship'               then p_from = 'office' and p_to = 'partner_stock'
    when 'deploy_abroad'      then p_from = 'partner_stock' and p_to = 'facility' and p_to_abroad
    when 'return'             then p_from = 'facility' and not p_from_abroad and p_to = 'office'
    when 'send_repair'        then p_from in ('office', 'facility') and not p_from_abroad
                                   and p_to in ('supplier', 'repair_company')
    when 'back_from_repair'   then p_from in ('supplier', 'repair_company') and p_to = 'office'
    when 'return_to_supplier' then p_from in ('office', 'repair_company') and p_to = 'supplier'
    when 'write_off'          then p_from is not null and p_to is null
    when 'correction'         then true   -- Super Admin only; checked by the server (Stage 5)
  end
$$;

create function apply_stock_movement() returns trigger
language plpgsql as $$
declare
  v_tracking     tracking_type;
  v_from_type    location_type;
  v_to_type      location_type;
  v_from_abroad  boolean := false;
  v_to_abroad    boolean := false;
  v_unit         units%rowtype;
begin
  select tracking_type into v_tracking from products where id = new.product_id;

  select l.type, coalesce(c.iso_code <> 'OM', false) into v_from_type, v_from_abroad
    from locations l left join facilities f on f.id = l.facility_id
    left join countries c on c.id = f.country_id where l.id = new.from_location_id;
  select l.type, coalesce(c.iso_code <> 'OM', false) into v_to_type, v_to_abroad
    from locations l left join facilities f on f.id = l.facility_id
    left join countries c on c.id = f.country_id where l.id = new.to_location_id;

  -- coalesce: a comparison with an empty value gives NULL ("unknown"), which must count as "not allowed"
  if not coalesce(check_movement_route(new.movement_type, v_from_type, v_to_type, v_from_abroad, v_to_abroad), false) then
    raise exception 'A % movement cannot go from % to %', new.movement_type,
      coalesce(v_from_type::text, 'nowhere'), coalesce(v_to_type::text, 'nowhere')
      using errcode = 'check_violation';
  end if;

  -- ---------- counted stock ----------
  if new.unit_id is null or new.movement_type = 'serialise' then
    if v_tracking = 'serialised' then
      raise exception 'Serialised products must be moved unit by unit' using errcode = 'check_violation';
    end if;
    if new.from_location_id is not null then
      -- subtract first. If there isn't enough, the CHECK (quantity >= 0) fails and everything is undone.
      -- (A plain UPDATE, not an "upsert": an upsert checks its would-be new row of -6 and fails
      -- even when stock exists — the tests caught this.)
      update stock_levels set quantity = quantity - new.quantity
        where location_id = new.from_location_id and product_id = new.product_id;
      if not found then
        raise exception 'There is no stock of product % at that location', new.product_id
          using errcode = 'check_violation';
      end if;
    end if;
    if new.to_location_id is not null then
      insert into stock_levels (location_id, product_id, quantity)
        values (new.to_location_id, new.product_id, new.quantity)
        on conflict (location_id, product_id)
        do update set quantity = stock_levels.quantity + new.quantity;
    end if;
  end if;

  -- ---------- serialised unit ----------
  if new.unit_id is not null then
    -- lock the unit so two people can't move it at the same moment
    select * into v_unit from units where id = new.unit_id for update;
    if v_unit.product_id <> new.product_id then
      raise exception 'Unit % is not a % product', new.unit_id, new.product_id using errcode = 'check_violation';
    end if;
    if new.movement_type in ('receive', 'serialise') then
      null;  -- the unit was just created in MRD Office
    elsif v_unit.location_id is distinct from new.from_location_id then
      raise exception 'Unit % is not at the location it is being moved from', new.unit_id
        using errcode = 'check_violation';
    else
      update units set
        location_id = coalesce(new.to_location_id, location_id),
        status = case new.movement_type
          when 'deploy'             then 'deployed'
          when 'ship'               then 'shipped_to_partner'
          when 'deploy_abroad'      then 'deployed_abroad'
          when 'return'             then 'in_office'
          when 'back_from_repair'   then 'in_office'
          when 'send_repair'        then 'in_repair'
          when 'return_to_supplier' then 'returned_to_supplier'
          when 'write_off'          then 'retired'
          else status
        end::unit_status
      where id = new.unit_id;
    end if;
  end if;

  return new;
end;
$$;
create trigger stock_movements_apply before insert on stock_movements
  for each row execute function apply_stock_movement();

-- The ledger is insert-only: history can never be edited or deleted, by anyone.
create function forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% is insert-only; record a correction instead', tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;
create trigger stock_movements_insert_only before update or delete on stock_movements
  for each row execute function forbid_change();
create trigger facility_stage_history_insert_only before update or delete on facility_stage_history
  for each row execute function forbid_change();

alter table stock_levels    enable row level security;
alter table stock_movements enable row level security;
