-- Tests for migration 0008 (retired units cannot move).
begin;
create extension if not exists pgtap;
select plan(3);

insert into auth.users (id) values ('00000000-0000-0000-0000-000000000081');
insert into users (id, email, full_name, role, status)
  values ('00000000-0000-0000-0000-000000000081', 'ret@moonrock.om', 'Ret Tester', 'super_admin', 'approved');
insert into categories (name) values ('Ret');
insert into suppliers (name, code_prefix) values ('Ret Supplier', 'RET');
insert into products (name, brand, model, category_id, tracking_type)
  select 'Sensor', 'Milesight', 'AM-RET', id, 'serialised' from categories where name = 'Ret';
insert into batches (supplier_id, received_on, received_by)
  select id, current_date, '00000000-0000-0000-0000-000000000081' from suppliers where code_prefix = 'RET';
insert into batch_lines (batch_id, product_id, quantity_received)
  select b.id, p.id, 1 from batches b, products p where p.model = 'AM-RET';
insert into units (product_id, batch_line_id, serial_number)
  select p.id, bl.id, 'RET-1' from products p join batch_lines bl on bl.product_id = p.id where p.model = 'AM-RET';
insert into clients (name) values ('Ret Client');
insert into facilities (name, client_id, country_id)
  select 'Ret Site', c.id, (select id from countries where iso_code = 'OM') from clients c where c.name = 'Ret Client';

insert into stock_movements (movement_type, product_id, unit_id, quantity, from_location_id, performed_by)
  select 'write_off', product_id, id, 1, office_location_id(), '00000000-0000-0000-0000-000000000081'
  from units where serial_number = 'RET-1';
select is((select status::text from units where serial_number = 'RET-1'), 'retired', 'the sensor is written off');

select throws_ok(
  $$ insert into stock_movements (movement_type, product_id, unit_id, quantity, from_location_id, to_location_id, performed_by)
     select 'deploy', u.product_id, u.id, 1, office_location_id(), l.id, '00000000-0000-0000-0000-000000000081'
     from units u, locations l join facilities f on f.id = l.facility_id
     where u.serial_number = 'RET-1' and f.name = 'Ret Site' $$,
  '23514', null, 'a retired unit cannot be deployed');
select throws_ok(
  $$ insert into stock_movements (movement_type, product_id, unit_id, quantity, from_location_id, performed_by)
     select 'write_off', product_id, id, 1, office_location_id(), '00000000-0000-0000-0000-000000000081'
     from units where serial_number = 'RET-1' $$,
  '23514', null, 'a retired unit cannot be written off twice');

select * from finish();
rollback;
