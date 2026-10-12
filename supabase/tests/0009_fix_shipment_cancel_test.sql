-- Tests for migration 0009 (cancelling shipments).
begin;
create extension if not exists pgtap;
select plan(3);

insert into auth.users (id) values ('00000000-0000-0000-0000-000000000091');
insert into users (id, email, full_name, role, status)
  values ('00000000-0000-0000-0000-000000000091', 'cxl@moonrock.om', 'Cancel Tester', 'super_admin', 'approved');
insert into partners (name, country_id) select 'Cancel Partner', id from countries where iso_code = 'QA';
insert into categories (name) values ('Cxl');
insert into products (name, brand, model, category_id, tracking_type)
  select 'Cable', 'Generic', 'CXL-1', id, 'quantity' from categories where name = 'Cxl';
insert into shipments (partner_id, created_by)
  select id, '00000000-0000-0000-0000-000000000091' from partners where name = 'Cancel Partner';
insert into shipment_items (shipment_id, product_id, quantity)
  select s.id, p.id, 2 from shipments s, products p where p.model = 'CXL-1';

select lives_ok($$ update shipments set status = 'cancelled' $$, 'a draft shipment can be cancelled');
select is((select count(*)::int from shipment_items where removed_at is null), 0, 'its lines are released');
select throws_ok($$ update shipments set status = 'draft' where status = 'cancelled';
                    update shipments set status = 'shipped', shipped_on = current_date,
                      shipped_by = '00000000-0000-0000-0000-000000000091';
                    update shipments set status = 'cancelled' $$,
                 '23514', null, 'a shipped shipment cannot be cancelled');

select * from finish();
rollback;
