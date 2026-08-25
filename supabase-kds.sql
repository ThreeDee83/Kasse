-- Einmalig im Supabase SQL Editor ausführen.
-- Erstellt die Echtzeit-Datenbasis für das OwnCash Kitchen Display System (KDS).

alter table public.locations
add column if not exists kds_enabled boolean not null default true;

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

-- NULL steht für eine KDS-Bestellung, die bewusst ohne Pager angelegt wurde.
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

alter table public.kds_orders enable row level security;
alter table public.kds_orders replica identity full;

drop policy if exists "members read kds orders" on public.kds_orders;
drop policy if exists "members insert kds orders" on public.kds_orders;
drop policy if exists "members update kds orders" on public.kds_orders;
drop policy if exists "admins delete kds orders" on public.kds_orders;

create policy "members read kds orders"
on public.kds_orders for select
using (public.is_location_member(location_id) or public.is_any_admin());

create policy "members insert kds orders"
on public.kds_orders for insert
with check (public.is_location_member(location_id));

create policy "members update kds orders"
on public.kds_orders for update
using (public.is_location_member(location_id))
with check (public.is_location_member(location_id));

create policy "admins delete kds orders"
on public.kds_orders for delete
using (public.is_any_admin());

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

revoke all on function public.set_kds_enabled(uuid, boolean) from public;
grant execute on function public.set_kds_enabled(uuid, boolean) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.kds_orders;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.locations;
exception when duplicate_object then null;
end $$;
