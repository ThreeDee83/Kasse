create extension if not exists pgcrypto;

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kds_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.locations
add column if not exists kds_enabled boolean not null default true;

create table if not exists public.user_locations (
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  role text not null default 'staff' check (role in ('admin', 'staff')),
  created_at timestamptz not null default now(),
  primary key (user_id, location_id)
);

create table if not exists public.location_state (
  location_id uuid primary key references public.locations(id) on delete cascade,
  data jsonb not null default '{"categories":[],"products":[]}'::jsonb,
  settings jsonb not null default '{"theme":"dark","billingEmail":"","billingEmail2":""}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.location_state drop column if exists views;

create table if not exists public.sales (
  id text primary key,
  location_id uuid not null references public.locations(id) on delete cascade,
  timestamp timestamptz not null,
  total numeric(12,2) not null default 0,
  items jsonb not null default '[]'::jsonb
);

create table if not exists public.kds_orders (
  id uuid primary key default gen_random_uuid(),
  sale_id text not null unique references public.sales(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  pager_number text,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (completed_at is null or completed_at >= received_at)
);

alter table public.kds_orders alter column pager_number drop not null;
alter table public.kds_orders drop constraint if exists kds_orders_pager_number_check;
alter table public.kds_orders add constraint kds_orders_pager_number_check
check (pager_number is null or pager_number ~ '^[0-9]{1,6}$');

create index if not exists kds_orders_open_location_time_idx
on public.kds_orders (location_id, received_at)
where completed_at is null;

create index if not exists kds_orders_done_location_time_idx
on public.kds_orders (location_id, completed_at desc)
where completed_at is not null;

create table if not exists public.cash_balances (
  location_id uuid not null references public.locations(id) on delete cascade,
  date_key date not null,
  balance numeric(12,2) not null default 0,
  primary key (location_id, date_key)
);

create table if not exists public.report_submissions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  business_date date not null,
  report_type text not null default 'daily' check (report_type in ('daily', 'total')),
  sales jsonb not null default '[]'::jsonb,
  catalog jsonb not null default '{"categories":[],"products":[]}'::jsonb,
  cash_balance numeric(12,2),
  submitted_by uuid references auth.users(id) on delete set null default auth.uid(),
  submitted_at timestamptz not null default now(),
  unique (location_id, business_date)
);

alter table public.report_submissions add column if not exists report_type text not null default 'daily';
alter table public.report_submissions drop constraint if exists report_submissions_report_type_check;
alter table public.report_submissions add constraint report_submissions_report_type_check check (report_type in ('daily', 'total'));
alter table public.report_submissions drop constraint if exists report_submissions_location_id_business_date_key;
create unique index if not exists report_submissions_location_date_type_key
on public.report_submissions (location_id, business_date, report_type);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id) on delete set null,
  name text not null,
  hourly_rate numeric(10,2) not null default 0 check (hourly_rate >= 0),
  active boolean not null default true,
  pin_configured boolean not null default false,
  created_at timestamptz not null default now(),
  unique (location_id, name)
);

alter table public.employees add column if not exists pin_configured boolean not null default false;

create table if not exists public.employee_pins (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id) on delete set null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  hourly_rate numeric(10,2) not null default 0 check (hourly_rate >= 0),
  clock_in timestamptz not null,
  clock_out timestamptz,
  note text not null default '',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (clock_out is null or clock_out > clock_in)
);

create unique index if not exists one_open_time_entry_per_employee
on public.time_entries (employee_id)
where clock_out is null;

create table if not exists public.employee_bonuses (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id) on delete set null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  date_key date not null,
  amount numeric(10,2) not null default 0 check (amount >= 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (employee_id, date_key)
);

alter table public.employees alter column location_id drop not null;
alter table public.employees drop constraint if exists employees_location_id_fkey;
alter table public.employees add constraint employees_location_id_fkey foreign key (location_id) references public.locations(id) on delete set null;
alter table public.time_entries alter column location_id drop not null;
alter table public.time_entries drop constraint if exists time_entries_location_id_fkey;
alter table public.time_entries add constraint time_entries_location_id_fkey foreign key (location_id) references public.locations(id) on delete set null;
alter table public.time_entries add column if not exists hourly_rate numeric(10,2);
alter table public.time_entries add column if not exists note text not null default '';
update public.time_entries entry
set hourly_rate = employee.hourly_rate
from public.employees employee
where employee.id = entry.employee_id
  and entry.hourly_rate is null;
alter table public.time_entries alter column hourly_rate set default 0;
alter table public.time_entries alter column hourly_rate set not null;
alter table public.time_entries drop constraint if exists time_entries_hourly_rate_check;
alter table public.time_entries add constraint time_entries_hourly_rate_check check (hourly_rate >= 0);
alter table public.employee_bonuses alter column location_id drop not null;
alter table public.employee_bonuses drop constraint if exists employee_bonuses_location_id_fkey;
alter table public.employee_bonuses add constraint employee_bonuses_location_id_fkey foreign key (location_id) references public.locations(id) on delete set null;

do $$
declare
  punsch_location uuid;
  bar_location uuid;
  first_user uuid;
begin
  insert into public.locations(name)
  select 'Punschhütte'
  where not exists (select 1 from public.locations where lower(trim(name)) in ('punschhütte', 'punschhuette'));

  insert into public.locations(name)
  select 'Bar'
  where not exists (select 1 from public.locations where lower(trim(name)) = 'bar');

  select id into punsch_location
  from public.locations
  where lower(trim(name)) in ('punschhütte', 'punschhuette')
  order by created_at
  limit 1;

  select id into bar_location
  from public.locations
  where lower(trim(name)) = 'bar'
  order by created_at
  limit 1;

  insert into public.location_state(location_id)
  select id from public.locations
  where id in (punsch_location, bar_location)
  on conflict (location_id) do nothing;

  insert into public.user_locations(user_id, location_id, role)
  select id, punsch_location, 'staff'
  from auth.users
  where lower(email) = 'ph@standl.at' and punsch_location is not null
  on conflict (user_id, location_id) do update set role = 'staff';

  insert into public.user_locations(user_id, location_id, role)
  select id, bar_location, 'staff'
  from auth.users
  where lower(email) = 'bar@standl.at' and bar_location is not null
  on conflict (user_id, location_id) do update set role = 'staff';

  update public.user_locations membership
  set role = 'staff'
  from auth.users account
  where account.id = membership.user_id
    and lower(account.email) in ('ph@standl.at', 'bar@standl.at');

  delete from public.user_locations membership
  using auth.users account
  where account.id = membership.user_id
    and (
      (lower(account.email) = 'ph@standl.at' and membership.location_id <> punsch_location)
      or
      (lower(account.email) = 'bar@standl.at' and membership.location_id <> bar_location)
    );

  insert into public.user_locations(user_id, location_id, role)
  select account.id, location.id, 'admin'
  from auth.users account
  cross join public.locations location
  where lower(account.email) = 'admin@standl.at'
  on conflict (user_id, location_id) do update set role = 'admin';

  if not exists (
    select 1 from public.user_locations where role = 'admin'
  ) then
    select id into first_user
    from auth.users
    where lower(coalesce(email, '')) not in ('ph@standl.at', 'bar@standl.at')
    order by created_at, id
    limit 1;

    if first_user is not null then
      insert into public.user_locations(user_id, location_id, role)
      select first_user, id, 'admin'
      from public.locations
      on conflict (user_id, location_id) do update set role = 'admin';
    end if;
  end if;

  delete from public.locations location
  where lower(trim(location.name)) = 'hauptstandort'
    and not exists (select 1 from public.sales sale where sale.location_id = location.id)
    and not exists (select 1 from public.cash_balances cash where cash.location_id = location.id)
    and not exists (select 1 from public.time_entries entry where entry.location_id = location.id)
    and not exists (select 1 from public.employee_bonuses bonus where bonus.location_id = location.id);
end $$;

alter table public.employees drop constraint if exists employees_location_id_name_key;

do $$
declare
  employee_group record;
  duplicate_employee record;
  duplicate_bonus record;
  existing_bonus uuid;
  newest_open_entry uuid;
  newest_open_time timestamptz;
begin
  for employee_group in
    select
      lower(trim(name)) as normalized_name,
      (array_agg(id order by created_at, id))[1] as keeper_id
    from public.employees
    group by lower(trim(name))
    having count(*) > 1
  loop
    select entry.id, entry.clock_in
      into newest_open_entry, newest_open_time
    from public.time_entries entry
    join public.employees employee on employee.id = entry.employee_id
    where lower(trim(employee.name)) = employee_group.normalized_name
      and entry.clock_out is null
    order by entry.clock_in desc
    limit 1;

    if newest_open_entry is not null then
      update public.time_entries entry
      set clock_out = greatest(entry.clock_in + interval '1 second', newest_open_time)
      from public.employees employee
      where employee.id = entry.employee_id
        and lower(trim(employee.name)) = employee_group.normalized_name
        and entry.clock_out is null
        and entry.id <> newest_open_entry;
    end if;

    for duplicate_employee in
      select id
      from public.employees
      where lower(trim(name)) = employee_group.normalized_name
        and id <> employee_group.keeper_id
    loop
      update public.time_entries
      set employee_id = employee_group.keeper_id
      where employee_id = duplicate_employee.id;

      for duplicate_bonus in
        select id, date_key, amount, note
        from public.employee_bonuses
        where employee_id = duplicate_employee.id
      loop
        select id into existing_bonus
        from public.employee_bonuses
        where employee_id = employee_group.keeper_id
          and date_key = duplicate_bonus.date_key;

        if existing_bonus is null then
          update public.employee_bonuses
          set employee_id = employee_group.keeper_id
          where id = duplicate_bonus.id;
        else
          update public.employee_bonuses
          set
            amount = amount + duplicate_bonus.amount,
            note = concat_ws(' · ', nullif(note, ''), nullif(duplicate_bonus.note, ''))
          where id = existing_bonus;
          delete from public.employee_bonuses where id = duplicate_bonus.id;
        end if;
      end loop;

      delete from public.employees where id = duplicate_employee.id;
    end loop;
  end loop;
end $$;

create unique index if not exists employees_normalized_name_key
on public.employees (lower(trim(name)));

create or replace function public.is_location_member(target_location uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from user_locations where user_id = auth.uid() and location_id = target_location) $$;

create or replace function public.is_location_admin(target_location uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from user_locations where user_id = auth.uid() and role = 'admin') $$;

create or replace function public.is_business_user()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from user_locations where user_id = auth.uid()) $$;

create or replace function public.is_any_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from user_locations where user_id = auth.uid() and role = 'admin') $$;

create or replace function public.set_kds_enabled(target_location uuid, enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_location_member(target_location) and not public.is_any_admin() then
    raise exception 'Location access required';
  end if;
  update public.locations
  set kds_enabled = coalesce(enabled, true)
  where id = target_location;
  if not found then raise exception 'Location not found'; end if;
  return coalesce(enabled, true);
end;
$$;

create or replace function public.ensure_admin_access()
returns integer language plpgsql security definer set search_path = public
as $$
declare affected_rows integer := 0;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if lower(coalesce(auth.jwt()->>'email', '')) <> 'admin@standl.at' then
    raise exception 'Admin role required';
  end if;

  insert into user_locations (user_id, location_id, role)
  select auth.uid(), id, 'admin' from locations
  on conflict (user_id, location_id) do update set role = 'admin';
  get diagnostics affected_rows = row_count;
  return affected_rows;
end $$;

update public.user_locations membership
set role = 'admin'
where membership.role <> 'admin'
  and exists (
    select 1
    from public.user_locations admin_membership
    where admin_membership.user_id = membership.user_id
      and admin_membership.role = 'admin'
  );

create or replace function public.sync_location_memberships()
returns integer language plpgsql security definer set search_path = public
as $$
declare affected_rows integer := 0;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from user_locations where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Admin role required';
  end if;

  with administrators as (
    select distinct memberships.user_id
    from user_locations memberships
    where memberships.role = 'admin'
  ),
  synchronized as (
    insert into user_locations (user_id, location_id, role)
    select administrators.user_id, locations.id, 'admin'
    from administrators
    cross join locations
    on conflict (user_id, location_id) do update
      set role = 'admin'
    returning 1
  )
  select count(*) into affected_rows from synchronized;

  return affected_rows;
end $$;

create or replace function public.sync_catalog_to_all_locations(catalog_data jsonb)
returns integer language plpgsql security definer set search_path = public
as $$
declare affected_rows integer := 0;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from user_locations where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Admin role required';
  end if;
  if catalog_data is null
    or jsonb_typeof(catalog_data->'categories') <> 'array'
    or jsonb_typeof(catalog_data->'products') <> 'array'
  then
    raise exception 'Invalid catalog data';
  end if;

  insert into location_state (location_id, data, updated_at)
  select id, catalog_data, now()
  from locations
  on conflict (location_id) do update
    set data = excluded.data,
        updated_at = excluded.updated_at;

  get diagnostics affected_rows = row_count;
  perform public.sync_location_memberships();
  return affected_rows;
end $$;

create or replace function public.sync_master_data(catalog_data jsonb, employee_data jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  affected_locations integer := 0;
  affected_employees integer := 0;
  employee_record jsonb;
  employee_name text;
  employee_rate numeric(10,2);
  employee_active boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from user_locations where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Admin role required';
  end if;
  if catalog_data is null
    or jsonb_typeof(catalog_data->'categories') <> 'array'
    or jsonb_typeof(catalog_data->'products') <> 'array'
    or employee_data is null
    or jsonb_typeof(employee_data) <> 'array'
  then
    raise exception 'Invalid master data';
  end if;

  insert into location_state (location_id, data, updated_at)
  select id, catalog_data, now() from locations
  on conflict (location_id) do update
    set data = excluded.data, updated_at = excluded.updated_at;
  get diagnostics affected_locations = row_count;

  for employee_record in select value from jsonb_array_elements(employee_data)
  loop
    employee_name := trim(coalesce(employee_record->>'name', ''));
    employee_rate := greatest(0, coalesce((employee_record->>'hourlyRate')::numeric, 0));
    employee_active := coalesce((employee_record->>'active')::boolean, true);
    if employee_name <> '' then
      update employees
      set name = employee_name, hourly_rate = employee_rate, active = employee_active
      where lower(trim(name)) = lower(employee_name);
      if not found then
        insert into employees (location_id, name, hourly_rate, active)
        values (null, employee_name, employee_rate, employee_active);
      end if;
      affected_employees := affected_employees + 1;
    end if;
  end loop;

  perform public.sync_location_memberships();
  return jsonb_build_object('locations', affected_locations, 'employees', affected_employees);
end $$;

create or replace function public.create_location(location_name text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if exists (select 1 from locations)
    and not exists (
      select 1 from user_locations where user_id = auth.uid() and role = 'admin'
    )
  then
    raise exception 'Admin role required';
  end if;
  insert into locations(name) values (trim(location_name)) returning id into new_id;
  insert into user_locations(user_id, location_id, role) values (auth.uid(), new_id, 'admin');
  insert into location_state(location_id) values (new_id);
  perform public.sync_location_memberships();
  return new_id;
end $$;

create or replace function public.delete_location(target_location uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_location_admin(target_location) then
    raise exception 'Admin role required';
  end if;
  if not exists (
    select 1
    from user_locations
    where user_id = auth.uid() and location_id <> target_location
  ) then
    raise exception 'Der letzte Standort kann nicht gelöscht werden';
  end if;

  delete from locations where id = target_location;
end $$;

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
  if not public.is_location_member(target_location) then
    raise exception 'Standortzugriff erforderlich';
  end if;
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

revoke all on function public.is_location_member(uuid) from public;
revoke all on function public.is_location_admin(uuid) from public;
revoke all on function public.is_business_user() from public;
revoke all on function public.is_any_admin() from public;
revoke all on function public.set_kds_enabled(uuid, boolean) from public;
revoke all on function public.ensure_admin_access() from public;
revoke all on function public.create_location(text) from public;
revoke all on function public.delete_location(uuid) from public;
revoke all on function public.sync_location_memberships() from public;
revoke all on function public.sync_catalog_to_all_locations(jsonb) from public;
revoke all on function public.sync_master_data(jsonb, jsonb) from public;
revoke all on function public.save_employee_with_pin(uuid, uuid, text, numeric, boolean, text, boolean) from public;
revoke all on function public.clock_in_employee(uuid, uuid, text) from public;
revoke all on function public.clock_out_employee(uuid, text) from public;
grant execute on function public.is_location_member(uuid) to authenticated;
grant execute on function public.is_location_admin(uuid) to authenticated;
grant execute on function public.is_business_user() to authenticated;
grant execute on function public.is_any_admin() to authenticated;
grant execute on function public.set_kds_enabled(uuid, boolean) to authenticated;
grant execute on function public.ensure_admin_access() to authenticated;
grant execute on function public.create_location(text) to authenticated;
grant execute on function public.delete_location(uuid) to authenticated;
grant execute on function public.sync_location_memberships() to authenticated;
grant execute on function public.sync_catalog_to_all_locations(jsonb) to authenticated;
grant execute on function public.sync_master_data(jsonb, jsonb) to authenticated;
grant execute on function public.save_employee_with_pin(uuid, uuid, text, numeric, boolean, text, boolean) to authenticated;
grant execute on function public.clock_in_employee(uuid, uuid, text) to authenticated;
grant execute on function public.clock_out_employee(uuid, text) to authenticated;

alter table public.locations enable row level security;
alter table public.user_locations enable row level security;
alter table public.location_state enable row level security;
alter table public.sales enable row level security;
alter table public.kds_orders enable row level security;
alter table public.cash_balances enable row level security;
alter table public.report_submissions enable row level security;
alter table public.employees enable row level security;
alter table public.employee_pins enable row level security;
alter table public.time_entries enable row level security;
alter table public.employee_bonuses enable row level security;
alter table public.user_locations replica identity full;
alter table public.locations replica identity full;
alter table public.employees replica identity full;
alter table public.time_entries replica identity full;
alter table public.employee_bonuses replica identity full;
alter table public.report_submissions replica identity full;
alter table public.kds_orders replica identity full;

drop policy if exists "members read locations" on public.locations;
drop policy if exists "admins update locations" on public.locations;
drop policy if exists "users read memberships" on public.user_locations;
drop policy if exists "members read state" on public.location_state;
drop policy if exists "admins insert state" on public.location_state;
drop policy if exists "admins update state" on public.location_state;
drop policy if exists "members read sales" on public.sales;
drop policy if exists "members insert sales" on public.sales;
drop policy if exists "members update queued sales" on public.sales;
drop policy if exists "admins delete sales" on public.sales;
drop policy if exists "members read kds orders" on public.kds_orders;
drop policy if exists "members insert kds orders" on public.kds_orders;
drop policy if exists "members update kds orders" on public.kds_orders;
drop policy if exists "members delete completed kds orders" on public.kds_orders;
drop policy if exists "admins delete kds orders" on public.kds_orders;
drop policy if exists "members read cash" on public.cash_balances;
drop policy if exists "members insert cash" on public.cash_balances;
drop policy if exists "members update cash" on public.cash_balances;
drop policy if exists "admins delete cash" on public.cash_balances;
drop policy if exists "members read submitted reports" on public.report_submissions;
drop policy if exists "members submit reports" on public.report_submissions;
drop policy if exists "members update submitted reports" on public.report_submissions;
drop policy if exists "admins delete submitted reports" on public.report_submissions;
drop policy if exists "members read employees" on public.employees;
drop policy if exists "admins insert employees" on public.employees;
drop policy if exists "admins update employees" on public.employees;
drop policy if exists "admins delete employees" on public.employees;
drop policy if exists "members read time entries" on public.time_entries;
drop policy if exists "admins insert time entries" on public.time_entries;
drop policy if exists "admins update time entries" on public.time_entries;
drop policy if exists "admins delete time entries" on public.time_entries;
drop policy if exists "admins read bonuses" on public.employee_bonuses;
drop policy if exists "admins insert bonuses" on public.employee_bonuses;
drop policy if exists "admins update bonuses" on public.employee_bonuses;
drop policy if exists "admins delete bonuses" on public.employee_bonuses;

create policy "members read locations" on public.locations for select using (is_location_member(id) or is_any_admin());
create policy "admins update locations" on public.locations for update using (is_any_admin()) with check (is_any_admin());
create policy "users read memberships" on public.user_locations for select using (user_id = auth.uid() or is_location_admin(location_id));
create policy "members read state" on public.location_state for select using (is_location_member(location_id));
create policy "admins insert state" on public.location_state for insert with check (is_location_admin(location_id));
create policy "admins update state" on public.location_state for update using (is_location_admin(location_id));
create policy "members read sales" on public.sales for select using (is_location_member(location_id) or is_any_admin());
create policy "members insert sales" on public.sales for insert with check (is_location_member(location_id));
create policy "members update queued sales" on public.sales for update using (is_location_member(location_id));
create policy "admins delete sales" on public.sales for delete using (is_location_admin(location_id));
create policy "members read kds orders" on public.kds_orders for select using (is_location_member(location_id) or is_any_admin());
create policy "members insert kds orders" on public.kds_orders for insert with check (is_location_member(location_id));
create policy "members update kds orders" on public.kds_orders for update using (is_location_member(location_id)) with check (is_location_member(location_id));
create policy "members delete completed kds orders" on public.kds_orders for delete using (completed_at is not null and is_location_member(location_id));
create policy "admins delete kds orders" on public.kds_orders for delete using (is_any_admin());
create policy "members read cash" on public.cash_balances for select using (is_location_member(location_id) or is_any_admin());
create policy "members insert cash" on public.cash_balances for insert with check (is_location_member(location_id));
create policy "members update cash" on public.cash_balances for update using (is_location_member(location_id));
create policy "admins delete cash" on public.cash_balances for delete using (is_location_admin(location_id));
create policy "members read submitted reports" on public.report_submissions for select using (is_location_member(location_id) or is_any_admin());
create policy "members submit reports" on public.report_submissions for insert with check (is_location_member(location_id));
create policy "members update submitted reports" on public.report_submissions for update using (is_location_member(location_id)) with check (is_location_member(location_id));
create policy "admins delete submitted reports" on public.report_submissions for delete using (is_any_admin());
create policy "members read employees" on public.employees for select using (is_business_user());
create policy "admins insert employees" on public.employees for insert with check (is_any_admin());
create policy "admins update employees" on public.employees for update using (is_any_admin()) with check (is_any_admin());
create policy "admins delete employees" on public.employees for delete using (is_any_admin());
revoke all on table public.employee_pins from anon, authenticated;
create policy "members read time entries" on public.time_entries for select using (is_business_user());
create policy "admins insert time entries" on public.time_entries for insert with check (is_any_admin());
create policy "admins update time entries" on public.time_entries for update using (is_any_admin()) with check (is_any_admin());
create policy "admins delete time entries" on public.time_entries for delete using (is_any_admin());
create policy "admins read bonuses" on public.employee_bonuses for select using (is_any_admin());
create policy "admins insert bonuses" on public.employee_bonuses for insert with check (is_any_admin());
create policy "admins update bonuses" on public.employee_bonuses for update using (is_any_admin()) with check (is_any_admin());
create policy "admins delete bonuses" on public.employee_bonuses for delete using (is_any_admin());

do $$
begin
  alter publication supabase_realtime add table public.location_state;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.sales;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.kds_orders;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.cash_balances;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.report_submissions;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.user_locations;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.locations;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.employees;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.time_entries;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.employee_bonuses;
exception when duplicate_object then null;
end $$;
-- Offline-Neustart und Offline-Stempeluhr
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
