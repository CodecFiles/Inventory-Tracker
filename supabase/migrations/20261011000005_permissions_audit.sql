-- Migration 0005 — permissions and audit log
-- Design reference: docs/DATABASE.md §L5
--
-- The server tells the database who is acting at the start of every transaction:
--     select set_config('app.user_id', '<user uuid>', true);
-- Triggers below use that to stamp the audit log and to refuse role changes the actor isn't
-- allowed to make. The server also checks permissions itself — this is the second layer.

create function current_actor() returns uuid
language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

-- ---------------------------------------------------------------------------------------------
-- Permission catalogue
-- ---------------------------------------------------------------------------------------------
create table permissions (
  key          text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  description  text not null
);

insert into permissions (key, description) values
  ('inventory.receive',        'Receive deliveries into MRD Office'),
  ('inventory.prepare',        'Configure routers, assign SIMs and IPs'),
  ('inventory.move',           'Returns, repairs, supplier returns, write-offs'),
  ('deployments.create',       'Create and edit draft or scheduled deployments'),
  ('deployments.complete',     'Complete deployments (moves stock)'),
  ('shipments.manage',         'Create and ship shipments to partners'),
  ('facilities.manage',        'Create and edit facilities, clients and contacts'),
  ('facilities.change_stage',  'Move a facility to another project stage'),
  ('products.manage',          'Manage products and categories'),
  ('suppliers.manage',         'Manage suppliers and repair companies'),
  ('partners.manage',          'Manage partner companies and contacts'),
  ('reports.view',             'View reports and dashboards'),
  ('reports.export',           'Export reports and lists'),
  ('audit.view',               'View the audit log'),
  ('users.approve',            'Approve or reject sign-ups (Editor/Viewer only)'),
  ('users.manage',             'Disable users and change Editor/Viewer roles'),
  ('settings.manage',          'Change application settings');

-- Fixed permissions for Editor and Viewer (P2). Super Admin has everything; Admins get theirs
-- individually in user_permissions.
create table role_permissions (
  role            user_role not null check (role in ('editor', 'viewer')),
  permission_key  text not null references permissions (key) on delete restrict,
  primary key (role, permission_key)
);
insert into role_permissions (role, permission_key)
  select 'editor', key from permissions
   where key like 'inventory.%' or key like 'deployments.%' or key like 'facilities.%'
      or key in ('shipments.manage', 'reports.view');
insert into role_permissions (role, permission_key) values ('viewer', 'reports.view');

create table user_permissions (
  user_id         uuid not null references users (id) on delete restrict,
  permission_key  text not null references permissions (key) on delete restrict,
  granted_by      uuid not null references users (id) on delete restrict,
  granted_at      timestamptz not null default now(),
  primary key (user_id, permission_key)
);

-- One question the server asks before every action: may this user do this?
create function has_permission(p_user uuid, p_key text) returns boolean
language sql stable as $$
  select coalesce((
    select case
      when u.status <> 'approved' then false
      when u.role = 'super_admin' then true
      when u.role = 'admin' then exists (select 1 from user_permissions up
                                         where up.user_id = u.id and up.permission_key = p_key)
      else exists (select 1 from role_permissions rp where rp.role = u.role and rp.permission_key = p_key)
    end
    from users u where u.id = p_user), false)
$$;

-- Only a Super Admin grants Admin permissions, and only to Admins.
create function check_user_permission_grant() returns trigger
language plpgsql as $$
declare v_actor_role user_role;
begin
  if (select role from users where id = new.user_id) is distinct from 'admin' then
    raise exception 'Individual permissions can only be given to Admins' using errcode = 'check_violation';
  end if;
  select role into v_actor_role from users where id = new.granted_by;
  if v_actor_role is distinct from 'super_admin' then
    raise exception 'Only a Super Admin can grant Admin permissions' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger user_permissions_grant_rule before insert or update on user_permissions
  for each row execute function check_user_permission_grant();

-- Revoking is also Super Admin only (when the server says who is acting).
create function check_user_permission_revoke() returns trigger
language plpgsql as $$
begin
  if current_actor() is not null
     and (select role from users where id = current_actor()) is distinct from 'super_admin' then
    raise exception 'Only a Super Admin can revoke Admin permissions' using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;
create trigger user_permissions_revoke_rule before delete on user_permissions
  for each row execute function check_user_permission_revoke();

-- ---------------------------------------------------------------------------------------------
-- Rules for changing users (D8, P1)
-- ---------------------------------------------------------------------------------------------
create function check_user_change() returns trigger
language plpgsql as $$
declare
  v_actor       uuid := current_actor();
  v_actor_role  user_role;
begin
  if v_actor is not null and (new.role is distinct from old.role or new.status is distinct from old.status) then
    if v_actor = new.id then
      raise exception 'You cannot change your own role or status' using errcode = 'insufficient_privilege';
    end if;
    select role into v_actor_role from users where id = v_actor and status = 'approved';
    if v_actor_role is distinct from 'super_admin' and (
         new.role in ('super_admin', 'admin') or old.role in ('super_admin', 'admin')) then
      raise exception 'Only a Super Admin can create, change or disable Admins' using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- there must always be at least one approved Super Admin
  if old.role = 'super_admin' and old.status = 'approved'
     and (new.role is distinct from 'super_admin' or new.status <> 'approved')
     and not exists (select 1 from users where id <> old.id and role = 'super_admin' and status = 'approved') then
    raise exception 'The last Super Admin cannot be demoted or disabled' using errcode = 'check_violation';
  end if;

  if new.status = 'approved' and old.status <> 'approved' then
    new.approved_by := coalesce(new.approved_by, v_actor);
    new.approved_at := coalesce(new.approved_at, now());
  end if;
  return new;
end;
$$;
create trigger users_change_rules before update on users
  for each row execute function check_user_change();

-- Users are disabled, never deleted (their name stays on the history they created).
create trigger users_no_delete before delete on users for each row execute function forbid_change();

-- ---------------------------------------------------------------------------------------------
-- Audit log — written automatically by triggers, insert-only
-- ---------------------------------------------------------------------------------------------
create table audit_log (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  actor_id     uuid references users (id) on delete restrict,
  action       text not null,
  entity_type  text not null,
  entity_id    text,
  before       jsonb,
  after        jsonb
);
create index audit_log_entity_idx on audit_log (entity_type, entity_id, occurred_at);
create index audit_log_actor_idx  on audit_log (actor_id, occurred_at);

create function audit_row() returns trigger
language plpgsql as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    current_actor(),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'unit_id', v_row ->> 'user_id'),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'users', 'user_permissions', 'categories', 'suppliers', 'products', 'batches', 'batch_lines',
    'units', 'sim_details', 'sim_assignments', 'clients', 'partners', 'partner_contacts',
    'repair_companies', 'facilities', 'facility_contacts', 'deployments', 'deployment_items',
    'shipments', 'shipment_items', 'stock_movements'
  ] loop
    execute format('create trigger %I after insert or update or delete on %I
                    for each row execute function audit_row()', t || '_audit', t);
  end loop;
end;
$$;

create trigger audit_log_insert_only before update or delete on audit_log
  for each row execute function forbid_change();

alter table permissions      enable row level security;
alter table role_permissions enable row level security;
alter table user_permissions enable row level security;
alter table audit_log        enable row level security;
