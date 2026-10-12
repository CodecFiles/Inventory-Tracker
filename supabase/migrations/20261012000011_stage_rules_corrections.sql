-- Migration 0011 — facility stage rules and Super Admin corrections (owner decision R12, 2026-10-12)
--
-- Stages run: site_inspection -> bms_scan -> poc -> poc_study -> contract -> deployment
--             -> active_operations, and closed (POC not converted) at any time.
--   * forward one step: allowed
--   * forward, skipping steps: allowed with a reason (the note)
--   * backward, or re-opening a closed facility: only an Admin or Super Admin, with a reason
-- The server sends the reason with set_config('app.stage_note', ..., true); it is kept in the
-- stage history next to who made the change.
--
-- Corrections (stock_movements of type 'correction') fix mistakes and may move anything anywhere,
-- so only a Super Admin may record one.

create function check_stage_change() returns trigger
language plpgsql as $$
declare
  v_from  integer := array_position(enum_range(null::facility_stage), old.stage);
  v_to    integer := array_position(enum_range(null::facility_stage), new.stage);
  v_role  user_role := (select role from users where id = current_actor());
  v_note  text := nullif(trim(current_setting('app.stage_note', true)), '');
begin
  if new.stage = old.stage or (new.stage = 'closed') then
    return new;
  end if;
  if old.stage <> 'closed' and v_to > v_from then
    if v_to - v_from > 1 and v_note is null then
      raise exception 'Skipping stages needs a reason' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  -- backward, or re-opening a closed facility
  if v_role is null or v_role not in ('admin', 'super_admin') then
    raise exception 'Only an Admin can move a facility back to an earlier stage' using errcode = 'insufficient_privilege';
  end if;
  if v_note is null then
    raise exception 'Moving a facility back needs a reason' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger facilities_stage_rules before update of stage on facilities
  for each row execute function check_stage_change();

-- Stage history now keeps the reason (replaces the 0002 version).
create or replace function record_stage_change() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    insert into facility_stage_history (facility_id, from_stage, to_stage, changed_by, note)
    values (new.id, case when tg_op = 'UPDATE' then old.stage end, new.stage,
            nullif(current_setting('app.user_id', true), '')::uuid,
            nullif(trim(current_setting('app.stage_note', true)), ''));
  end if;
  return new;
end;
$$;

create function check_correction_actor() returns trigger
language plpgsql as $$
begin
  if new.movement_type = 'correction'
     and not exists (select 1 from users where id = new.performed_by and role = 'super_admin' and status = 'approved') then
    raise exception 'Only a Super Admin can record a correction' using errcode = 'insufficient_privilege';
  end if;
  if new.movement_type = 'correction' and length(trim(coalesce(new.note, ''))) < 3 then
    raise exception 'A correction needs a reason' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger stock_movements_0_correction_actor before insert on stock_movements
  for each row execute function check_correction_actor();
