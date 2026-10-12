-- Tests for migration 0010 (configuring routers at a partner abroad).
begin;
create extension if not exists pgtap;
select plan(5);

insert into auth.users (id) values ('00000000-0000-0000-0000-000000000101');
insert into users (id, email, full_name, role, status)
  values ('00000000-0000-0000-0000-000000000101', 'abr@moonrock.om', 'Abroad Tester', 'super_admin', 'approved');
insert into categories (name) values ('Abr');
insert into suppliers (name, code_prefix) values ('Abr Supplier', 'ABR');
insert into products (name, brand, model, category_id, tracking_type, requires_configuration)
  select 'TRB router', 'Teltonika', 'TRB-ABR', id, 'serialised', true from categories where name = 'Abr';
insert into products (name, brand, model, category_id, tracking_type, is_sim)
  select 'Data SIM', 'Ooredoo', 'SIM-ABR', id, 'serialised', true from categories where name = 'Abr';
insert into batches (supplier_id, received_on, received_by)
  select id, current_date, '00000000-0000-0000-0000-000000000101' from suppliers where code_prefix = 'ABR';
insert into batch_lines (batch_id, product_id, quantity_received)
  select b.id, p.id, 2 from batches b, products p where p.model in ('TRB-ABR', 'SIM-ABR');
insert into units (product_id, batch_line_id, serial_number)
  select p.id, bl.id, s from products p join batch_lines bl on bl.product_id = p.id
  join (values ('TRB-ABR', 'AR1'), ('SIM-ABR', '8996800000000001001'), ('SIM-ABR', '8996800000000001002')) v(m, s) on v.m = p.model;
insert into sim_details (unit_id, iccid) select id, serial_number from units where serial_number like '89968%';
insert into partners (name, country_id) select 'Abr Partner', id from countries where iso_code = 'QA';
insert into clients (name) values ('Abr Client');
insert into facilities (name, client_id, country_id, partner_id)
  select 'Abr Site', c.id, p.country_id, p.id from clients c, partners p where c.name = 'Abr Client' and p.name = 'Abr Partner';

-- ship the router unconfigured with one loose SIM; the other SIM stays in the office
insert into shipments (partner_id, created_by) select id, '00000000-0000-0000-0000-000000000101' from partners where name = 'Abr Partner';
insert into shipment_items (shipment_id, product_id, unit_id)
  select s.id, u.product_id, u.id from shipments s, units u where u.serial_number in ('AR1', '8996800000000001001');
select ship_shipment((select s.id from shipments s join partners p on p.id = s.partner_id where p.name = 'Abr Partner'),
                     '00000000-0000-0000-0000-000000000101');

create temp table ids as select
  (select id from units where serial_number = 'AR1') r,
  (select id from units where serial_number = '8996800000000001001') s_abroad,
  (select id from units where serial_number = '8996800000000001002') s_office,
  '00000000-0000-0000-0000-000000000101'::uuid me;

select throws_ok($$ insert into sim_assignments (router_unit_id, sim_unit_id, assigned_by) select r, s_office, me from ids $$,
                 '23514', null, 'a router abroad cannot take a SIM that is still in MRD Office');
select lives_ok($$ insert into sim_assignments (router_unit_id, sim_unit_id, ip_address, assigned_by)
                   select r, s_abroad, '10.99.0.1', me from ids $$,
                'the partner configures the router with the SIM shipped alongside');
select is((select array_agg(status::text order by id) from units where id in (select r from ids union select s_abroad from ids)),
          array['shipped_to_partner', 'shipped_to_partner'], 'both stay in the partner''s stock');

insert into deployments (facility_id, deployment_type, created_by)
  select f.id, 'poc', '00000000-0000-0000-0000-000000000101' from facilities f where f.name = 'Abr Site';
insert into deployment_items (deployment_id, product_id, unit_id)
  select d.id, u.product_id, u.id from deployments d join facilities f on f.id = d.facility_id, units u
  where f.name = 'Abr Site' and u.serial_number = 'AR1';
select lives_ok($$ select complete_deployment((select d.id from deployments d join facilities f on f.id = d.facility_id
                                               where f.name = 'Abr Site'), '00000000-0000-0000-0000-000000000101') $$,
                'the abroad deployment completes');
select is((select status::text from units where serial_number = '8996800000000001001'), 'deployed_abroad',
          'the SIM inside the router went to the abroad facility with it');

select * from finish();
rollback;
