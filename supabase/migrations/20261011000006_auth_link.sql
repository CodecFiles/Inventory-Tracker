-- Migration 0006 — link Supabase Auth logins to MRD users
-- Design reference: docs/DATABASE.md §L5, docs/ARCHITECTURE.md §5
--
-- Supabase Auth keeps logins (passwords, Google identities) in auth.users. Our own users table holds
-- what MRD decides: approval status and role. When anyone signs up, a row is created here as
-- PENDING with no role — they can see nothing until an admin approves them (D1b).

create function handle_new_auth_user() returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- MRD accounts are always email-based (Google or email/password); anything else is ignored
  if new.email is null then
    return new;
  end if;
  insert into public.users (id, email, full_name)
  values (
    new.id,
    lower(new.email),
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),   -- Google provides "name"
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_auth_user();

-- Creating the very first Super Admin. Works exactly once: as soon as an approved Super Admin
-- exists it refuses, so it can never be used to take over the system later.
-- Run once in the Supabase SQL editor after signing up:  select bootstrap_first_super_admin('you@example.com');
create function bootstrap_first_super_admin(p_email text) returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if exists (select 1 from users where role = 'super_admin' and status = 'approved') then
    raise exception 'A Super Admin already exists; use the app to manage users'
      using errcode = 'insufficient_privilege';
  end if;
  update users set status = 'approved', role = 'super_admin' where email = lower(p_email);
  if not found then
    raise exception 'No signed-up user with email %', p_email using errcode = 'no_data_found';
  end if;
end;
$$;

-- Only the database owner (SQL editor) may run it — never the public API roles.
revoke execute on function bootstrap_first_super_admin(text) from public;
