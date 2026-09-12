-- Stage 1 only: account profile and a private record used to verify cloud synchronization.
-- This migration is append-only. Apply it through the Supabase SQL Editor or CLI.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_test_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  content text not null check (char_length(trim(content)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sync_test_records_user_updated_idx
  on public.sync_test_records (user_id, updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists sync_test_records_set_updated_at on public.sync_test_records;
create trigger sync_test_records_set_updated_at
before update on public.sync_test_records
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

insert into public.profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.sync_test_records enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "sync_test_records_select_own" on public.sync_test_records;
create policy "sync_test_records_select_own" on public.sync_test_records
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "sync_test_records_insert_own" on public.sync_test_records;
create policy "sync_test_records_insert_own" on public.sync_test_records
for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "sync_test_records_update_own" on public.sync_test_records;
create policy "sync_test_records_update_own" on public.sync_test_records
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "sync_test_records_delete_own" on public.sync_test_records;
create policy "sync_test_records_delete_own" on public.sync_test_records
for delete to authenticated using ((select auth.uid()) = user_id);
