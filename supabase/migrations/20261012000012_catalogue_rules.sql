-- Migration 0012 — catalogue safety rules (Stage 5.9)
--
--   * A product's kind (tracking type, needs configuration, is a SIM) is fixed once it has been
--     received: changing it would make existing counts and units meaningless.
--   * A facility's country is fixed once stock has moved there (Oman vs abroad decides the routes).
--   * A facility or partner cannot be archived while stock is still there.

create function check_product_kind_change() returns trigger
language plpgsql as $$
begin
  if (new.tracking_type, new.requires_configuration, new.is_sim)
       is distinct from (old.tracking_type, old.requires_configuration, old.is_sim)
     and exists (select 1 from batch_lines where product_id = new.id) then
    raise exception 'Product % has already been received; its kind (tracking, configuration, SIM) cannot change — create a new product instead', new.name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger products_kind_locked before update on products
  for each row execute function check_product_kind_change();

-- true when any stock is at the location now
create function location_has_stock(p_location bigint) returns boolean
language sql stable as $$
  select exists (select 1 from units where location_id = p_location and status <> 'retired')
      or exists (select 1 from stock_levels where location_id = p_location and quantity > 0)
$$;

create function check_place_change() returns trigger
language plpgsql as $$
declare
  v_location bigint;
begin
  if tg_table_name = 'facilities' then
    select id into v_location from locations where facility_id = new.id;
    if new.country_id <> old.country_id
       and exists (select 1 from stock_movements where v_location in (from_location_id, to_location_id)) then
      raise exception 'Items have already moved to facility %; its country cannot change', new.name
        using errcode = 'check_violation';
    end if;
  else
    select id into v_location from locations where partner_id = new.id;
  end if;
  if old.is_active and not new.is_active and location_has_stock(v_location) then
    raise exception '% still holds stock; move or write it off before archiving', new.name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger facilities_change_rules before update on facilities
  for each row execute function check_place_change();
create trigger partners_change_rules before update on partners
  for each row execute function check_place_change();
