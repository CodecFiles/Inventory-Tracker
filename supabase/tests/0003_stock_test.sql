-- Integrity tests for migration 0003 (stock movements and stock levels).
begin;
create extension if not exists pgtap;
select plan(20);

-- ---------- sample data ----------
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000001');
insert into users (id, email, full_name, role, status)
  values ('00000000-0000-0000-0000-000000000001', 'chetan@moonrock.om', 'Test Admin', 'super_admin', 'approved');
select set_config('app.user_id', '00000000-0000-0000-0000-000000000001', true);

insert into categories (name) values ('Routers'), ('Cables');
insert into suppliers (name, code_prefix) values ('Teltonika Distributor', 'TEL');
insert into repair_companies (name) values ('Muscat Repairs');
insert into products (name, brand, model, category_id, tracking_type)
  select 'TRB router', 'Teltonika', 'TRB140', id, 'serialised' from categories where name = 'Routers';
insert into products (name, brand, model, category_id, tracking_type)
  select 'Cat6 cable', 'Generic', 'CAT6-1M', id, 'quantity' from categories where name = 'Cables';
insert into batches (code, supplier_id, received_on, received_by)
  select 'TEL-2026-001', id, current_date, '00000000-0000-0000-0000-000000000001' from suppliers;
insert into batch_lines (batch_id, product_id, quantity_received)
  select b.id, p.id, 1 from batches b, products p where p.model = 'TRB140';
insert into batch_lines (batch_id, product_id, quantity_received)
  select b.id, p.id, 10 from batches b, products p where p.model = 'CAT6-1M';

insert into clients (name) values ('Lulu');
insert into partners (name, country_id) select 'Doha Partner LLC', id from countries where iso_code = 'QA';
insert into facilities (name, client_id, country_id)
  select 'Lulu Hypermarket', c.id, k.id from clients c, countries k where k.iso_code = 'OM';
insert into facilities (name, client_id, country_id, partner_id)
  select 'Lulu Doha', c.id, k.id, p.id from clients c, countries k, partners p where k.iso_code = 'QA';

create temp view v as select
  (select id from products where model = 'TRB140')  as router,
  (select id from products where model = 'CAT6-1M') as cable,
  office_location_id()                               as office,
  (select l.id from locations l join facilities f on f.id = l.facility_id where f.name = 'Lulu Hypermarket') as lulu,
  (select l.id from locations l join facilities f on f.id = l.facility_id where f.name = 'Lulu Doha') as doha,
  (select id from locations where type = 'partner_stock') as partner,
  (select id from locations where type = 'repair_company') as repairer,
  '00000000-0000-0000-0000-000000000001'::uuid as me;

-- receive 10 cables into MRD Office
insert into stock_movements (movement_type, product_id, quantity, to_location_id, performed_by)
  select 'receive', cable, 10, office, me from v;

-- ---------- counted stock: the "6 cables" exercise ----------
select is((select quantity from stock_levels, v where location_id = office and product_id = cable), 10,
  'receiving 10 cables puts 10 in MRD Office');

select lives_ok(
  $$ insert into stock_movements (movement_type, product_id, quantity, from_location_id, to_location_id, performed_by)
     select 'deploy', cable, 6, office, lulu, me from v $$,
  'first technician deploys 6 cables');

select is((select quantity from stock_levels, v where location_id = office and product_id = cable), 4,
  'MRD Office now has 4 cables');
select is((select quantity from stock_levels, v where location_id = lulu and product_id = cable), 6,
  'Lulu now has 6 cables');

select throws_ok(
  $$ insert into stock_movements (movement_type, product_id, quantity, from_location_id, to_location_id, performed_by)
     select 'deploy', cable, 6, office, lulu, me from v $$,
  '23514', null,
  'second technician deploying 6 more is rejected — stock can never go negative');

select is((select quantity from stock_levels, v where location_id = office and product_id = cable), 4,
  'after the rejected deployment the office still has 4 (nothing half-saved)');
select is((select count(*)::int from stock_movements where movement_type = 'deploy'), 1,
  'the rejected deployment left no movement record');

select throws_ok(
  $$ insert into stock_movements (movement_type, product_id, quantity, from_location_id, to_location_id, performed_by)
     select 'deploy', cable, 1, lulu, office, me from v $$,
  '23514', null, 'a "deploy" cannot go from a facility back to the office (use "return")');

-- ---------- serialised router ----------
insert into units (product_id, batch_line_id, serial_number)
  select p.id, bl.id, '1107442106' from products p join batch_lines bl on bl.product_id = p.id where p.model = 'TRB140';
create temp view r as select id as unit from units where serial_number = '1107442106';

select throws_ok(
  $$ insert into stock_movements (movement_type, product_id, quantity, from_location_id, to_location_id, performed_by)
     select 'deploy', router, 1, office, lulu, me from v $$,
  '23514', null, 'a serialised router cannot be moved as a bare quantity');

select lives_ok(
  $$ insert into stock_movements (movement_type, product_id, unit_id, quantity, from_location_id, to_location_id, performed_by)
     select 'deploy', router, unit, 1, office, lulu, me from v, r $$,
  'the router is deployed to Lulu');

select is((select status::text from units, r where id = unit), 'deployed', 'the router status is now "deployed"');
select is((select location_id from units, r where id = unit), (select lulu from v), 'the router is now at Lulu');

select throws_ok(
  $$ insert into stock_movements (movement_type, product_id, unit_id, quantity, from_location_id, to_location_id, performed_by)
     select 'deploy', router, unit, 1, office, lulu, me from v, r $$,
  '23514', null, 'the same router cannot be deployed again — it is no longer in the office');

select lives_ok(
  $$ insert into stock_movements (movement_type, product_id, unit_id, quantity, from_location_id, to_location_id, performed_by)
     select 'send_repair', router, unit, 1, lulu, repairer, me from v, r $$,
  'a faulty router can go from the facility to a repair company');
select is((select status::text from units, r where id = unit), 'in_repair', 'the router status is now "in repair"');

-- ---------- abroad (F9, F10) ----------
select throws_ok(
  $$ insert into stock_movements (movement_type, product_id, quantity, from_location_id, to_location_id, performed_by)
     select 'deploy', cable, 1, office, doha, me from v $$,
  '23514', null, 'stock cannot go straight from MRD Office to a facility abroad');

insert into stock_movements (movement_type, product_id, quantity, from_location_id, to_location_id, performed_by)
  select 'ship', cable, 3, office, partner, me from v;
select lives_ok(
  $$ insert into stock_movements (movement_type, product_id, quantity, from_location_id, to_location_id, performed_by)
     select 'deploy_abroad', cable, 2, partner, doha, me from v $$,
  'shipped stock can be deployed from the partner to a facility abroad');

select throws_ok(
  $$ insert into stock_movements (movement_type, product_id, quantity, from_location_id, to_location_id, performed_by)
     select 'return', cable, 1, doha, office, me from v $$,
  '23514', null, 'items never come back from abroad through normal returns (F10)');

-- ---------- the ledger can't be rewritten ----------
select throws_ok(
  $$ update stock_movements set quantity = 1 $$,
  '42501', null, 'stock movements cannot be edited');
select throws_ok(
  $$ delete from stock_movements $$,
  '42501', null, 'stock movements cannot be deleted');

select * from finish();
rollback;
