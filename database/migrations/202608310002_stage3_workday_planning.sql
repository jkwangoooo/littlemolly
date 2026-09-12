-- Stage 3: workday planning content and execution state. Append-only migration.
alter table public.day_plans
  add column if not exists outfit_ready boolean not null default false,
  add column if not exists meals_ready boolean not null default false,
  add column if not exists supplements_ready boolean not null default false,
  add column if not exists morning_ready boolean not null default false,
  add column if not exists exercise_ready boolean not null default false,
  add column if not exists morning_focus text not null default '',
  add column if not exists morning_completed boolean not null default false,
  add column if not exists exercise_decision text not null default 'undecided' check (exercise_decision in ('undecided','exercise','rest')),
  add column if not exists exercise_content text not null default '',
  add column if not exists exercise_note text not null default '',
  add column if not exists exercise_completed boolean not null default false;

create table if not exists public.daily_meals (
  id uuid primary key default gen_random_uuid(),
  day_plan_id uuid not null references public.day_plans(id) on delete cascade,
  meal_type text not null check (meal_type in ('breakfast','lunch','dinner')),
  plan_content text not null default '',
  note text not null default '',
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(day_plan_id, meal_type)
);

create table if not exists public.custom_tasks (
  id uuid primary key default gen_random_uuid(),
  day_plan_id uuid not null references public.day_plans(id) on delete cascade,
  task_time time not null,
  title text not null,
  note text not null default '',
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists daily_meals_plan_idx on public.daily_meals(day_plan_id);
create index if not exists custom_tasks_plan_time_idx on public.custom_tasks(day_plan_id, task_time);

create or replace function public.reject_historical_stage3_rows()
returns trigger language plpgsql set search_path = public
as $$
declare target_date date;
begin
  if tg_op = 'DELETE' then
    select plan_date into target_date from public.day_plans where id = old.day_plan_id and user_id = (select auth.uid());
  else
    select plan_date into target_date from public.day_plans where id = new.day_plan_id and user_id = (select auth.uid());
  end if;
  if target_date is null then raise exception '无权访问日期计划'; end if;
  if target_date < (now() at time zone 'Asia/Shanghai')::date then raise exception '历史日期不可修改'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists daily_meals_reject_historical on public.daily_meals;
create trigger daily_meals_reject_historical before insert or update or delete on public.daily_meals for each row execute function public.reject_historical_stage3_rows();
drop trigger if exists custom_tasks_reject_historical on public.custom_tasks;
create trigger custom_tasks_reject_historical before insert or update or delete on public.custom_tasks for each row execute function public.reject_historical_stage3_rows();
drop trigger if exists daily_meals_set_updated_at on public.daily_meals;
create trigger daily_meals_set_updated_at before update on public.daily_meals for each row execute function public.set_updated_at();
drop trigger if exists custom_tasks_set_updated_at on public.custom_tasks;
create trigger custom_tasks_set_updated_at before update on public.custom_tasks for each row execute function public.set_updated_at();

alter table public.daily_meals enable row level security;
alter table public.custom_tasks enable row level security;
drop policy if exists daily_meals_select_own on public.daily_meals;
create policy daily_meals_select_own on public.daily_meals for select to authenticated using (exists (select 1 from public.day_plans p where p.id = day_plan_id and p.user_id = (select auth.uid())));
drop policy if exists daily_meals_write_own on public.daily_meals;
create policy daily_meals_write_own on public.daily_meals for all to authenticated using (exists (select 1 from public.day_plans p where p.id = day_plan_id and p.user_id = (select auth.uid()))) with check (exists (select 1 from public.day_plans p where p.id = day_plan_id and p.user_id = (select auth.uid())));
drop policy if exists custom_tasks_select_own on public.custom_tasks;
create policy custom_tasks_select_own on public.custom_tasks for select to authenticated using (exists (select 1 from public.day_plans p where p.id = day_plan_id and p.user_id = (select auth.uid())));
drop policy if exists custom_tasks_write_own on public.custom_tasks;
create policy custom_tasks_write_own on public.custom_tasks for all to authenticated using (exists (select 1 from public.day_plans p where p.id = day_plan_id and p.user_id = (select auth.uid()))) with check (exists (select 1 from public.day_plans p where p.id = day_plan_id and p.user_id = (select auth.uid())));

create or replace function public.copy_yesterday_stage3(target_date date)
returns void language plpgsql security invoker set search_path = public
as $$
declare uid uuid := (select auth.uid()); source_plan day_plans%rowtype; target_plan day_plans%rowtype;
begin
  if uid is null or target_date < (now() at time zone 'Asia/Shanghai')::date then raise exception '目标日期不可复制'; end if;
  select * into source_plan from day_plans where user_id = uid and plan_date = target_date - 1;
  if source_plan.id is null then raise exception '昨天没有可复制的计划'; end if;
  select * into target_plan from day_plans where user_id = uid and plan_date = target_date;
  insert into day_plans(user_id,plan_date,mode,mode_override,morning_focus,exercise_decision,exercise_content,exercise_note)
    values(uid,target_date,coalesce(target_plan.mode, case when extract(isodow from target_date) between 1 and 5 then 'work' else 'rest' end),coalesce(target_plan.mode_override, false),source_plan.morning_focus,source_plan.exercise_decision,source_plan.exercise_content,source_plan.exercise_note)
    on conflict(user_id,plan_date) do update set morning_focus=excluded.morning_focus, exercise_decision=excluded.exercise_decision, exercise_content=excluded.exercise_content, exercise_note=excluded.exercise_note,
      outfit_ready=false, meals_ready=false, supplements_ready=false, morning_ready=false, exercise_ready=false, morning_completed=false, exercise_completed=false;
  select * into target_plan from day_plans where user_id=uid and plan_date=target_date;
  delete from daily_meals where day_plan_id=target_plan.id;
  insert into daily_meals(day_plan_id,meal_type,plan_content,note,completed) select target_plan.id,meal_type,plan_content,note,false from daily_meals where day_plan_id=source_plan.id;
  delete from custom_tasks where day_plan_id=target_plan.id;
  insert into custom_tasks(day_plan_id,task_time,title,note,completed) select target_plan.id,task_time,title,note,false from custom_tasks where day_plan_id=source_plan.id;
end;
$$;
revoke all on function public.copy_yesterday_stage3(date) from public;
grant execute on function public.copy_yesterday_stage3(date) to authenticated;
