-- Tests for migration 0012 (catalogue safety rules).
begin;
create extension if not exists pgtap;
select plan(7);

insert into auth.users (id) values ('00000000-0000-0000-0000-000000000121');
insert into users (id, email, full_name, role, status)
  values ('00000000-0000-0000-0000-000000000121', 'cat@moonrock.om', 'Cat Tester', 'super_admin', 'approved');
insert into categories (name) values ('Cat12');
insert into suppliers (name, code_prefix) values ('Cat Supplier', 'CTS');
insert into products (name, brand, model, category_id, tracking_type)
  select 'Cable', 'Generic', 'CAT12-C', id, 'quantity' from categories where name = 'Cat12';
insert into products (name, brand, model, category_id, tracking_type)
  select 'Bracket', 'Generic', 'CAT12-B', id, 'quantity' from categories where name = 'Cat12';

select lives_ok($$ update products set tracking_type = 'serialised' where model = 'CAT12-B' $$,
                'a product never received can still change kind');

insert into batches (supplier_id, received_on, received_by)
  select id, current_date, '00000000-0000-0000-0000-000000000121' from suppliers where code_prefix = 'CTS';
insert into batch_lines (batch_id, product_id, quantity_received)
  select b.id, p.id, 5 from batches b, products p where p.model = 'CAT12-C';
insert into stock_movements (movement_type, product_id, quantity, to_location_id, performed_by)
  select 'receive', id, 5, office_location_id(), '00000000-0000-0000-0000-000000000121' from products where model = 'CAT12-C';

select throws_ok($$ update products set tracking_type = 'serialised' where model = 'CAT12-C' $$,
                 '23514', null, 'a received product cannot change kind');
select lives_ok($$ update products set name = 'Cat6 cable 1m', min_stock_level = 10 where model = 'CAT12-C' $$,
                'its name and minimum stock can still change');

insert into clients (name) values ('Cat Client');
insert into facilities (name, client_id, country_id)
  select 'Cat Site', id, (select id from countries where iso_code = 'OM') from clients where name = 'Cat Client';
insert into stock_movements (movement_type, product_id, quantity, from_location_id, to_location_id, performed_by)
  select 'deploy', p.id, 2, office_location_id(), l.id, '00000000-0000-0000-0000-000000000121'
  from products p, locations l join facilities f on f.id = l.facility_id where p.model = 'CAT12-C' and f.name = 'Cat Site';

select throws_ok($$ update facilities set country_id = (select id from countries where iso_code = 'AE') where name = 'Cat Site' $$,
                 '23514', null, 'a facility with stock history cannot change country');
select throws_ok($$ update facilities set is_active = false where name = 'Cat Site' $$,
                 '23514', null, 'a facility still holding 2 cables cannot be archived');

insert into stock_movements (movement_type, product_id, quantity, from_location_id, to_location_id, performed_by)
  select 'return', p.id, 2, l.id, office_location_id(), '00000000-0000-0000-0000-000000000121'
  from products p, locations l join facilities f on f.id = l.facility_id where p.model = 'CAT12-C' and f.name = 'Cat Site';
select lives_ok($$ update facilities set is_active = false where name = 'Cat Site' $$,
                'once empty, it can be archived');

insert into partners (name, country_id) select 'Cat Partner', id from countries where iso_code = 'QA';
select lives_ok($$ update partners set is_active = false where name = 'Cat Partner' $$, 'an empty partner can be archived');

select * from finish();
rollback;
