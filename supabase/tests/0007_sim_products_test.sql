-- Tests for migration 0007 (SIM products, preparation rules).
begin;
create extension if not exists pgtap;
select plan(8);

insert into auth.users (id) values ('00000000-0000-0000-0000-000000000071');
insert into users (id, email, full_name, role, status)
  values ('00000000-0000-0000-0000-000000000071', 'prep@moonrock.om', 'Prep Tester', 'super_admin', 'approved');
select set_config('app.user_id', '00000000-0000-0000-0000-000000000071', true);

insert into categories (name) values ('Prep');
insert into suppliers (name, code_prefix) values ('Prep Supplier', 'PRP');
insert into products (name, brand, model, category_id, tracking_type, requires_configuration)
  select 'TRB router', 'Teltonika', 'TRB-P', id, 'serialised', true from categories where name = 'Prep';
insert into products (name, brand, model, category_id, tracking_type, is_sim)
  select 'Data SIM', 'Omantel', 'SIM-P', id, 'serialised', true from categories where name = 'Prep';
insert into products (name, brand, model, category_id, tracking_type)
  select 'Sensor', 'Milesight', 'AM-P', id, 'serialised' from categories where name = 'Prep';

select throws_ok(
  $$ insert into products (name, brand, model, category_id, tracking_type, is_sim)
     select 'Bulk SIM', 'Omantel', 'SIM-Q', id, 'quantity', true from categories where name = 'Prep' $$,
  '23514', null, 'a SIM product must be tracked one by one');

insert into batches (supplier_id, received_on, received_by)
  select id, current_date, '00000000-0000-0000-0000-000000000071' from suppliers where code_prefix = 'PRP';
insert into batch_lines (batch_id, product_id, quantity_received)
  select b.id, p.id, 3 from batches b, products p where p.model in ('TRB-P', 'SIM-P', 'AM-P');
insert into units (product_id, batch_line_id, serial_number)
  select p.id, bl.id, s from products p join batch_lines bl on bl.product_id = p.id
  join (values ('TRB-P', 'PR1'), ('SIM-P', '8996800000000000071'), ('SIM-P', '8996800000000000072'),
               ('SIM-P', '8996800000000000073'), ('AM-P', 'SN1')) v(m, s) on v.m = p.model;
insert into sim_details (unit_id, iccid)
  select id, serial_number from units where serial_number like '89968%';

select throws_ok(
  $$ insert into sim_details (unit_id, iccid) select id, '8996800000000000099' from units where serial_number = 'SN1' $$,
  '23514', null, 'SIM details cannot be attached to a sensor');

create temp table ids as select
  (select id from units where serial_number = 'PR1') r,
  (select id from units where serial_number = '8996800000000000071') s1,
  (select id from units where serial_number = '8996800000000000072') s2,
  (select id from units where serial_number = '8996800000000000073') s3,
  '00000000-0000-0000-0000-000000000071'::uuid me;

select lives_ok($$ insert into sim_assignments (router_unit_id, sim_unit_id, ip_address, assigned_by)
                   select r, s1, '10.7.0.1', me from ids $$, 'a free SIM goes into a router in the office');
select is((select array_agg(status::text order by id) from units where id in (select r from ids union select s1 from ids)),
          array['configured', 'configured'], 'router and SIM become configured');

-- swap: end the old assignment, the old SIM is retired, the new SIM goes in
update sim_assignments set ended_at = now(), ended_by = (select me from ids) where sim_unit_id = (select s1 from ids);
insert into stock_movements (movement_type, product_id, unit_id, quantity, from_location_id, performed_by)
  select 'write_off', product_id, id, 1, office_location_id(), (select me from ids) from units where id = (select s1 from ids);
select throws_ok($$ insert into sim_assignments (router_unit_id, sim_unit_id, assigned_by) select r, s1, me from ids $$,
                 '23514', null, 'a retired SIM cannot go back into a router');
select lives_ok($$ insert into sim_assignments (router_unit_id, sim_unit_id, ip_address, assigned_by)
                   select r, s2, '10.7.0.2', me from ids $$, 'an already-configured router can take a new SIM after a swap');

-- a SIM that is already configured (in a router) cannot go anywhere else, even after its row is ended by mistake
update sim_assignments set ended_at = now(), ended_by = (select me from ids) where sim_unit_id = (select s2 from ids);
select throws_ok($$ insert into sim_assignments (router_unit_id, sim_unit_id, assigned_by) select r, s2, me from ids $$,
                 '23514', null, 'a SIM still marked configured must be returned to spare first');

update units set status = 'in_repair' where id = (select r from ids);
select throws_ok($$ insert into sim_assignments (router_unit_id, sim_unit_id, assigned_by) select r, s3, me from ids $$,
                 '23514', null, 'a router in repair cannot be configured');

select * from finish();
rollback;
