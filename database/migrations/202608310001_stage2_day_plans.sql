-- Stage 2: private daily mode records. Append-only migration.
create table if not exists public.day_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_date date not null,
  mode text not null check (mode in ('work', 'rest')),
  mode_override boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, plan_date)
);

create index if not exists day_plans_user_date_idx on public.day_plans (user_id, plan_date);

create or replace function public.reject_historical_day_plan()
returns trigger language plpgsql set search_path = public
as $$
declare business_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if (tg_op in ('INSERT', 'UPDATE') and new.plan_date < business_today)
     or (tg_op = 'UPDATE' and old.plan_date < business_today)
     or (tg_op = 'DELETE' and old.plan_date < business_today) then
    raise exception '历史日期不可修改';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists day_plans_reject_historical on public.day_plans;
create trigger day_plans_reject_historical
before insert or update or delete on public.day_plans
for each row execute function public.reject_historical_day_plan();

drop trigger if exists day_plans_set_updated_at on public.day_plans;
create trigger day_plans_set_updated_at before update on public.day_plans
for each row execute function public.set_updated_at();

alter table public.day_plans enable row level security;
drop policy if exists "day_plans_select_own" on public.day_plans;
create policy "day_plans_select_own" on public.day_plans for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "day_plans_insert_own" on public.day_plans;
create policy "day_plans_insert_own" on public.day_plans for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "day_plans_update_own" on public.day_plans;
create policy "day_plans_update_own" on public.day_plans for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "day_plans_delete_own" on public.day_plans;
create policy "day_plans_delete_own" on public.day_plans for delete to authenticated using ((select auth.uid()) = user_id);
