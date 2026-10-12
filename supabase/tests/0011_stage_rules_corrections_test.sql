-- Tests for migration 0011 (facility stage rules, Super Admin corrections).
begin;
create extension if not exists pgtap;
select plan(11);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000111'), ('00000000-0000-0000-0000-000000000112'),
  ('00000000-0000-0000-0000-000000000113');
insert into users (id, email, full_name, role, status) values
  ('00000000-0000-0000-0000-000000000111', 'stg-editor@moonrock.om', 'Stage Editor', 'editor', 'approved'),
  ('00000000-0000-0000-0000-000000000112', 'stg-admin@moonrock.om', 'Stage Admin', 'admin', 'approved'),
  ('00000000-0000-0000-0000-000000000113', 'stg-super@moonrock.om', 'Stage Super', 'super_admin', 'approved');
insert into clients (name) values ('Stage Client');
insert into facilities (name, client_id, country_id)
  select 'Stage Site', c.id, (select id from countries where iso_code = 'OM') from clients c where c.name = 'Stage Client';

-- as the Editor
select set_config('app.user_id', '00000000-0000-0000-0000-000000000111', true);
select lives_ok($$ update facilities set stage = 'bms_scan' where name = 'Stage Site' $$, 'one step forward is allowed');
select throws_ok($$ update facilities set stage = 'contract' where name = 'Stage Site' $$,
                 '23514', null, 'skipping stages without a reason is refused');
select set_config('app.stage_note', 'Client signed without a POC', true);
select lives_ok($$ update facilities set stage = 'contract' where name = 'Stage Site' $$, 'skipping with a reason is allowed');
select is((select note from facility_stage_history h join facilities f on f.id = h.facility_id
           where f.name = 'Stage Site' order by h.id desc limit 1), 'Client signed without a POC',
          'the reason is kept in the stage history');
select throws_ok($$ update facilities set stage = 'poc' where name = 'Stage Site' $$,
                 '42501', null, 'an Editor cannot move a facility back');

-- as the Admin
select set_config('app.user_id', '00000000-0000-0000-0000-000000000112', true);
select set_config('app.stage_note', '', true);
select throws_ok($$ update facilities set stage = 'poc' where name = 'Stage Site' $$,
                 '23514', null, 'moving back needs a reason, even for an Admin');
select set_config('app.stage_note', 'Contract fell through, POC restarts', true);
select lives_ok($$ update facilities set stage = 'poc' where name = 'Stage Site' $$, 'an Admin moves it back with a reason');
select lives_ok($$ update facilities set stage = 'closed' where name = 'Stage Site' $$, 'closing is allowed from any stage');

-- corrections
insert into categories (name) values ('Corr');
insert into products (name, brand, model, category_id, tracking_type)
  select 'Cable', 'Generic', 'CORR-1', id, 'quantity' from categories where name = 'Corr';
select throws_ok(
  $$ insert into stock_movements (movement_type, product_id, quantity, to_location_id, performed_by, note)
     select 'correction', id, 2, office_location_id(), '00000000-0000-0000-0000-000000000112', 'Recount' from products where model = 'CORR-1' $$,
  '42501', null, 'an Admin cannot record a correction');
select throws_ok(
  $$ insert into stock_movements (movement_type, product_id, quantity, to_location_id, performed_by)
     select 'correction', id, 2, office_location_id(), '00000000-0000-0000-0000-000000000113' from products where model = 'CORR-1' $$,
  '23514', null, 'a correction needs a reason');
select lives_ok(
  $$ insert into stock_movements (movement_type, product_id, quantity, to_location_id, performed_by, note)
     select 'correction', id, 2, office_location_id(), '00000000-0000-0000-0000-000000000113', 'Recount found 2 more' from products where model = 'CORR-1' $$,
  'a Super Admin records a correction with a reason');

select * from finish();
rollback;
