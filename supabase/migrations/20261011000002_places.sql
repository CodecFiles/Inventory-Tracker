-- Migration 0002 — places: clients, facilities, partners, repair companies, contacts, locations
-- Design reference: docs/DATABASE.md §L3 (locations), §L4

create type facility_stage as enum (
  'site_inspection', 'bms_scan', 'poc', 'poc_study', 'contract', 'deployment',
  'active_operations', 'closed'
);
create type location_type as enum ('office', 'facility', 'partner_stock', 'repair_company', 'supplier');

-- ---------------------------------------------------------------------------------------------
-- Organisations
-- ---------------------------------------------------------------------------------------------
create table clients (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table partners (
  id          bigint generated always as identity primary key,
  name        text not null,
  country_id  bigint not null references countries (id) on delete restrict,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (name, country_id)
);

create table repair_companies (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  country_id  bigint references countries (id) on delete restrict,
  email       text,
  phone       text,
  is_active   boolean not null default true
);

create table facilities (
  id             bigint generated always as identity primary key,
  name           text not null,
  client_id      bigint not null references clients (id) on delete restrict,
  facility_type  text,
  country_id     bigint not null references countries (id) on delete restrict,
  city           text,
  address        text,
  partner_id     bigint references partners (id) on delete restrict,
  stage          facility_stage not null default 'site_inspection',
  project_lead   uuid references users (id) on delete restrict,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (client_id, name)
);
create trigger facilities_updated_at before update on facilities
  for each row execute function set_updated_at();

-- MRD is based in Oman: a facility anywhere else must be handled through a partner in that
-- country (decision A6). A CHECK can't look at another table, so this is a trigger.
create function check_facility_partner() returns trigger
language plpgsql as $$
declare
  v_iso          char(2);
  v_partner_ctry bigint;
begin
  select iso_code into v_iso from countries where id = new.country_id;
  if v_iso <> 'OM' and new.partner_id is null then
    raise exception 'A facility outside Oman must have a partner' using errcode = 'check_violation';
  end if;
  if new.partner_id is not null then
    select country_id into v_partner_ctry from partners where id = new.partner_id;
    if v_partner_ctry <> new.country_id then
      raise exception 'The partner must be in the same country as the facility' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
create trigger facilities_partner_rule before insert or update of country_id, partner_id on facilities
  for each row execute function check_facility_partner();

-- Every stage change is remembered (insert-only history).
create table facility_stage_history (
  id           bigint generated always as identity primary key,
  facility_id  bigint not null references facilities (id) on delete restrict,
  from_stage   facility_stage,
  to_stage     facility_stage not null,
  changed_by   uuid references users (id) on delete restrict,
  changed_at   timestamptz not null default now(),
  note         text
);

create function record_stage_change() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    insert into facility_stage_history (facility_id, from_stage, to_stage, changed_by)
    values (new.id, case when tg_op = 'UPDATE' then old.stage end, new.stage,
            nullif(current_setting('app.user_id', true), '')::uuid);
  end if;
  return new;
end;
$$;
create trigger facilities_stage_history after insert or update of stage on facilities
  for each row execute function record_stage_change();

-- ---------------------------------------------------------------------------------------------
-- Contacts (a facility or partner can have many; at most one primary)
-- ---------------------------------------------------------------------------------------------
create table facility_contacts (
  id           bigint generated always as identity primary key,
  facility_id  bigint not null references facilities (id) on delete restrict,
  name         text not null,
  role         text,
  email        text,
  phone        text,
  is_primary   boolean not null default false
);
create unique index facility_contacts_one_primary on facility_contacts (facility_id) where is_primary;

create table partner_contacts (
  id          bigint generated always as identity primary key,
  partner_id  bigint not null references partners (id) on delete restrict,
  name        text not null,
  role        text,
  email       text,
  phone       text,
  is_primary  boolean not null default false
);
create unique index partner_contacts_one_primary on partner_contacts (partner_id) where is_primary;

-- ---------------------------------------------------------------------------------------------
-- Locations — every place stock can be. Exactly one reference column matches the type.
-- ---------------------------------------------------------------------------------------------
create table locations (
  id                 bigint generated always as identity primary key,
  type               location_type not null,
  name               text not null,
  facility_id        bigint unique references facilities (id) on delete restrict,
  partner_id         bigint unique references partners (id) on delete restrict,
  supplier_id        bigint unique references suppliers (id) on delete restrict,
  repair_company_id  bigint unique references repair_companies (id) on delete restrict,
  check (
    (type = 'office'         and num_nonnulls(facility_id, partner_id, supplier_id, repair_company_id) = 0) or
    (type = 'facility'       and facility_id       is not null and num_nonnulls(partner_id, supplier_id, repair_company_id) = 0) or
    (type = 'partner_stock'  and partner_id        is not null and num_nonnulls(facility_id, supplier_id, repair_company_id) = 0) or
    (type = 'supplier'       and supplier_id       is not null and num_nonnulls(facility_id, partner_id, repair_company_id) = 0) or
    (type = 'repair_company' and repair_company_id is not null and num_nonnulls(facility_id, partner_id, supplier_id) = 0)
  )
);
-- only one office (F1)
create unique index locations_single_office on locations (type) where type = 'office';

insert into locations (type, name) values ('office', 'MRD Office');

-- A location is created automatically for every facility, partner, supplier and repair company.
create function create_location_for_place() returns trigger
language plpgsql as $$
begin
  case tg_table_name
    when 'facilities'       then insert into locations (type, name, facility_id)       values ('facility', new.name, new.id);
    when 'partners'         then insert into locations (type, name, partner_id)        values ('partner_stock', new.name || ' stock', new.id);
    when 'suppliers'        then insert into locations (type, name, supplier_id)       values ('supplier', new.name, new.id);
    when 'repair_companies' then insert into locations (type, name, repair_company_id) values ('repair_company', new.name, new.id);
  end case;
  return new;
end;
$$;
create trigger facilities_location       after insert on facilities       for each row execute function create_location_for_place();
create trigger partners_location         after insert on partners         for each row execute function create_location_for_place();
create trigger suppliers_location        after insert on suppliers        for each row execute function create_location_for_place();
create trigger repair_companies_location after insert on repair_companies for each row execute function create_location_for_place();

-- suppliers created before this migration get their location now
insert into locations (type, name, supplier_id) select 'supplier', name, id from suppliers;

-- ---------------------------------------------------------------------------------------------
-- Units now know where they are. New units start in MRD Office.
-- ---------------------------------------------------------------------------------------------
create function office_location_id() returns bigint
language sql stable as $$ select id from locations where type = 'office' $$;

alter table units add column location_id bigint references locations (id) on delete restrict;
update units set location_id = office_location_id();
alter table units alter column location_id set default office_location_id();
alter table units alter column location_id set not null;

-- ---------------------------------------------------------------------------------------------
-- Server-only access
-- ---------------------------------------------------------------------------------------------
alter table clients                enable row level security;
alter table partners               enable row level security;
alter table repair_companies       enable row level security;
alter table facilities             enable row level security;
alter table facility_stage_history enable row level security;
alter table facility_contacts      enable row level security;
alter table partner_contacts       enable row level security;
alter table locations              enable row level security;
