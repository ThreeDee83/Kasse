-- Einmalig im Supabase SQL Editor ausführen.
alter table public.time_entries
add column if not exists note text not null default '';
