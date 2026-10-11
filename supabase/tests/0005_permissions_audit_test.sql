-- Integrity tests for migration 0005 (permissions and audit log).
begin;
create extension if not exists pgtap;
select plan(16);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000d'),
  ('00000000-0000-0000-0000-00000000000e');
insert into users (id, email, full_name, role, status) values
  ('00000000-0000-0000-0000-00000000000a', 'super@moonrock.om',  'Super Admin', 'super_admin', 'approved'),
  ('00000000-0000-0000-0000-00000000000b', 'admin@moonrock.om',  'An Admin',    'admin',       'approved'),
  ('00000000-0000-0000-0000-00000000000c', 'editor@gmail.com',   'An Editor',   'editor',      'approved'),
  ('00000000-0000-0000-0000-00000000000d', 'viewer@moonrock.om', 'A Viewer',    'viewer',      'approved');
insert into users (id, email, full_name) values ('00000000-0000-0000-0000-00000000000e', 'new@gmail.com', 'New Person');

-- ---------- what each role may do ----------
select ok(has_permission('00000000-0000-0000-0000-00000000000a', 'settings.manage'), 'Super Admin can do everything');
select ok(has_permission('00000000-0000-0000-0000-00000000000c', 'deployments.complete'), 'Editor can complete deployments (P2)');
select ok(not has_permission('00000000-0000-0000-0000-00000000000c', 'users.approve'), 'Editor cannot approve users');
select ok(not has_permission('00000000-0000-0000-0000-00000000000d', 'inventory.receive'), 'Viewer cannot receive stock');
select ok(not has_permission('00000000-0000-0000-0000-00000000000e', 'reports.view'), 'a pending user can do nothing');
select ok(not has_permission('00000000-0000-0000-0000-00000000000b', 'users.approve'), 'an Admin starts with no permissions');

-- ---------- granting Admin permissions ----------
select throws_ok(
  $$ insert into user_permissions (user_id, permission_key, granted_by)
     values ('00000000-0000-0000-0000-00000000000b', 'users.approve', '00000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'an Admin cannot grant permissions to themselves');
select lives_ok(
  $$ insert into user_permissions (user_id, permission_key, granted_by)
     values ('00000000-0000-0000-0000-00000000000b', 'users.approve', '00000000-0000-0000-0000-00000000000a') $$,
  'a Super Admin grants "approve users" to the Admin');
select ok(has_permission('00000000-0000-0000-0000-00000000000b', 'users.approve'), 'the Admin can now approve users');

-- ---------- approving users (P1) ----------
select set_config('app.user_id', '00000000-0000-0000-0000-00000000000b', true);  -- the Admin acts
select throws_ok(
  $$ update users set status = 'approved', role = 'admin' where email = 'new@gmail.com' $$,
  '42501', null, 'an Admin cannot make someone an Admin (P1)');
select lives_ok(
  $$ update users set status = 'approved', role = 'editor' where email = 'new@gmail.com' $$,
  'an Admin can approve a sign-up as Editor');
select is((select approved_by from users where email = 'new@gmail.com'),
          '00000000-0000-0000-0000-00000000000b'::uuid, 'the approver is recorded automatically');
select throws_ok(
  $$ update users set role = 'super_admin' where id = '00000000-0000-0000-0000-00000000000b' $$,
  '42501', null, 'nobody can change their own role');

-- ---------- last Super Admin ----------
select set_config('app.user_id', '', true);
select throws_ok(
  $$ update users set status = 'disabled' where role = 'super_admin' $$,
  '23514', null, 'the last Super Admin cannot be disabled');

-- ---------- audit ----------
select is(
  (select actor_id from audit_log where entity_type = 'users' and action = 'users.update'
     and after ->> 'email' = 'new@gmail.com' order by id desc limit 1),
  '00000000-0000-0000-0000-00000000000b'::uuid,
  'the approval is in the audit log with who did it');
select throws_ok($$ delete from audit_log $$, '42501', null, 'the audit log cannot be deleted');

select * from finish();
rollback;
