-- Integrity tests for migration 0001 (catalogue and receiving).
-- Each test tries something that must be allowed (lives_ok) or must be refused (throws_ok).
-- Everything runs inside a transaction and is rolled back, so tests leave no data behind.
begin;
create extension if not exists pgtap;

select plan(18);

-- ---------- sample data ----------
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000001');
insert into users (id, email, full_name, role, status)
  values ('00000000-0000-0000-0000-000000000001', 'chetan@moonrock.om', 'Test Admin', 'super_admin', 'approved');

insert into categories (name) values ('Routers'), ('Cables & Accessories'), ('Sensors');
insert into suppliers (name, code_prefix) values ('Teltonika Distributor', 'TEL');

insert into products (name, brand, model, category_id, tracking_type, requires_configuration)
  select 'TRB router', 'Teltonika', 'TRB140', id, 'serialised', true from categories where name = 'Routers';
insert into products (name, brand, model, category_id, tracking_type)
  select 'Cat6 patch cable 1 m', 'Generic', 'CAT6-1M', id, 'quantity' from categories where name = 'Cables & Accessories';
insert into products (name, brand, model, category_id, tracking_type)
  select 'CO2 sensor', 'Milesight', 'AM103', id, 'hybrid' from categories where name = 'Sensors';

insert into batches (code, supplier_id, received_on, received_by)
  select 'TEL-2026-001', id, current_date, '00000000-0000-0000-0000-000000000001' from suppliers;

-- the batch contained 2 routers, 50 cables, 1 sensor
insert into batch_lines (batch_id, product_id, quantity_received)
  select b.id, p.id, q.qty
  from batches b, products p
  join (values ('TRB140', 2), ('CAT6-1M', 50), ('AM103', 1)) as q(model, qty) on q.model = p.model;

-- helpers to keep the tests readable
create temp view t as
  select p.model, p.id as product_id, bl.id as line_id
  from products p join batch_lines bl on bl.product_id = p.id;

-- ---------- structure ----------
select has_table('units', 'units table exists');
select has_table('sim_details', 'sim_details table exists');

-- ---------- serial numbers ----------
select lives_ok(
  $$ insert into units (product_id, batch_line_id, serial_number)
     select product_id, line_id, '1107442106' from t where model = 'TRB140' $$,
  'a router with a new serial number is accepted');

select throws_ok(
  $$ insert into units (product_id, batch_line_id, serial_number)
     select product_id, line_id, '1107442106' from t where model = 'TRB140' $$,
  '23505', null,
  'the same serial number twice on the same product is rejected');

select lives_ok(
  $$ insert into units (product_id, batch_line_id, serial_number)
     select product_id, line_id, '1107442106' from t where model = 'AM103' $$,
  'the same serial number on a different product is allowed');

select throws_ok(
  $$ insert into units (product_id, batch_line_id, serial_number)
     select product_id, line_id, '   ' from t where model = 'TRB140' $$,
  '23514', null,
  'a blank serial number is rejected');

-- ---------- received quantities ----------
select lives_ok(
  $$ insert into units (product_id, batch_line_id, serial_number)
     select product_id, line_id, '1108675311' from t where model = 'TRB140' $$,
  'second router of 2 received is accepted');

select throws_ok(
  $$ insert into units (product_id, batch_line_id, serial_number)
     select product_id, line_id, '1109999999' from t where model = 'TRB140' $$,
  '23514', null,
  'a third router when only 2 were received is rejected');

select throws_ok(
  $$ insert into units (product_id, batch_line_id, serial_number)
     select product_id, line_id, 'CABLE-1' from t where model = 'CAT6-1M' $$,
  '23514', null,
  'a quantity-tracked product (cable) cannot get serialised units');

select throws_ok(
  $$ insert into units (product_id, batch_line_id, serial_number)
     select r.product_id, c.line_id, 'MISMATCH-1' from t r, t c
     where r.model = 'TRB140' and c.model = 'CAT6-1M' $$,
  '23503', null,
  'a unit cannot claim a product different from its batch line');

select throws_ok(
  $$ insert into batch_lines (batch_id, product_id, quantity_received)
     select b.id, p.id, 0 from batches b, products p where p.model = 'TRB140' limit 1 $$,
  '23514', null,
  'a batch line with quantity 0 is rejected');

select throws_ok(
  $$ update products set min_stock_level = -1 where model = 'TRB140' $$,
  '23514', null,
  'a negative minimum stock level is rejected');

-- ---------- catalogue rules ----------
select throws_ok(
  $$ insert into products (name, brand, model, category_id, tracking_type)
     select 'Duplicate', 'Teltonika', 'TRB140', id, 'serialised' from categories limit 1 $$,
  '23505', null,
  'the same brand + model cannot be added twice');

select throws_ok(
  $$ insert into suppliers (name, code_prefix) values ('Bad prefix', 'tel1') $$,
  '23514', null,
  'a supplier prefix must be 2–5 capital letters');

select throws_ok(
  $$ delete from products where model = 'TRB140' $$,
  '23503', null,
  'a product with units cannot be deleted (archive it instead)');

-- ---------- users ----------
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ insert into users (id, email, full_name, role, status)
     values ('00000000-0000-0000-0000-000000000002', 'new@gmail.com', 'New Person', 'editor', 'pending') $$,
  '23514', null,
  'a pending user cannot already have a role');

select throws_ok(
  $$ insert into users (id, email, full_name, status)
     values ('00000000-0000-0000-0000-000000000002', 'new@gmail.com', 'New Person', 'approved') $$,
  '23514', null,
  'an approved user must have a role');

-- ---------- security ----------
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'row level security is on for every table (public API sees nothing)');

select * from finish();
rollback;
