-- Migration 0001 — foundation, product catalogue and receiving
-- Design reference: docs/DATABASE.md §L0, §L2, §L5 (users)
--
-- Every table has row level security (RLS) switched on with no policies. That means the public
-- Supabase API (used by browsers) can read or write nothing. Only our server, which connects with
-- the secret service key, can reach the data — see docs/ARCHITECTURE.md §10.

-- ---------------------------------------------------------------------------------------------
-- Fixed lists of allowed values (enums). A typo like 'deplyed' is rejected by the database.
-- ---------------------------------------------------------------------------------------------
create type user_role     as enum ('super_admin', 'admin', 'editor', 'viewer');
create type user_status   as enum ('pending', 'approved', 'rejected', 'disabled');
create type tracking_type as enum ('serialised', 'quantity', 'hybrid');
create type unit_status   as enum (
  'in_office', 'configured', 'deployed', 'shipped_to_partner', 'deployed_abroad',
  'in_repair', 'returned_to_supplier', 'retired'
);

-- Keeps updated_at correct without relying on application code.
create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Countries
-- ---------------------------------------------------------------------------------------------
create table countries (
  id        bigint generated always as identity primary key,
  name      text not null unique,
  iso_code  char(2) not null unique check (iso_code ~ '^[A-Z]{2}$')
);

insert into countries (name, iso_code) values
  ('Oman', 'OM'), ('Qatar', 'QA'), ('Saudi Arabia', 'SA'), ('United Arab Emirates', 'AE'),
  ('Kuwait', 'KW'), ('Bahrain', 'BH');

-- ---------------------------------------------------------------------------------------------
-- Users — one row per person, linked one-to-one to their Supabase Auth login
-- ---------------------------------------------------------------------------------------------
create table users (
  id             uuid primary key references auth.users (id) on delete restrict,
  email          text not null unique,
  full_name      text not null check (length(trim(full_name)) > 0),
  role           user_role,
  status         user_status not null default 'pending',
  approved_by    uuid references users (id) on delete restrict,
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz,
  -- an approved user must have a role; a pending user must not have one yet
  constraint users_role_matches_status check (
    (status = 'approved' and role is not null)
    or (status = 'pending' and role is null)
    or status in ('rejected', 'disabled')
  )
);

-- ---------------------------------------------------------------------------------------------
-- Catalogue: categories, suppliers, products
-- ---------------------------------------------------------------------------------------------
create table categories (
  id         bigint generated always as identity primary key,
  name       text not null unique,
  is_active  boolean not null default true
);

create table suppliers (
  id           bigint generated always as identity primary key,
  name         text not null unique,
  code_prefix  text not null unique check (code_prefix ~ '^[A-Z]{2,5}$'),
  country_id   bigint references countries (id) on delete restrict,
  email        text,
  phone        text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger suppliers_updated_at before update on suppliers
  for each row execute function set_updated_at();

create table products (
  id                      bigint generated always as identity primary key,
  name                    text not null,
  brand                   text not null,
  model                   text not null,
  category_id             bigint not null references categories (id) on delete restrict,
  tracking_type           tracking_type not null,
  requires_configuration  boolean not null default false,
  min_stock_level         integer not null default 0 check (min_stock_level >= 0),
  description             text,
  specifications          jsonb,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (brand, model)
);
create trigger products_updated_at before update on products
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Receiving: batches (one delivery) and batch_lines (what it contained)
-- ---------------------------------------------------------------------------------------------
create table batches (
  id              bigint generated always as identity primary key,
  code            text not null unique,
  supplier_id     bigint not null references suppliers (id) on delete restrict,
  purchase_order  text,
  invoice_number  text,
  received_on     date not null check (received_on <= current_date),
  received_by     uuid not null references users (id) on delete restrict,
  notes           text,
  created_at      timestamptz not null default now()
);

create table batch_lines (
  id                 bigint generated always as identity primary key,
  batch_id           bigint not null references batches (id) on delete restrict,
  product_id         bigint not null references products (id) on delete restrict,
  quantity_received  integer not null check (quantity_received > 0),
  unique (batch_id, product_id),
  -- lets units point at (line, product) together, so a unit's product must match its line
  unique (id, product_id)
);

-- ---------------------------------------------------------------------------------------------
-- Units — one physical serialised item. location_id is added in migration 0002 with locations.
-- ---------------------------------------------------------------------------------------------
create table units (
  id             bigint generated always as identity primary key,
  product_id     bigint not null references products (id) on delete restrict,
  batch_line_id  bigint not null,
  serial_number  text not null check (length(trim(serial_number)) > 0),
  imei           text unique,
  status         unit_status not null default 'in_office',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (product_id, serial_number),
  foreign key (batch_line_id, product_id)
    references batch_lines (id, product_id) on delete restrict
);
create trigger units_updated_at before update on units
  for each row execute function set_updated_at();

-- Rule: only serialised or hybrid products get units, and never more units than were received.
create function check_unit_rules() returns trigger
language plpgsql as $$
declare
  v_tracking  tracking_type;
  v_received  integer;
  v_existing  integer;
begin
  select tracking_type into v_tracking from products where id = new.product_id;
  if v_tracking = 'quantity' then
    raise exception 'Product % is counted by quantity and cannot have serialised units', new.product_id
      using errcode = 'check_violation';
  end if;

  -- lock the batch line so two people adding units at once are counted correctly
  select quantity_received into v_received from batch_lines where id = new.batch_line_id for update;
  select count(*) into v_existing from units
    where batch_line_id = new.batch_line_id and id <> coalesce(new.id, -1);
  if v_existing + 1 > v_received then
    raise exception 'Batch line % received % items; cannot add another unit', new.batch_line_id, v_received
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger units_rules before insert or update of batch_line_id, product_id on units
  for each row execute function check_unit_rules();

-- SIM-only details, one-to-one with a unit (docs/DATABASE.md §L1)
create table sim_details (
  unit_id       bigint primary key references units (id) on delete restrict,
  iccid         text not null unique check (iccid ~ '^[0-9]{18,22}$'),
  phone_number  text unique,
  carrier       text
);

-- ---------------------------------------------------------------------------------------------
-- Lock the public API out of every table (server-only access)
-- ---------------------------------------------------------------------------------------------
alter table countries   enable row level security;
alter table users       enable row level security;
alter table categories  enable row level security;
alter table suppliers   enable row level security;
alter table products    enable row level security;
alter table batches     enable row level security;
alter table batch_lines enable row level security;
alter table units       enable row level security;
alter table sim_details enable row level security;
