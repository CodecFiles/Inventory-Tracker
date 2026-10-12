-- Demo data for local preview mode (scripts/dev-preview.sh). Never run against Supabase.
-- Uses the same database functions as the app, so every rule and trigger still applies.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
  ('6f1c2a3e-0000-4000-8000-000000000d01', 'dev.admin@moonrock.om'),
  ('6f1c2a3e-0000-4000-8000-000000000d02', 'dev.editor@moonrock.om'),
  ('6f1c2a3e-0000-4000-8000-000000000d03', 'dev.viewer@gmail.com'),
  ('6f1c2a3e-0000-4000-8000-000000000d04', 'new.person@gmail.com');
-- the auth trigger made them pending; approve the first three
update users set full_name = 'Dev Admin', role = 'super_admin', status = 'approved' where email = 'dev.admin@moonrock.om';
select set_config('app.user_id', '6f1c2a3e-0000-4000-8000-000000000d01', true);
update users set full_name = 'Sara Editor', role = 'editor', status = 'approved', approved_by = '6f1c2a3e-0000-4000-8000-000000000d01' where email = 'dev.editor@moonrock.om';
update users set full_name = 'Vik Viewer', role = 'viewer', status = 'approved', approved_by = '6f1c2a3e-0000-4000-8000-000000000d01' where email = 'dev.viewer@gmail.com';
update users set full_name = 'New Person' where email = 'new.person@gmail.com';

insert into suppliers (name, code_prefix, email) values ('Teltonika Distributor', 'TEL', 'sales@tel.example'),
  ('Omantel Business', 'OMT', null), ('Milesight MEA', 'MIL', null), ('Cable World', 'CBL', null);
insert into repair_companies (name) values ('Muscat Electronics Repair');
insert into categories (name) values ('Routers'), ('SIM cards'), ('Sensors'), ('Cables');
insert into products (name, brand, model, category_id, tracking_type, requires_configuration, min_stock_level)
  select 'TRB140 LTE router', 'Teltonika', 'TRB140', id, 'serialised', true, 5 from categories where name = 'Routers';
insert into products (name, brand, model, category_id, tracking_type, is_sim)
  select 'Omantel Data SIM', 'Omantel', 'SIM-DATA', id, 'serialised', true from categories where name = 'SIM cards';
insert into products (name, brand, model, category_id, tracking_type, min_stock_level)
  select 'CO₂ sensor', 'Milesight', 'AM103', id, 'hybrid', 10 from categories where name = 'Sensors';
insert into products (name, brand, model, category_id, tracking_type, min_stock_level)
  select 'Cat6 cable 3 m', 'Generic', 'CAT6-3M', id, 'quantity', 20 from categories where name = 'Cables';

-- deliveries
insert into batches (supplier_id, received_on, received_by, invoice_number)
  select s.id, current_date - 20, '6f1c2a3e-0000-4000-8000-000000000d01', 'INV-' || s.code_prefix || '-101' from suppliers s;
insert into batch_lines (batch_id, product_id, quantity_received)
  select b.id, p.id, q from batches b join suppliers s on s.id = b.supplier_id
  join products p on p.model = case s.code_prefix when 'TEL' then 'TRB140' when 'OMT' then 'SIM-DATA' when 'MIL' then 'AM103' else 'CAT6-3M' end
  join (values ('TRB140', 8), ('SIM-DATA', 8), ('AM103', 24), ('CAT6-3M', 60)) v(m, q) on v.m = p.model;
insert into units (product_id, batch_line_id, serial_number)
  select p.id, bl.id, s from products p join batch_lines bl on bl.product_id = p.id,
  lateral (select case when p.model = 'TRB140' then '11086753' || lpad(g::text, 2, '0')
                       else '899680000000123' || lpad(g::text, 4, '0') end as s
           from generate_series(1, bl.quantity_received) g) x
  where p.model in ('TRB140', 'SIM-DATA');
insert into sim_details (unit_id, iccid, carrier)
  select u.id, u.serial_number, 'Omantel' from units u join products p on p.id = u.product_id where p.is_sim;
insert into stock_movements (movement_type, product_id, unit_id, quantity, to_location_id, batch_id, performed_by)
  select 'receive', u.product_id, u.id, 1, office_location_id(), bl.batch_id, '6f1c2a3e-0000-4000-8000-000000000d01'
  from units u join batch_lines bl on bl.id = u.batch_line_id;
insert into stock_movements (movement_type, product_id, quantity, to_location_id, batch_id, performed_by)
  select 'receive', bl.product_id, bl.quantity_received, office_location_id(), bl.batch_id, '6f1c2a3e-0000-4000-8000-000000000d01'
  from batch_lines bl join products p on p.id = bl.product_id where p.tracking_type <> 'serialised';

-- routers 1–5 get SIMs 1–5
insert into sim_assignments (router_unit_id, sim_unit_id, ip_address, assigned_by)
  select r.id, s.id, ('10.64.12.' || (30 + g))::inet, '6f1c2a3e-0000-4000-8000-000000000d01'
  from generate_series(1, 5) g
  join units r on r.serial_number = '11086753' || lpad(g::text, 2, '0')
  join units s on s.serial_number = '899680000000123' || lpad(g::text, 4, '0');

-- places
insert into clients (name) values ('Lulu Hypermarket'), ('Qatar Foundation');
insert into partners (name, country_id) select 'Doha Smart Buildings', id from countries where iso_code = 'QA';
insert into facilities (name, client_id, country_id, city)
  select 'Lulu Bausher', c.id, (select id from countries where iso_code = 'OM'), 'Muscat' from clients c where c.name = 'Lulu Hypermarket';
insert into facilities (name, client_id, country_id, city)
  select 'Lulu Sohar', c.id, (select id from countries where iso_code = 'OM'), 'Sohar' from clients c where c.name = 'Lulu Hypermarket';
insert into facilities (name, client_id, country_id, city, partner_id)
  select 'QF Education City', c.id, (select id from countries where iso_code = 'QA'), 'Doha', (select id from partners limit 1)
  from clients c where c.name = 'Qatar Foundation';
select set_config('app.stage_note', 'Demo data', true);
update facilities set stage = 'poc' where name = 'Lulu Bausher';
update facilities set stage = 'contract' where name = 'Lulu Sohar';
insert into facility_contacts (facility_id, name, role, phone, is_primary)
  select id, 'Ahmed Al Balushi', 'Facility manager', '+968 9000 1234', true from facilities where name = 'Lulu Bausher';

-- one completed deployment, one draft
insert into deployments (facility_id, deployment_type, created_by)
  select id, 'poc', '6f1c2a3e-0000-4000-8000-000000000d02' from facilities where name = 'Lulu Bausher';
insert into deployment_items (deployment_id, product_id, unit_id, building, position)
  select d.id, u.product_id, u.id, 'Main', 'Plant room ' || right(u.serial_number, 1)
  from deployments d, units u where u.serial_number in ('1108675301', '1108675302');
insert into deployment_items (deployment_id, product_id, quantity)
  select d.id, p.id, 6 from deployments d, products p where p.model = 'CAT6-3M';
select complete_deployment((select min(id) from deployments), '6f1c2a3e-0000-4000-8000-000000000d02');
insert into deployments (facility_id, deployment_type, created_by)
  select id, 'contract', '6f1c2a3e-0000-4000-8000-000000000d02' from facilities where name = 'Lulu Sohar';
insert into deployment_items (deployment_id, product_id, unit_id)
  select (select max(id) from deployments), product_id, id from units where serial_number = '1108675303';
commit;
