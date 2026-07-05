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

create or replace function public.create_location(location_name text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into locations(name) values (trim(location_name)) returning id into new_id;
  insert into user_locations(user_id, location_id, role) values (auth.uid(), new_id, 'admin');
  insert into location_state(location_id) values (new_id);
  return new_id;
end $$;

alter table public.locations enable row level security;
alter table public.user_locations enable row level security;
alter table public.location_state enable row level security;
alter table public.sales enable row level security;
alter table public.cash_balances enable row level security;

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
