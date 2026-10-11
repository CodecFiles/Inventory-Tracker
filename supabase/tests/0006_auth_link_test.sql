-- Tests for migration 0006 (Supabase Auth -> MRD users).
begin;
create extension if not exists pgtap;
select plan(7);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'Owner@Moonrock.om', '{"full_name": "Chetan"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'tech@gmail.com',    '{"name": "Google Name"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'noname@outlook.com', '{}');

select is((select status::text from users where id = '00000000-0000-0000-0000-0000000000a1'), 'pending',
          'a new sign-up becomes a PENDING MRD user');
select is((select role from users where id = '00000000-0000-0000-0000-0000000000a1'), null,
          'a new sign-up has no role');
select is((select email from users where id = '00000000-0000-0000-0000-0000000000a1'), 'owner@moonrock.om',
          'emails are stored in lower case');
select is((select full_name from users where id = '00000000-0000-0000-0000-0000000000a2'), 'Google Name',
          'the name from Google sign-in is used');
select is((select full_name from users where id = '00000000-0000-0000-0000-0000000000a3'), 'noname',
          'without a name, the part before @ is used');

select lives_ok($$ select bootstrap_first_super_admin('owner@moonrock.om') $$,
                'the first Super Admin can be created once');
select throws_ok($$ select bootstrap_first_super_admin('tech@gmail.com') $$, '42501', null,
                 'it refuses once a Super Admin exists');

select * from finish();
rollback;
