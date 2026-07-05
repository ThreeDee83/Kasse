create extension if not exists pgcrypto;

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

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
  settings jsonb not null default '{"theme":"dark","billingEmail":""}'::jsonb,
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

create table if not exists public.cash_balances (
  location_id uuid not null references public.locations(id) on delete cascade,
  date_key date not null,
  balance numeric(12,2) not null default 0,
  primary key (location_id, date_key)
);

create or replace function public.is_location_member(target_location uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from user_locations where user_id = auth.uid() and location_id = target_location) $$;

create or replace function public.is_location_admin(target_location uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from user_locations where user_id = auth.uid() and location_id = target_location and role = 'admin') $$;

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

  with admin_locations as (
    select location_id
    from user_locations
    where user_id = auth.uid() and role = 'admin'
  ),
  shared_members as (
    select
      memberships.user_id,
      case when bool_or(memberships.role = 'admin') then 'admin' else 'staff' end as role
    from user_locations memberships
    join admin_locations on admin_locations.location_id = memberships.location_id
    group by memberships.user_id
  ),
  synchronized as (
    insert into user_locations (user_id, location_id, role)
    select shared_members.user_id, admin_locations.location_id, shared_members.role
    from shared_members
    cross join admin_locations
    on conflict (user_id, location_id) do update
      set role = case
        when user_locations.role = 'admin' or excluded.role = 'admin' then 'admin'
        else 'staff'
      end
    returning 1
  )
  select count(*) into affected_rows from synchronized;

  return affected_rows;
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

revoke all on function public.create_location(text) from public;
revoke all on function public.sync_location_memberships() from public;
grant execute on function public.create_location(text) to authenticated;
grant execute on function public.sync_location_memberships() to authenticated;

alter table public.locations enable row level security;
alter table public.user_locations enable row level security;
alter table public.location_state enable row level security;
alter table public.sales enable row level security;
alter table public.cash_balances enable row level security;
alter table public.user_locations replica identity full;

drop policy if exists "members read locations" on public.locations;
drop policy if exists "users read memberships" on public.user_locations;
drop policy if exists "members read state" on public.location_state;
drop policy if exists "admins insert state" on public.location_state;
drop policy if exists "admins update state" on public.location_state;
drop policy if exists "members read sales" on public.sales;
drop policy if exists "members insert sales" on public.sales;
drop policy if exists "members update queued sales" on public.sales;
drop policy if exists "admins delete sales" on public.sales;
drop policy if exists "members read cash" on public.cash_balances;
drop policy if exists "members insert cash" on public.cash_balances;
drop policy if exists "members update cash" on public.cash_balances;
drop policy if exists "admins delete cash" on public.cash_balances;

create policy "members read locations" on public.locations for select using (is_location_member(id));
create policy "users read memberships" on public.user_locations for select using (user_id = auth.uid() or is_location_admin(location_id));
create policy "members read state" on public.location_state for select using (is_location_member(location_id));
create policy "admins insert state" on public.location_state for insert with check (is_location_admin(location_id));
create policy "admins update state" on public.location_state for update using (is_location_admin(location_id));
create policy "members read sales" on public.sales for select using (is_location_member(location_id));
create policy "members insert sales" on public.sales for insert with check (is_location_member(location_id));
create policy "members update queued sales" on public.sales for update using (is_location_member(location_id));
create policy "admins delete sales" on public.sales for delete using (is_location_admin(location_id));
create policy "members read cash" on public.cash_balances for select using (is_location_member(location_id));
create policy "members insert cash" on public.cash_balances for insert with check (is_location_member(location_id));
create policy "members update cash" on public.cash_balances for update using (is_location_member(location_id));
create policy "admins delete cash" on public.cash_balances for delete using (is_location_admin(location_id));

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
  alter publication supabase_realtime add table public.cash_balances;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.user_locations;
exception when duplicate_object then null;
end $$;
