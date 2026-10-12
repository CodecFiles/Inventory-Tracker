-- Integrity tests for migration 0004 (document codes, deployments, shipments, SIM assignments).
begin;
create extension if not exists pgtap;
select plan(21);

-- ---------- sample data ----------
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000001');
insert into users (id, email, full_name, role, status)
  values ('00000000-0000-0000-0000-000000000001', 'chetan@moonrock.om', 'Test Admin', 'super_admin', 'approved');

insert into categories (name) values ('Routers'), ('SIM cards'), ('Cables');
insert into suppliers (name, code_prefix) values ('Teltonika Distributor', 'TEL');
insert into products (name, brand, model, category_id, tracking_type, requires_configuration)
  select 'TRB router', 'Teltonika', 'TRB140', id, 'serialised', true from categories where name = 'Routers';
insert into products (name, brand, model, category_id, tracking_type, is_sim)
  select 'Data SIM', 'Omantel', 'SIM-DATA', id, 'serialised', true from categories where name = 'SIM cards';
insert into products (name, brand, model, category_id, tracking_type)
  select 'Cat6 cable', 'Generic', 'CAT6-1M', id, 'quantity' from categories where name = 'Cables';

select lives_ok(
  $$ insert into batches (supplier_id, received_on, received_by)
     select id, current_date, '00000000-0000-0000-0000-000000000001' from suppliers $$,
  'a batch can be saved without typing a code');
select matches((select code from batches limit 1), '^TEL-[0-9]{4}-001$', 'the batch code is generated from the supplier prefix');

insert into batch_lines (batch_id, product_id, quantity_received)
  select b.id, p.id, q from batches b, products p
  join (values ('TRB140', 3), ('SIM-DATA', 3), ('CAT6-1M', 20)) v(m, q) on v.m = p.model;
insert into units (product_id, batch_line_id, serial_number)
  select p.id, bl.id, s from products p join batch_lines bl on bl.product_id = p.id
  join (values ('TRB140', 'R1'), ('TRB140', 'R2'), ('TRB140', 'R3'),
               ('SIM-DATA', 'S1'), ('SIM-DATA', 'S2')) v(m, s) on v.m = p.model;
insert into sim_details (unit_id, iccid)
  select u.id, case u.serial_number when 'S1' then '8996801234567890001' else '8996801234567890002' end
  from units u where serial_number in ('S1', 'S2');
insert into stock_movements (movement_type, product_id, quantity, to_location_id, performed_by)
  select 'receive', id, 20, office_location_id(), '00000000-0000-0000-0000-000000000001'
  from products where model = 'CAT6-1M';

insert into clients (name) values ('Lulu');
insert into partners (name, country_id) select 'Doha Partner LLC', id from countries where iso_code = 'QA';
insert into facilities (name, client_id, country_id) select 'Lulu Hypermarket', c.id, k.id from clients c, countries k where k.iso_code = 'OM';
insert into facilities (name, client_id, country_id) select 'Lulu Mall', c.id, k.id from clients c, countries k where k.iso_code = 'OM';
insert into facilities (name, client_id, country_id, partner_id)
  select 'Lulu Doha', c.id, k.id, p.id from clients c, countries k, partners p where k.iso_code = 'QA';

create temp view u as select
  (select id from units where serial_number = 'R1') r1, (select id from units where serial_number = 'R2') r2,
  (select id from units where serial_number = 'R3') r3,
  (select id from units where serial_number = 'S1') s1, (select id from units where serial_number = 'S2') s2,
  (select id from products where model = 'TRB140') router, (select id from products where model = 'CAT6-1M') cable,
  (select id from facilities where name = 'Lulu Hypermarket') lulu, (select id from facilities where name = 'Lulu Mall') mall,
  (select id from facilities where name = 'Lulu Doha') doha, (select id from partners) partner,
  '00000000-0000-0000-0000-000000000001'::uuid me;

-- ---------- SIM assignments ----------
select lives_ok(
  $$ insert into sim_assignments (router_unit_id, sim_unit_id, ip_address, assigned_by)
     select r1, s1, '10.0.0.11', me from u $$,
  'SIM S1 is put into router R1 with an IP');
select is((select status::text from units, u where id = r1), 'configured', 'router R1 is now "configured"');

select throws_ok(
  $$ insert into sim_assignments (router_unit_id, sim_unit_id, assigned_by) select r1, s2, me from u $$,
  '23505', null, 'a router cannot hold two SIMs at the same time (R1)');
select throws_ok(
  $$ insert into sim_assignments (router_unit_id, sim_unit_id, assigned_by) select r2, s1, me from u $$,
  '23514', null, 'a SIM cannot be in two routers at the same time (since 0007 refused by the SIM status rule)');
select throws_ok(
  $$ insert into sim_assignments (router_unit_id, sim_unit_id, ip_address, assigned_by) select r2, s2, '10.0.0.11', me from u $$,
  '23505', null, 'the same IP cannot be in use twice');
select throws_ok(
  $$ insert into sim_assignments (router_unit_id, sim_unit_id, assigned_by) select r2, r3, me from u $$,
  '23503', null, 'only a SIM unit can be assigned as a SIM');

-- ---------- deployments ----------
insert into deployments (facility_id, deployment_type, created_by) select lulu, 'poc', me from u;
select matches((select code from deployments limit 1), '^DEP-[0-9]{4}-001$', 'the deployment code is generated');

insert into deployment_items (deployment_id, product_id, unit_id) select d.id, router, r1 from deployments d, u;
insert into deployment_items (deployment_id, product_id, quantity) select d.id, cable, 6 from deployments d, u;

select throws_ok(
  $$ insert into deployment_items (deployment_id, product_id) select d.id, router from deployments d, u $$,
  '23514', null, 'a router line must name the exact unit');

insert into deployments (facility_id, deployment_type, created_by) select mall, 'contract', me from u;
select throws_ok(
  $$ insert into deployment_items (deployment_id, product_id, unit_id)
     select d.id, router, r1 from deployments d, u where d.facility_id = u.mall $$,
  '23505', null, 'the same router cannot be planned on two deployments at once');

select lives_ok(
  $$ select complete_deployment((select id from deployments d, u where d.facility_id = u.lulu), (select me from u)) $$,
  'the Lulu deployment is completed');
select is((select location_id from units, u where id = s1),
          (select id from locations l, u where l.facility_id = u.lulu),
          'the SIM inside router R1 moved to Lulu with it');
select is((select quantity from stock_levels, u where location_id = office_location_id() and product_id = cable), 14,
          'office cable stock went from 20 to 14');
select throws_ok(
  $$ insert into deployment_items (deployment_id, product_id, quantity)
     select d.id, cable, 1 from deployments d, u where d.facility_id = u.lulu $$,
  '23514', null, 'a completed deployment cannot be changed');

-- a deployment of more cables than exist fails as a whole — the router on it does not move either
insert into deployment_items (deployment_id, product_id, unit_id) select d.id, router, r2 from deployments d, u where d.facility_id = u.mall;
insert into deployment_items (deployment_id, product_id, quantity) select d.id, cable, 50 from deployments d, u where d.facility_id = u.mall;
select throws_ok(
  $$ select complete_deployment((select id from deployments d, u where d.facility_id = u.mall), (select me from u)) $$,
  '23514', null, 'completing a deployment with too many cables is rejected');
select is((select location_id from units, u where id = r2), office_location_id(),
          'all or nothing: router R2 on that rejected deployment is still in MRD Office');

-- returning R1 frees it for a new deployment
insert into stock_movements (movement_type, product_id, unit_id, quantity, from_location_id, to_location_id, performed_by)
  select 'return', router, r1, 1, (select id from locations where facility_id = u.lulu), office_location_id(), me from u;
select is((select count(*)::int from deployment_items, u where unit_id = r1 and removed_at is null), 0,
          'after the router is returned its deployment line is closed');

-- ---------- shipments and abroad deployment ----------
insert into shipments (partner_id, created_by) select partner, me from u;
insert into shipment_items (shipment_id, product_id, quantity) select s.id, cable, 5 from shipments s, u;
select lives_ok(
  $$ select ship_shipment((select id from shipments), (select me from u)) $$,
  '5 cables are shipped to the Qatar partner');
select is((select quantity from stock_levels s join locations l on l.id = s.location_id, u
           where l.partner_id = u.partner and s.product_id = u.cable), 5,
          'the partner stock now holds 5 cables');

insert into deployments (facility_id, deployment_type, created_by) select doha, 'poc', me from u;
insert into deployment_items (deployment_id, product_id, quantity) select d.id, cable, 3 from deployments d, u where d.facility_id = u.doha;
select lives_ok(
  $$ select complete_deployment((select id from deployments d, u where d.facility_id = u.doha), (select me from u)) $$,
  'the abroad deployment is completed from the partner stock (F9)');

select * from finish();
rollback;
