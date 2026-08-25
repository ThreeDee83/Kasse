-- Einmalig im Supabase SQL Editor ausführen.
-- Ermöglicht das sichere Laden der bestehenden bcrypt-PIN-Prüfwerte
-- und die spätere Synchronisierung lokal erfasster Stempelzeiten.

create or replace function public.load_offline_employee_pin_hashes()
returns table(employee_id uuid, pin_hash text)
language sql
security definer
stable
set search_path = public
as $$
  select pins.employee_id, pins.pin_hash
  from public.employee_pins pins
  where auth.uid() is not null
    and public.is_business_user();
$$;

create or replace function public.sync_offline_time_entry(
  target_entry uuid,
  target_employee uuid,
  target_location uuid,
  entry_clock_in timestamptz,
  entry_clock_out timestamptz default null,
  entry_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_rate numeric(10,2);
  employee_active boolean;
  existing_employee uuid;
  existing_location uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if target_entry is null or target_employee is null or target_location is null then
    raise exception 'Unvollständige Offline-Stempelung';
  end if;
  if not public.is_location_member(target_location) then
    raise exception 'Standortzugriff erforderlich';
  end if;
  if entry_clock_in is null
     or entry_clock_in < now() - interval '31 days'
     or entry_clock_in > now() + interval '10 minutes' then
    raise exception 'Ungültiger Einstempelzeitpunkt';
  end if;
  if entry_clock_out is not null
     and (entry_clock_out < entry_clock_in or entry_clock_out > now() + interval '10 minutes') then
    raise exception 'Ungültiger Ausstempelzeitpunkt';
  end if;

  select employees.hourly_rate, employees.active
  into employee_rate, employee_active
  from public.employees
  where employees.id = target_employee;
  if employee_rate is null then raise exception 'Mitarbeiter nicht verfügbar'; end if;
  if entry_clock_out is null and employee_active is not true then
    raise exception 'Mitarbeiter ist nicht aktiv';
  end if;

  select entries.employee_id, entries.location_id
  into existing_employee, existing_location
  from public.time_entries entries
  where entries.id = target_entry;

  if found then
    if existing_employee is distinct from target_employee
       or existing_location is distinct from target_location then
      raise exception 'Stempelung gehört zu einem anderen Mitarbeiter oder Standort';
    end if;
    update public.time_entries
    set clock_out = entry_clock_out,
        note = coalesce(entry_note, '')
    where id = target_entry;
  else
    insert into public.time_entries (
      id, location_id, employee_id, hourly_rate, clock_in, clock_out, note, created_by
    ) values (
      target_entry, target_location, target_employee, employee_rate,
      entry_clock_in, entry_clock_out, coalesce(entry_note, ''), auth.uid()
    );
  end if;

  return target_entry;
end;
$$;

revoke all on function public.load_offline_employee_pin_hashes() from public;
revoke all on function public.sync_offline_time_entry(uuid, uuid, uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.load_offline_employee_pin_hashes() to authenticated;
grant execute on function public.sync_offline_time_entry(uuid, uuid, uuid, timestamptz, timestamptz, text) to authenticated;

