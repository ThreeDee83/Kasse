-- Einmalig im Supabase SQL Editor ausführen.
-- Persönliche 4-stellige Mitarbeiter-PINs werden ausschließlich als Hash gespeichert.

create extension if not exists pgcrypto;

alter table public.employees
add column if not exists pin_configured boolean not null default false;

create table if not exists public.employee_pins (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.employee_pins enable row level security;
revoke all on table public.employee_pins from anon, authenticated;

drop function if exists public.save_employee_with_pin(uuid, uuid, text, numeric, boolean, text, boolean);

create or replace function public.save_employee_with_pin(
  target_employee uuid,
  target_location uuid,
  employee_name text,
  employee_hourly_rate numeric,
  employee_active boolean,
  employee_pin text default null,
  recalculate_past boolean default false
)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare
  saved_employee uuid;
  cleaned_name text := trim(coalesce(employee_name, ''));
  cleaned_pin text := nullif(trim(coalesce(employee_pin, '')), '');
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_any_admin() then raise exception 'Admin role required'; end if;
  if cleaned_name = '' then raise exception 'Mitarbeitername fehlt'; end if;
  if employee_hourly_rate is null or employee_hourly_rate < 0 then raise exception 'Ungültiger Stundensatz'; end if;
  if cleaned_pin is not null and cleaned_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN muss genau vier Ziffern haben';
  end if;
  if cleaned_pin is not null then
    perform pg_advisory_xact_lock(hashtextextended('owncash-employee-pin', 0));
    if exists (
      select 1 from employee_pins
      where (target_employee is null or employee_id <> target_employee)
        and crypt(cleaned_pin, pin_hash) = pin_hash
    ) then
      raise exception 'Dieser PIN ist bereits einem anderen Mitarbeiter zugewiesen';
    end if;
  end if;

  if target_employee is null then
    if cleaned_pin is null then raise exception 'Für neue Mitarbeiter ist eine PIN erforderlich'; end if;
    insert into employees (location_id, name, hourly_rate, active, pin_configured)
    values (target_location, cleaned_name, employee_hourly_rate, coalesce(employee_active, true), true)
    returning id into saved_employee;
  else
    if not exists (select 1 from employees where id = target_employee) then
      raise exception 'Mitarbeiter nicht verfügbar';
    end if;
    update employees
    set name = cleaned_name,
        hourly_rate = employee_hourly_rate,
        active = coalesce(employee_active, true),
        pin_configured = pin_configured or cleaned_pin is not null
    where id = target_employee;
    saved_employee := target_employee;
  end if;

  if cleaned_pin is not null then
    insert into employee_pins (employee_id, pin_hash, updated_at)
    values (saved_employee, crypt(cleaned_pin, gen_salt('bf')), now())
    on conflict (employee_id) do update
    set pin_hash = excluded.pin_hash, updated_at = excluded.updated_at;
    update employees set pin_configured = true where id = saved_employee;
  end if;

  if target_employee is not null and recalculate_past then
    update time_entries
    set hourly_rate = employee_hourly_rate
    where employee_id = saved_employee
      and clock_in >= now() - interval '2 months';
  end if;

  return saved_employee;
end $$;

drop function if exists public.clock_in_employee(uuid);
drop function if exists public.clock_in_employee(uuid, uuid);
drop function if exists public.clock_in_employee(uuid, uuid, text);

create or replace function public.clock_in_employee(target_employee uuid, target_location uuid, employee_pin text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare
  new_entry uuid;
  stored_pin_hash text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_location_member(target_location) then raise exception 'Standortzugriff erforderlich'; end if;
  if not exists (select 1 from employees where id = target_employee and active = true) then
    raise exception 'Mitarbeiter nicht verfügbar';
  end if;
  select pin_hash into stored_pin_hash from employee_pins where employee_id = target_employee;
  if stored_pin_hash is null then raise exception 'Für diesen Mitarbeiter ist noch keine PIN eingerichtet'; end if;
  if employee_pin is null or employee_pin !~ '^[0-9]{4}$' or crypt(employee_pin, stored_pin_hash) <> stored_pin_hash then
    raise exception 'PIN ist falsch';
  end if;
  if exists (select 1 from time_entries where employee_id = target_employee and clock_out is null) then
    raise exception 'Mitarbeiter ist bereits eingestempelt';
  end if;

  insert into time_entries (location_id, employee_id, hourly_rate, clock_in, created_by)
  select target_location, employee.id, employee.hourly_rate, now(), auth.uid()
  from employees employee
  where employee.id = target_employee
  returning id into new_entry;
  return new_entry;
end $$;

drop function if exists public.clock_out_employee(uuid);
drop function if exists public.clock_out_employee(uuid, text);

create or replace function public.clock_out_employee(target_employee uuid, employee_pin text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare
  open_entry uuid;
  stored_pin_hash text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_business_user() then raise exception 'Kein Standortzugriff'; end if;
  if not exists (select 1 from employees where id = target_employee) then raise exception 'Mitarbeiter nicht verfügbar'; end if;
  select pin_hash into stored_pin_hash from employee_pins where employee_id = target_employee;
  if stored_pin_hash is null then raise exception 'Für diesen Mitarbeiter ist noch keine PIN eingerichtet'; end if;
  if employee_pin is null or employee_pin !~ '^[0-9]{4}$' or crypt(employee_pin, stored_pin_hash) <> stored_pin_hash then
    raise exception 'PIN ist falsch';
  end if;

  select id into open_entry
  from time_entries
  where employee_id = target_employee and clock_out is null
  order by clock_in desc
  limit 1;
  if open_entry is null then raise exception 'Mitarbeiter ist nicht eingestempelt'; end if;

  update time_entries set clock_out = now() where id = open_entry;
  return open_entry;
end $$;

revoke all on function public.save_employee_with_pin(uuid, uuid, text, numeric, boolean, text, boolean) from public;
revoke all on function public.clock_in_employee(uuid, uuid, text) from public;
revoke all on function public.clock_out_employee(uuid, text) from public;
grant execute on function public.save_employee_with_pin(uuid, uuid, text, numeric, boolean, text, boolean) to authenticated;
grant execute on function public.clock_in_employee(uuid, uuid, text) to authenticated;
grant execute on function public.clock_out_employee(uuid, text) to authenticated;
