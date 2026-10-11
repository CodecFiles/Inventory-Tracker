-- Integrity tests for migration 0002 (places).
begin;
create extension if not exists pgtap;
select plan(12);

insert into auth.users (id) values ('00000000-0000-0000-0000-000000000001');
insert into users (id, email, full_name, role, status)
  values ('00000000-0000-0000-0000-000000000001', 'chetan@moonrock.om', 'Test Admin', 'super_admin', 'approved');
insert into clients (name) values ('Bank Muscat'), ('Qatar Foundation');
insert into partners (name, country_id) select 'Doha Partner LLC', id from countries where iso_code = 'QA';

select is((select count(*)::int from locations where type = 'office'), 1, 'there is exactly one MRD Office location');

select throws_ok(
  $$ insert into locations (type, name) values ('office', 'Second office') $$,
  '23505', null, 'a second office location is rejected');

select lives_ok(
  $$ insert into facilities (name, client_id, country_id)
     select 'Head Office', c.id, k.id from clients c, countries k
     where c.name = 'Bank Muscat' and k.iso_code = 'OM' $$,
  'an Oman facility without a partner is accepted');

select lives_ok(
  $$ insert into facilities (name, client_id, country_id)
     select 'Branch 1', c.id, k.id from clients c, countries k
     where c.name = 'Bank Muscat' and k.iso_code = 'OM' $$,
  'one client can have several facilities (A4)');

select throws_ok(
  $$ insert into facilities (name, client_id, country_id)
     select 'Education City', c.id, k.id from clients c, countries k
     where c.name = 'Qatar Foundation' and k.iso_code = 'QA' $$,
  '23514', null, 'a facility outside Oman without a partner is rejected (A6)');

select throws_ok(
  $$ insert into facilities (name, client_id, country_id, partner_id)
     select 'Riyadh site', c.id, k.id, p.id from clients c, countries k, partners p
     where c.name = 'Qatar Foundation' and k.iso_code = 'SA' $$,
  '23514', null, 'the partner must be in the same country as the facility');

select lives_ok(
  $$ insert into facilities (name, client_id, country_id, partner_id)
     select 'Education City', c.id, k.id, p.id from clients c, countries k, partners p
     where c.name = 'Qatar Foundation' and k.iso_code = 'QA' $$,
  'a Qatar facility with a Qatar partner is accepted');

select is(
  (select count(*)::int from locations l join facilities f on f.id = l.facility_id),
  3, 'each facility automatically got its own location');

select is(
  (select count(*)::int from locations where type = 'partner_stock'),
  1, 'the partner automatically got a stock location');

update facilities set stage = 'poc' where name = 'Head Office';
select is(
  (select array_agg(h.to_stage::text order by h.id) from facility_stage_history h
     join facilities f on f.id = h.facility_id where f.name = 'Head Office'),
  array['site_inspection', 'poc'], 'stage changes are recorded in the history');

insert into facility_contacts (facility_id, name, is_primary)
  select id, 'First contact', true from facilities where name = 'Head Office';
select throws_ok(
  $$ insert into facility_contacts (facility_id, name, is_primary)
     select id, 'Second primary', true from facilities where name = 'Head Office' $$,
  '23505', null, 'a facility can have only one primary contact');

select throws_ok(
  $$ delete from facility_stage_history $$,
  '42501', null, 'stage history cannot be deleted');

select * from finish();
rollback;
