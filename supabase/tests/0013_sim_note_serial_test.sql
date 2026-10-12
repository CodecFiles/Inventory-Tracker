-- Tests for migration 0013 (SIM notes name the router's serial number).
begin;
create extension if not exists pgtap;
select plan(2);

insert into auth.users (id) values ('00000000-0000-0000-0000-000000000131');
insert into users (id, email, full_name, role, status)
  values ('00000000-0000-0000-0000-000000000131', 'note@moonrock.om', 'Note Tester', 'super_admin', 'approved');
insert into categories (name) values ('Note');
insert into suppliers (name, code_prefix) values ('Note Supplier', 'NTS');
insert into products (name, brand, model, category_id, tracking_type, requires_configuration)
  select 'Router', 'Teltonika', 'TRB-NOTE', id, 'serialised', true from categories where name = 'Note';
insert into products (name, brand, model, category_id, tracking_type, is_sim)
  select 'SIM', 'Omantel', 'SIM-NOTE', id, 'serialised', true from categories where name = 'Note';
insert into batches (supplier_id, received_on, received_by)
  select id, current_date, '00000000-0000-0000-0000-000000000131' from suppliers where code_prefix = 'NTS';
insert into batch_lines (batch_id, product_id, quantity_received)
  select b.id, p.id, 2 from batches b, products p where p.model in ('TRB-NOTE', 'SIM-NOTE');
insert into units (product_id, batch_line_id, serial_number)
  select p.id, bl.id, s from products p join batch_lines bl on bl.product_id = p.id
  join (values ('TRB-NOTE', 'NOTE-R1'), ('TRB-NOTE', 'NOTE-R2'), ('SIM-NOTE', '8996800000000013101'),
               ('SIM-NOTE', '8996800000000013102')) v(m, s) on v.m = p.model;
insert into sim_details (unit_id, iccid) select id, serial_number from units where serial_number like '89968%131%';
insert into sim_assignments (router_unit_id, sim_unit_id, assigned_by)
  select r.id, s.id, '00000000-0000-0000-0000-000000000131' from units r, units s
  where (r.serial_number, s.serial_number) in (('NOTE-R1', '8996800000000013101'), ('NOTE-R2', '8996800000000013102'));
insert into clients (name) values ('Note Client');
insert into facilities (name, client_id, country_id)
  select 'Note Site', id, (select id from countries where iso_code = 'OM') from clients where name = 'Note Client';
insert into partners (name, country_id) select 'Note Partner', id from countries where iso_code = 'QA';

insert into deployments (facility_id, deployment_type, created_by)
  select id, 'poc', '00000000-0000-0000-0000-000000000131' from facilities where name = 'Note Site';
insert into deployment_items (deployment_id, product_id, unit_id)
  select d.id, u.product_id, u.id from deployments d, units u where u.serial_number = 'NOTE-R1';
select complete_deployment((select id from deployments d where d.facility_id = (select id from facilities where name = 'Note Site')),
                           '00000000-0000-0000-0000-000000000131');
select is((select note from stock_movements m join units u on u.id = m.unit_id
           where u.serial_number = '8996800000000013101' and m.movement_type = 'deploy'),
          'SIM inside router NOTE-R1', 'a deployed SIM''s note names its router by serial number');

insert into shipments (partner_id, created_by) select id, '00000000-0000-0000-0000-000000000131' from partners where name = 'Note Partner';
insert into shipment_items (shipment_id, product_id, unit_id)
  select s.id, u.product_id, u.id from shipments s, units u where u.serial_number = 'NOTE-R2'
    and s.partner_id = (select id from partners where name = 'Note Partner');
select ship_shipment((select id from shipments where partner_id = (select id from partners where name = 'Note Partner')),
                     '00000000-0000-0000-0000-000000000131');
select is((select note from stock_movements m join units u on u.id = m.unit_id
           where u.serial_number = '8996800000000013102' and m.movement_type = 'ship'),
          'SIM inside router NOTE-R2', 'a shipped SIM''s note names its router by serial number');

select * from finish();
rollback;
