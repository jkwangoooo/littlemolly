-- ============================================================================
-- 幸福小Molly · Supabase 全部迁移（6 个，按文件名顺序合并成单文件）
-- ============================================================================
--
-- 用法：整份复制 → Supabase 控制台 → SQL Editor → 新建查询 → 粘贴 → Run。
--
-- 为什么可以合并：6 个迁移都没有 begin/commit 事务控制，也没有 psql 元命令，
-- 且都用 create ... if not exists / create or replace，可安全顺序执行。
-- 本文件内容 = database/migrations/ 下 6 个原文件逐字拼接（只多了分隔注释）。
-- 想逐个执行的话，直接用 database/migrations/ 下的原文件，效果相同。
--
-- 顺序不能乱：后面的迁移依赖前面建好的表、函数、触发器。
-- ============================================================================


-- ############################################################################
-- ##  202608270001_stage1_auth_sync.sql
-- ############################################################################

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

-- ############################################################################
-- ##  202608310001_stage2_day_plans.sql
-- ############################################################################

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

-- ############################################################################
-- ##  202608310002_stage3_workday_planning.sql
-- ############################################################################

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

-- ############################################################################
-- ##  202609160001_stage4_local_parity.sql
-- ############################################################################

-- Stage 4: 本地对象仓库与云端表的对齐（L6）。**只追加**，不改写任何既有迁移。
--
-- 为什么需要这一批：L6 要求「为本地服务实现等价的 Supabase 适配器」。
-- 前三个迁移只建了 day_plans / daily_meals / custom_tasks 三张业务表，
-- 本地库却有 11 张对象仓库，缺口是：三餐内容项、补剂实例、健身项、休息日家务、三类选项。
-- 云端只要缺一张表，适配器就无法与本地等价，因此这里把它们补齐。
--
-- 两条贯穿全文的原则：
--
-- 1. **云端约束不得比本地更严**。同一个操作在两种后端下必须得到同样的结果，
--    否则「本地能存、云端报错」会变成最难查的一类分歧。因此除了本地同样具备的
--    唯一约束（day_plans 的 user_id+plan_date、daily_meals 的 day_plan_id+meal_type）
--    之外，新表一律不加额外的 unique / not-null-非空 检查；选项的「同名不可重复」
--    与补剂的「时段+名称去重」是服务层职责（local/optionService.ts、local/dayPlanService.ts），
--    由适配器原样复刻，不在数据库层重复实现。
-- 2. **外键一律 on delete set null 或 cascade，绝不 restrict**。本地删选项是硬删除，
--    历史计划靠名称快照独立保存（docs/01 不变量 5）。若外键是 restrict，
--    「删掉一个不再吃的食物」会被历史计划挡住，两种后端行为立刻分叉。

-- ---------------------------------------------------------------- 三类选项

create table if not exists public.food_options (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exercise_options (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplement_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '',
  period text not null check (period in ('morning', 'noon', 'evening')),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists food_options_user_order_idx on public.food_options (user_id, sort_order);
create index if not exists exercise_options_user_order_idx on public.exercise_options (user_id, sort_order);
create index if not exists supplement_templates_user_order_idx on public.supplement_templates (user_id, period, sort_order);

-- ---------------------------------------------------------------- 每日内容与状态

-- 一餐里的一项内容。`food_option_id` 为空表示「没有来源选项」（老库迁移来的自由文本，
-- 或来源选项已被删除）；展示一律用 `food_name_snapshot`，所以删选项不影响历史计划。
create table if not exists public.daily_meal_items (
  id uuid primary key default gen_random_uuid(),
  daily_meal_id uuid not null references public.daily_meals(id) on delete cascade,
  food_option_id uuid references public.food_options(id) on delete set null,
  food_name_snapshot text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- 每日补剂实例：`planned` 是内容（复制计划带走），`completed` 是执行状态（复制不带）。
create table if not exists public.daily_supplements (
  id uuid primary key default gen_random_uuid(),
  day_plan_id uuid not null references public.day_plans(id) on delete cascade,
  name_snapshot text not null default '',
  period text not null check (period in ('morning', 'noon', 'evening')),
  planned boolean not null default true,
  completed boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_exercise_items (
  id uuid primary key default gen_random_uuid(),
  day_plan_id uuid not null references public.day_plans(id) on delete cascade,
  exercise_option_id uuid references public.exercise_options(id) on delete set null,
  name_snapshot text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- 休息日固定家务（拖地 / 洗衣）。它是某一天的每日实例，不是全局模板：
-- 只在正常休息日自动补齐，临时不上班（mode_override）不自动带家务（docs/00 / docs/01 不变量 7）。
create table if not exists public.routine_tasks (
  id uuid primary key default gen_random_uuid(),
  day_plan_id uuid not null references public.day_plans(id) on delete cascade,
  kind text not null check (kind in ('mop', 'laundry')),
  title text not null default '',
  completed boolean not null default false
);

create index if not exists daily_meal_items_meal_idx on public.daily_meal_items (daily_meal_id);
create index if not exists daily_supplements_plan_idx on public.daily_supplements (day_plan_id);
create index if not exists daily_exercise_items_plan_idx on public.daily_exercise_items (day_plan_id);
create index if not exists routine_tasks_plan_idx on public.routine_tasks (day_plan_id);

-- ---------------------------------------------------------------- 历史日期约束

-- 三餐内容项比别的子表多一层：它挂在 daily_meals 上，日期要从 daily_meals 再往上取。
create or replace function public.reject_historical_meal_items()
returns trigger language plpgsql set search_path = public
as $$
declare target_date date;
begin
  if tg_op = 'DELETE' then
    select p.plan_date into target_date
      from public.daily_meals m join public.day_plans p on p.id = m.day_plan_id
      where m.id = old.daily_meal_id and p.user_id = (select auth.uid());
  else
    select p.plan_date into target_date
      from public.daily_meals m join public.day_plans p on p.id = m.day_plan_id
      where m.id = new.daily_meal_id and p.user_id = (select auth.uid());
  end if;
  if target_date is null then raise exception '无权访问日期计划'; end if;
  if target_date < (now() at time zone 'Asia/Shanghai')::date then raise exception '历史日期不可修改'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists daily_meal_items_reject_historical on public.daily_meal_items;
create trigger daily_meal_items_reject_historical
before insert or update or delete on public.daily_meal_items
for each row execute function public.reject_historical_meal_items();

-- 其余三张子表都直接挂 day_plan_id，直接复用 stage3 的判定函数，不再重复实现。
drop trigger if exists daily_supplements_reject_historical on public.daily_supplements;
create trigger daily_supplements_reject_historical
before insert or update or delete on public.daily_supplements
for each row execute function public.reject_historical_stage3_rows();

drop trigger if exists daily_exercise_items_reject_historical on public.daily_exercise_items;
create trigger daily_exercise_items_reject_historical
before insert or update or delete on public.daily_exercise_items
for each row execute function public.reject_historical_stage3_rows();

drop trigger if exists routine_tasks_reject_historical on public.routine_tasks;
create trigger routine_tasks_reject_historical
before insert or update or delete on public.routine_tasks
for each row execute function public.reject_historical_stage3_rows();

-- ---------------------------------------------------------------- updated_at 维护

drop trigger if exists daily_supplements_set_updated_at on public.daily_supplements;
create trigger daily_supplements_set_updated_at before update on public.daily_supplements
for each row execute function public.set_updated_at();

drop trigger if exists food_options_set_updated_at on public.food_options;
create trigger food_options_set_updated_at before update on public.food_options
for each row execute function public.set_updated_at();

drop trigger if exists exercise_options_set_updated_at on public.exercise_options;
create trigger exercise_options_set_updated_at before update on public.exercise_options
for each row execute function public.set_updated_at();

drop trigger if exists supplement_templates_set_updated_at on public.supplement_templates;
create trigger supplement_templates_set_updated_at before update on public.supplement_templates
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- RLS

alter table public.food_options enable row level security;
alter table public.exercise_options enable row level security;
alter table public.supplement_templates enable row level security;
alter table public.daily_meal_items enable row level security;
alter table public.daily_supplements enable row level security;
alter table public.daily_exercise_items enable row level security;
alter table public.routine_tasks enable row level security;

-- 三类选项按 user_id 归属，本人可读写。
drop policy if exists food_options_own on public.food_options;
create policy food_options_own on public.food_options for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists exercise_options_own on public.exercise_options;
create policy exercise_options_own on public.exercise_options for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists supplement_templates_own on public.supplement_templates;
create policy supplement_templates_own on public.supplement_templates for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 子表不存 user_id，归属一律沿父记录推导，与 stage3 的写法保持一致。
drop policy if exists daily_supplements_own on public.daily_supplements;
create policy daily_supplements_own on public.daily_supplements for all to authenticated
using (exists (select 1 from public.day_plans p where p.id = day_plan_id and p.user_id = (select auth.uid())))
with check (exists (select 1 from public.day_plans p where p.id = day_plan_id and p.user_id = (select auth.uid())));

drop policy if exists daily_exercise_items_own on public.daily_exercise_items;
create policy daily_exercise_items_own on public.daily_exercise_items for all to authenticated
using (exists (select 1 from public.day_plans p where p.id = day_plan_id and p.user_id = (select auth.uid())))
with check (exists (select 1 from public.day_plans p where p.id = day_plan_id and p.user_id = (select auth.uid())));

drop policy if exists routine_tasks_own on public.routine_tasks;
create policy routine_tasks_own on public.routine_tasks for all to authenticated
using (exists (select 1 from public.day_plans p where p.id = day_plan_id and p.user_id = (select auth.uid())))
with check (exists (select 1 from public.day_plans p where p.id = day_plan_id and p.user_id = (select auth.uid())));

drop policy if exists daily_meal_items_own on public.daily_meal_items;
create policy daily_meal_items_own on public.daily_meal_items for all to authenticated
using (exists (
  select 1 from public.daily_meals m join public.day_plans p on p.id = m.day_plan_id
  where m.id = daily_meal_id and p.user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.daily_meals m join public.day_plans p on p.id = m.day_plan_id
  where m.id = daily_meal_id and p.user_id = (select auth.uid())
));

-- ---------------------------------------------------------------- 复制昨天

-- 追加而非改写 copy_yesterday_stage3：stage3 的函数保持原样，避免动到既有部署。
-- 与 stage3 的差别是把 L2 之后的四类内容也搬过去——三餐内容项、补剂实例、健身项，
-- 以及自定义事项（stage3 已有）。删除目标日旧记录再重建，与本地 copyYesterday 的
-- 「目标日整体替换」语义一致。
--
-- 有意不碰的两处：
--   * `routine_tasks`——休息日家务由 ensureRestDayRoutines 独立补齐，复制既不搬来源日的，
--     也不动目标日已有的（local/dayPlanService.ts 的 copyYesterday 注释写明了理由）；
--   * 目标日自己的 mode / mode_override——复制内容不改变这一天是工作日还是休息日。
create or replace function public.copy_yesterday_stage4(target_date date)
returns void language plpgsql security invoker set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
  source_plan public.day_plans%rowtype;
  target_plan public.day_plans%rowtype;
  source_meal public.daily_meals%rowtype;
  target_meal_id uuid;
begin
  if uid is null or target_date < (now() at time zone 'Asia/Shanghai')::date then
    raise exception '目标日期不可复制';
  end if;

  select * into source_plan from public.day_plans where user_id = uid and plan_date = target_date - 1;
  if source_plan.id is null then raise exception '昨天没有可复制的计划'; end if;

  select * into target_plan from public.day_plans where user_id = uid and plan_date = target_date;

  -- 主记录：只搬内容，五个准备勾选与两个完成状态一律归零。
  insert into public.day_plans (
    user_id, plan_date, mode, mode_override, morning_focus,
    exercise_decision, exercise_note
  ) values (
    uid, target_date,
    coalesce(target_plan.mode,
      case when extract(isodow from target_date) between 1 and 5 then 'work' else 'rest' end),
    coalesce(target_plan.mode_override, false),
    source_plan.morning_focus, source_plan.exercise_decision, source_plan.exercise_note
  )
  on conflict (user_id, plan_date) do update set
    morning_focus = excluded.morning_focus,
    exercise_decision = excluded.exercise_decision,
    exercise_note = excluded.exercise_note,
    outfit_ready = false, meals_ready = false, supplements_ready = false,
    morning_ready = false, exercise_ready = false,
    morning_completed = false, exercise_completed = false;

  select * into target_plan from public.day_plans where user_id = uid and plan_date = target_date;

  -- 三餐：先按目标日餐次删掉内容项再删餐次，然后照来源日重建。completed 归零。
  delete from public.daily_meal_items
    where daily_meal_id in (select id from public.daily_meals where day_plan_id = target_plan.id);
  delete from public.daily_meals where day_plan_id = target_plan.id;

  for source_meal in select * from public.daily_meals where day_plan_id = source_plan.id loop
    insert into public.daily_meals (day_plan_id, meal_type, note, completed)
    values (target_plan.id, source_meal.meal_type, source_meal.note, false)
    returning id into target_meal_id;

    insert into public.daily_meal_items (daily_meal_id, food_option_id, food_name_snapshot, sort_order)
    select target_meal_id, food_option_id, food_name_snapshot, sort_order
      from public.daily_meal_items where daily_meal_id = source_meal.id;
  end loop;

  -- 补剂：planned 属于内容，照抄；completed 归零。
  delete from public.daily_supplements where day_plan_id = target_plan.id;
  insert into public.daily_supplements (day_plan_id, name_snapshot, period, planned, completed, sort_order)
  select target_plan.id, name_snapshot, period, planned, false, sort_order
    from public.daily_supplements where day_plan_id = source_plan.id;

  -- 健身项：纯内容，照抄。
  delete from public.daily_exercise_items where day_plan_id = target_plan.id;
  insert into public.daily_exercise_items (day_plan_id, exercise_option_id, name_snapshot, sort_order)
  select target_plan.id, exercise_option_id, name_snapshot, sort_order
    from public.daily_exercise_items where day_plan_id = source_plan.id;

  -- 自定义事项：内容照抄，completed 归零。
  delete from public.custom_tasks where day_plan_id = target_plan.id;
  insert into public.custom_tasks (day_plan_id, task_time, title, note, completed)
  select target_plan.id, task_time, title, note, false
    from public.custom_tasks where day_plan_id = source_plan.id;
end;
$$;

revoke all on function public.copy_yesterday_stage4(date) from public;
grant execute on function public.copy_yesterday_stage4(date) to authenticated;

-- ############################################################################
-- ##  202609200001_stage5_sync.sql
-- ############################################################################

-- Stage 5: 补齐三张子表的服务端变更时间（S4-T6）。**只追加**，不改写前四个迁移。
--
-- 为什么需要这一批：`docs/18 §5.4` 要求「11 张同步表都有 `updated_at` 与 `set_updated_at`
-- 触发器」，`stage4` 只覆盖了其中 7 张。缺的三张正是 `stage4` 新建、但当时按「镜像本地契约」
-- 口径建表的子表——本地 `daily_meal_items` / `daily_exercise_items` 只有 `created_at`，
-- `routine_tasks` 两个时间列都没有，于是云端也就照着没有。
--
-- 这一批**不是**为了「与本地字段对齐」，方向恰好相反：`updated_at` 是**云端自己的列**，
-- 本地契约里没有、也不该有。理由有两条：
--
-- 1. **时间戳必须来自服务器**。`docs/18 §5.4` 的多设备场景是「两台设备先后推送同一天，
--    云端 last-write-wins」。本机时钟不可信，只有数据库触发器写的 `now()` 才是一份
--    可比较、可审计的变更时间；如果改成由客户端上报，两台机器的时钟偏移会直接决定谁覆盖谁。
-- 2. **它是将来做增量拉取的前提**。一期按决策 D2 **不做**自动下载（cloud → local），
--    所以现在没有任何代码读这一列；但一旦要加，水位线只能是 `updated_at`。
--    一张表没有这一列，那条路就永远是断的——现在补上比事后回填历史行便宜得多。
--
-- 因此**不要**把这三列加进 `src/services/local/recordSchemas.ts`：本地契约是窄的那一侧，
-- 推送时 `sync/mapper.ts` 只发本地契约里存在的字段，云端这几列由 `default now()` 填。
-- 若哪天有人把本地契约也加上 `updated_at`，推送就会开始上报本机时钟，
-- 恰好破坏上面第 1 条——`check:cloud-parity` 的列级断言会拦下这种改法。
--
-- 顺带一提：`created_at` 有意**不补**。这三张表里 `routine_tasks` 两个时间列都没有，
-- 但水位线与 LWW 判定都只用到 `updated_at`，多加一列只是给 S5 的
-- `export_cloud_snapshot()` 多添一处需要剔除的列（本地备份的形状里没有它）。

-- ---------------------------------------------------------------- 补列

alter table public.daily_meal_items
  add column if not exists updated_at timestamptz not null default now();

alter table public.daily_exercise_items
  add column if not exists updated_at timestamptz not null default now();

alter table public.routine_tasks
  add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------- 触发器

-- 复用 `stage1` 建的 `public.set_updated_at()`，不再重复实现一份。
drop trigger if exists daily_meal_items_set_updated_at on public.daily_meal_items;
create trigger daily_meal_items_set_updated_at before update on public.daily_meal_items
for each row execute function public.set_updated_at();

drop trigger if exists daily_exercise_items_set_updated_at on public.daily_exercise_items;
create trigger daily_exercise_items_set_updated_at before update on public.daily_exercise_items
for each row execute function public.set_updated_at();

drop trigger if exists routine_tasks_set_updated_at on public.routine_tasks;
create trigger routine_tasks_set_updated_at before update on public.routine_tasks
for each row execute function public.set_updated_at();

-- 至此 10 张用户数据表 + `profiles` 全部具备 `updated_at` 与 `set_updated_at` 触发器，
-- `check:cloud-parity` 第 7 组的「每张云端表都有 updated_at 与触发器」断言守住这一点。

-- ############################################################################
-- ##  202609200002_stage6_replace.sql
-- ############################################################################

-- Stage 6: 双向整体替换（S5）。**只追加**，不改写前五个迁移。
--
-- 这一批给「本地上传云端」与「云端恢复到本地」两个**用户主动触发**的整体替换
-- 提供云端侧的一半：
--
--   1. `cloud_sync_summary()`   —— 只读条数摘要，给确认框显示「云端现有 N 条」
--   2. `export_cloud_snapshot()`—— 吐出与本地备份**完全相同的文件形状**
--   3. `import_local_backup()`  —— 一个事务内整体替换当前账号的全部业务数据
--   4. 三个历史日期判定函数加**受控豁免**（只在第 3 条的调用里生效）
--
-- ## 为什么这一批必须存在（而不是让客户端逐表写）
--
-- 客户端逐表写入做不到「全成或全不成」：中途失败会在云端留下删了一半的账号，
-- 而本地那一侧看到的是一个「看起来成功」的界面。整体替换的语义是「替换」，
-- 半途而废比直接失败危险得多。
--
-- ## 历史日期豁免是主路径，不是边角情况
--
-- 本地备份里绝大多数是**过去的**计划，而云端触发器一律拒绝写今天之前的日期
-- （`docs/01` 不变量 4）。所以「逐表 insert」在真实数据上必然全数失败。
-- 豁免的做法是**事务级 GUC**：`import_local_backup` 在事务内
-- `set local molly.allow_history = 'on'`，三个判定函数看到这个开关就放行。
--
-- 关键约束：**函数一律 `security invoker`，绝不用 `security definer`。**
-- 普通写入路径（界面上的日常编辑）的历史只读规则一个字不变；
-- 豁免只在本事务内、只对调用者自己的数据生效，RLS 全程有效。
-- 也绝不把 `service_role` 密钥放到浏览器里——那等于把整个库的权限交给前端。
--
-- ## 与 stage5 的命名
--
-- 方案 `docs/18 §4.3` 把这一批记在「`stage5_sync.sql`」名下，但 S4-T6 已经用掉了
-- 那个文件名（给三张子表补服务端 `updated_at`）。迁移是只追加的，
-- 不能回头往已执行的文件里塞东西，因此这一批另起一个文件。
-- 下面的表结构一律沿用 stage1–stage5 建好的形状，不加任何新列、新表。

-- ================================================================ 快照时间戳

-- 把 `timestamptz` 渲染成本地备份里那种形状：`2026-09-20T04:15:45.462Z`。
--
-- 为什么不用 `to_jsonb(ts)` 直接输出：那会带上会话的 `TimeZone`
-- （Supabase 上是 `+00:00`，本机验收库上是 `+08:00`），同一份数据在两台服务器上
-- 吐出的字符串不同。本地 `recordSchemas.ts` 的 `TIMESTAMP_PATTERN` 两种都认，
-- 但**输出可复现**能让「同一份云端数据导出两次逐字节相同」成立，
-- 也让回归脚本的比对不必先归一化时区。统一走 UTC，与本地 `toISOString()` 同形。
create or replace function public.snapshot_timestamp(ts timestamptz)
returns text
language sql
immutable
as $$
  select to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- ================================================================ 历史日期豁免

-- 三处判定函数各加一段**前置放行**。放在函数最开头（早于归属校验）是有意的：
-- 豁免期间 RLS 仍然是最后一道闸，而归属校验里那句「无权访问日期计划」
-- 会在导入的子表写入阶段误伤——那一批数据的父记录刚在本事务里插入，
-- 归属正确，但判定函数读的是 `auth.uid()`，两者本就一致，
-- 放行的语义是「这次写入是受控迁移，不是日常编辑」。
--
-- 放行的返回值与函数原本的收尾一致：`DELETE` 返回 `old`，其余返回 `new`。

create or replace function public.reject_historical_day_plan()
returns trigger language plpgsql set search_path = public
as $$
declare business_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if coalesce(current_setting('molly.allow_history', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if (tg_op in ('INSERT', 'UPDATE') and new.plan_date < business_today)
     or (tg_op = 'UPDATE' and old.plan_date < business_today)
     or (tg_op = 'DELETE' and old.plan_date < business_today) then
    raise exception '历史日期不可修改';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.reject_historical_stage3_rows()
returns trigger language plpgsql set search_path = public
as $$
declare target_date date;
begin
  if coalesce(current_setting('molly.allow_history', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
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

create or replace function public.reject_historical_meal_items()
returns trigger language plpgsql set search_path = public
as $$
declare target_date date;
begin
  if coalesce(current_setting('molly.allow_history', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    select p.plan_date into target_date
      from public.daily_meals m join public.day_plans p on p.id = m.day_plan_id
      where m.id = old.daily_meal_id and p.user_id = (select auth.uid());
  else
    select p.plan_date into target_date
      from public.daily_meals m join public.day_plans p on p.id = m.day_plan_id
      where m.id = new.daily_meal_id and p.user_id = (select auth.uid());
  end if;
  if target_date is null then raise exception '无权访问日期计划'; end if;
  if target_date < (now() at time zone 'Asia/Shanghai')::date then raise exception '历史日期不可修改'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- 触发器不用重建：`create or replace function` 换的是函数体，
-- 已有触发器按名解析，行为立刻跟着变。

-- ================================================================ 条数摘要

-- 当前云端账号的条数摘要。**只读**，不写任何东西。
--
-- 口径必须与本地那一侧**逐张表对齐**：本地用 `countRecords(collectUserRecords())`
-- 数的是 10 张用户数据表的全部行数（含子表）。S3 期间云端用的是
-- 「四张根表 head 计数」（`cloud/rpc.ts` 的 `countCloudRows`），
-- 那个数字与本地不同口径——绑定时 `judgeBindingCase(cloudCount, localCount)`
-- 拿两个含义不同的数字作比较，界面上显示的「云端 N 条」也会偏小。
-- 这个函数就是为了把两边拉齐。
--
-- 子表不带 `user_id`（`docs/01` 不变量 2），归属沿父键推导，
-- 所以子表一律 join 回 `day_plans` 再按 `user_id` 过滤。
create or replace function public.cloud_sync_summary()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
  counts jsonb;
  total integer;
begin
  if uid is null then raise exception '未登录云端账号'; end if;

  with c(store, n) as (
    select 'day_plans', count(*)::integer from public.day_plans where user_id = uid
    union all select 'food_options', count(*)::integer from public.food_options where user_id = uid
    union all select 'exercise_options', count(*)::integer from public.exercise_options where user_id = uid
    union all select 'supplement_templates', count(*)::integer from public.supplement_templates where user_id = uid
    union all select 'daily_meals', count(*)::integer
      from public.daily_meals m join public.day_plans p on p.id = m.day_plan_id where p.user_id = uid
    union all select 'daily_meal_items', count(*)::integer
      from public.daily_meal_items i
      join public.daily_meals m on m.id = i.daily_meal_id
      join public.day_plans p on p.id = m.day_plan_id
      where p.user_id = uid
    union all select 'custom_tasks', count(*)::integer
      from public.custom_tasks t join public.day_plans p on p.id = t.day_plan_id where p.user_id = uid
    union all select 'daily_supplements', count(*)::integer
      from public.daily_supplements s join public.day_plans p on p.id = s.day_plan_id where p.user_id = uid
    union all select 'daily_exercise_items', count(*)::integer
      from public.daily_exercise_items e join public.day_plans p on p.id = e.day_plan_id where p.user_id = uid
    union all select 'routine_tasks', count(*)::integer
      from public.routine_tasks r join public.day_plans p on p.id = r.day_plan_id where p.user_id = uid
  )
  select coalesce(jsonb_object_agg(store, n), '{}'::jsonb), coalesce(sum(n), 0)
    into counts, total
    from c where n > 0;

  return jsonb_build_object('counts', counts, 'total', total);
end;
$$;

-- ================================================================ 云端快照

-- 吐出与本地备份**完全相同的文件形状**（`backupFormat.ts` 的 `BackupFile`）：
--
--   { app, format, version, db_version, exported_at,
--     source_user: { username }, counts: {…}, records: {…} }
--
-- 这样本地那一侧只要把返回值 `JSON.stringify` 之后喂给现有的 `parseBackup`
-- 就能全量校验、再走现有的 `importBackup` 写入——**一条新的写入路径都不用写**
-- （`docs/18 §5.5`）。
--
-- ## 每张表只发本地契约里有的字段
--
-- 云端的 `day_plans.exercise_content`、`daily_meals.plan_content`、
-- `daily_meals.created_at` / `updated_at`、三张子表的 `updated_at` 都是
-- **云端自己的列**，本地契约里没有。它们必须被剔除：
-- `parseBackup` 对每条记录跑 `validateRecord`，多一个未定义字段就**整份拒绝**。
--
-- 所以下面的字段清单是逐字对着 `recordSchemas.ts` 写的，不是 `to_jsonb(t)`
-- 那种「有什么发什么」。清单对不对不靠人眼：`verify:sql` 会真的调用这个函数，
-- 把返回的每张表字段集合与本地契约逐张比对。
--
-- ## 必须额外输出一条合成 `users` 行
--
-- `parseBackup` 的外键校验要求 `day_plans.user_id` 能在 `records.users` 里
-- 找到父记录（`FOREIGN_KEYS`）。云端快照里的 `user_id` 是**云端账号 id**，
-- 所以要补一条 `{ id: <云端 uid>, username: <云端邮箱> }`。
-- 本地导入时的 `user_id` 重映射（L5 已实现，用于换设备搬家）会把它换成当前本地账号 id，
-- 于是云端快照与本地备份走**完全相同**的校验与写入路径，不存在第二条分支。
create or replace function public.export_cloud_snapshot()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
  mail text;
  records jsonb;
begin
  if uid is null then raise exception '未登录云端账号'; end if;

  select email into mail from auth.users where id = uid;

  records := jsonb_build_object(
    'users', jsonb_build_array(jsonb_build_object(
      'id', uid,
      'username', coalesce(mail, ''),
      'password_hash', '',
      'created_at', '1970-01-01T00:00:00.000Z'
    )),

    'day_plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'user_id', t.user_id,
        'plan_date', to_char(t.plan_date, 'YYYY-MM-DD'),
        'mode', t.mode,
        'mode_override', t.mode_override,
        'created_at', public.snapshot_timestamp(t.created_at),
        'updated_at', public.snapshot_timestamp(t.updated_at),
        'outfit_ready', t.outfit_ready,
        'meals_ready', t.meals_ready,
        'supplements_ready', t.supplements_ready,
        'morning_ready', t.morning_ready,
        'exercise_ready', t.exercise_ready,
        'morning_focus', t.morning_focus,
        'morning_completed', t.morning_completed,
        'exercise_decision', t.exercise_decision,
        'exercise_note', t.exercise_note,
        'exercise_completed', t.exercise_completed
      ) order by t.plan_date)
      from public.day_plans t where t.user_id = uid
    ), '[]'::jsonb),

    'daily_meals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'day_plan_id', m.day_plan_id,
        'meal_type', m.meal_type,
        'note', m.note,
        'completed', m.completed
      ) order by m.day_plan_id, m.meal_type)
      from public.daily_meals m
      join public.day_plans p on p.id = m.day_plan_id
      where p.user_id = uid
    ), '[]'::jsonb),

    'daily_meal_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'daily_meal_id', i.daily_meal_id,
        'food_option_id', i.food_option_id,
        'food_name_snapshot', i.food_name_snapshot,
        'sort_order', i.sort_order,
        'created_at', public.snapshot_timestamp(i.created_at)
      ) order by i.daily_meal_id, i.sort_order)
      from public.daily_meal_items i
      join public.daily_meals m on m.id = i.daily_meal_id
      join public.day_plans p on p.id = m.day_plan_id
      where p.user_id = uid
    ), '[]'::jsonb),

    'custom_tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'day_plan_id', t.day_plan_id,
        -- `time` 列的原生 JSON 形状是 `HH:MM:SS`，而本地是 `<input type="time">`
        -- 给的 `HH:MM`。不收窄的话往返一次字符串就变了（界面靠 `.slice(0,5)` 兜着，
        -- 但备份文件是给人看的最后一道防线，不该出现这种无意义的差异）。
        'task_time', to_char(t.task_time, 'HH24:MI'),
        'title', t.title,
        'note', t.note,
        'completed', t.completed
      ) order by t.day_plan_id, t.task_time)
      from public.custom_tasks t
      join public.day_plans p on p.id = t.day_plan_id
      where p.user_id = uid
    ), '[]'::jsonb),

    'daily_supplements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'day_plan_id', s.day_plan_id,
        'name_snapshot', s.name_snapshot,
        'period', s.period,
        'planned', s.planned,
        'completed', s.completed,
        'sort_order', s.sort_order,
        'created_at', public.snapshot_timestamp(s.created_at),
        'updated_at', public.snapshot_timestamp(s.updated_at)
      ) order by s.day_plan_id, s.sort_order)
      from public.daily_supplements s
      join public.day_plans p on p.id = s.day_plan_id
      where p.user_id = uid
    ), '[]'::jsonb),

    'daily_exercise_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'day_plan_id', e.day_plan_id,
        'exercise_option_id', e.exercise_option_id,
        'name_snapshot', e.name_snapshot,
        'sort_order', e.sort_order,
        'created_at', public.snapshot_timestamp(e.created_at)
      ) order by e.day_plan_id, e.sort_order)
      from public.daily_exercise_items e
      join public.day_plans p on p.id = e.day_plan_id
      where p.user_id = uid
    ), '[]'::jsonb),

    'routine_tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'day_plan_id', r.day_plan_id,
        'kind', r.kind,
        'title', r.title,
        'completed', r.completed
      ) order by r.day_plan_id, r.kind)
      from public.routine_tasks r
      join public.day_plans p on p.id = r.day_plan_id
      where p.user_id = uid
    ), '[]'::jsonb),

    'food_options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'user_id', o.user_id,
        'name', o.name,
        'active', o.active,
        'sort_order', o.sort_order,
        'created_at', public.snapshot_timestamp(o.created_at),
        'updated_at', public.snapshot_timestamp(o.updated_at)
      ) order by o.sort_order, o.id)
      from public.food_options o where o.user_id = uid
    ), '[]'::jsonb),

    'supplement_templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'user_id', o.user_id,
        'name', o.name,
        'period', o.period,
        'active', o.active,
        'sort_order', o.sort_order,
        'created_at', public.snapshot_timestamp(o.created_at),
        'updated_at', public.snapshot_timestamp(o.updated_at)
      ) order by o.sort_order, o.id)
      from public.supplement_templates o where o.user_id = uid
    ), '[]'::jsonb),

    'exercise_options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'user_id', o.user_id,
        'name', o.name,
        'active', o.active,
        'sort_order', o.sort_order,
        'created_at', public.snapshot_timestamp(o.created_at),
        'updated_at', public.snapshot_timestamp(o.updated_at)
      ) order by o.sort_order, o.id)
      from public.exercise_options o where o.user_id = uid
    ), '[]'::jsonb)
  );

  return jsonb_build_object(
    'app', 'happy-little-molly',
    'format', 'local-backup',
    -- 与 `BACKUP_FORMAT_VERSION` 对齐。快照与备份同形状，版本号也就同源；
    -- 本地 `parseBackup` 会因为「来自更新的版本」拒绝更高的号。
    'version', 2,
    -- 快照没有「本地库结构版本」可言，但 `parseBackup` 要求这个字段是正整数。
    -- 给 1 是诚实的下限：它只用来在两边不一致时提示一句，不参与任何校验分支。
    'db_version', 1,
    'exported_at', public.snapshot_timestamp(now()),
    'source_user', jsonb_build_object('username', coalesce(mail, '')),
    'counts', (select coalesce(jsonb_object_agg(store, n), '{}'::jsonb) from (
      select 'day_plans' as store, jsonb_array_length(records->'day_plans') as n
      union all select 'daily_meals', jsonb_array_length(records->'daily_meals')
      union all select 'daily_meal_items', jsonb_array_length(records->'daily_meal_items')
      union all select 'custom_tasks', jsonb_array_length(records->'custom_tasks')
      union all select 'daily_supplements', jsonb_array_length(records->'daily_supplements')
      union all select 'daily_exercise_items', jsonb_array_length(records->'daily_exercise_items')
      union all select 'routine_tasks', jsonb_array_length(records->'routine_tasks')
      union all select 'food_options', jsonb_array_length(records->'food_options')
      union all select 'supplement_templates', jsonb_array_length(records->'supplement_templates')
      union all select 'exercise_options', jsonb_array_length(records->'exercise_options')
    ) c where n > 0),
    'records', records
  );
end;
$$;

-- ================================================================ 本地上传云端

-- 用一份本地备份整体替换**当前云端账号**的全部业务数据。
--
-- 输入就是本地导出的备份 JSON（`BackupFile`），输出是写入条数摘要：
--   { "imported": { "day_plans": 12, … }, "total": 128 }
--
-- ## 三条不能破的约束
--
-- 1. **`security invoker`**。豁免历史日期靠的是事务级 GUC，不是提权；
--    RLS 全程有效，`import_local_backup` 只可能删改调用者自己的行。
-- 2. **先删后插，都在一个事务里**。PostgREST 把一次 RPC 调用包在一个事务里，
--    所以「删完了但没插进去」这种中间态对外不可见。
-- 3. **删除顺序必须由子到父，插入顺序必须由父到子**。反了会撞外键。
--
-- ## 为什么不校验每条的字段形状
--
-- 客户端已经用 `parseBackup` 全量校验过一遍（与本地导入同一个函数），
-- 这里再实现一遍等于把同一套规则写两处，两边迟早分叉。
-- 服务端只做**它才能做的那部分**：认出这是什么文件、只认已知的仓库名、
-- 把 `user_id` 强制成 `auth.uid()`（绝不相信客户端传来的归属）。
-- 真正拦住坏数据的是表约束与字段类型——插入失败会让整个事务回滚，
-- 也就是「要么全生效，要么一条都没写」，这正是替换语义要的。
create or replace function public.import_local_backup(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
  version integer;
  known constant text[] := array[
    'users',
    'day_plans', 'daily_meals', 'daily_meal_items', 'custom_tasks',
    'daily_supplements', 'daily_exercise_items', 'routine_tasks',
    'food_options', 'supplement_templates', 'exercise_options'
  ];
  unknown_key text;
  rec jsonb;
  imported jsonb := '{}'::jsonb;
  n integer;
  total integer := 0;
begin
  if uid is null then raise exception '未登录云端账号'; end if;

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception '导入内容必须是一个 JSON 对象';
  end if;
  if payload->>'app' <> 'happy-little-molly' or payload->>'format' <> 'local-backup' then
    raise exception '这不是「幸福小Molly」的备份文件';
  end if;

  version := nullif(payload->>'version', '')::integer;
  -- 只认 1 与 2：v1 与 v2 的差别仅在 `users` 的来源登录名字段名，
  -- 而这里根本不读 `users`（账号由 Supabase Auth 管理，不迁移密码）。
  -- 更高的版本号意味着文件里可能有这一批 SQL 不认识的结构，宁可直接拒绝。
  if version is null or version not in (1, 2) then
    raise exception '备份格式版本不受支持：%', coalesce(payload->>'version', '（缺失）');
  end if;

  rec := payload->'records';
  if rec is null or jsonb_typeof(rec) <> 'object' then
    raise exception '备份缺少 records 字段';
  end if;

  select key into unknown_key from jsonb_object_keys(rec) as key
    where key <> all (known) limit 1;
  if unknown_key is not null then
    raise exception '备份里出现了不认识的仓库：%', unknown_key;
  end if;

  -- 从这里开始放行历史日期写入。`set local` 只活到本事务结束，
  -- 且本函数是 `security invoker`——日常编辑路径完全不受影响。
  set local molly.allow_history = 'on';

  -- ------------------------------------------------------------ 删（子 → 父）
  --
  -- 每条都显式带 `p.user_id = uid`：RLS 已经拦了一道，这里再收一道，
  -- 为的是「将来谁把策略写宽了」也不会连带删掉别人的数据。

  delete from public.daily_meal_items i
    using public.daily_meals m, public.day_plans p
    where i.daily_meal_id = m.id and m.day_plan_id = p.id and p.user_id = uid;

  delete from public.daily_meals m
    using public.day_plans p where m.day_plan_id = p.id and p.user_id = uid;

  delete from public.custom_tasks t
    using public.day_plans p where t.day_plan_id = p.id and p.user_id = uid;
  delete from public.daily_supplements s
    using public.day_plans p where s.day_plan_id = p.id and p.user_id = uid;
  delete from public.daily_exercise_items e
    using public.day_plans p where e.day_plan_id = p.id and p.user_id = uid;
  delete from public.routine_tasks r
    using public.day_plans p where r.day_plan_id = p.id and p.user_id = uid;

  delete from public.day_plans where user_id = uid;

  delete from public.food_options where user_id = uid;
  delete from public.supplement_templates where user_id = uid;
  delete from public.exercise_options where user_id = uid;

  -- ------------------------------------------------------------ 插（父 → 子）
  --
  -- `jsonb_populate_recordset(null::public.<表>, …)` 把 JSON 的键映射到表列，
  -- 只列本地契约里有的列——于是 `day_plans.exercise_content` 这类
  -- 「云端有、本地没有」的列**走自己的默认值**，而不是被显式写成 NULL
  -- （那些列是 NOT NULL 的，显式 NULL 会直接失败）。
  --
  -- `user_id` 一律用 `uid`，不取 JSON 里的值：归属由服务端定，
  -- 客户端传什么都不作数。这也是「只删自己的行」能成立的前提。

  insert into public.food_options
    (id, user_id, name, active, sort_order, created_at, updated_at)
  select r.id, uid, r.name, r.active, r.sort_order, r.created_at, r.updated_at
  from jsonb_populate_recordset(null::public.food_options,
       coalesce(rec->'food_options', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('food_options', n); end if;

  insert into public.supplement_templates
    (id, user_id, name, period, active, sort_order, created_at, updated_at)
  select r.id, uid, r.name, r.period, r.active, r.sort_order, r.created_at, r.updated_at
  from jsonb_populate_recordset(null::public.supplement_templates,
       coalesce(rec->'supplement_templates', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('supplement_templates', n); end if;

  insert into public.exercise_options
    (id, user_id, name, active, sort_order, created_at, updated_at)
  select r.id, uid, r.name, r.active, r.sort_order, r.created_at, r.updated_at
  from jsonb_populate_recordset(null::public.exercise_options,
       coalesce(rec->'exercise_options', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('exercise_options', n); end if;

  insert into public.day_plans
    (id, user_id, plan_date, mode, mode_override, created_at, updated_at,
     outfit_ready, meals_ready, supplements_ready, morning_ready, exercise_ready,
     morning_focus, morning_completed, exercise_decision, exercise_note, exercise_completed)
  select r.id, uid, r.plan_date, r.mode, r.mode_override, r.created_at, r.updated_at,
     r.outfit_ready, r.meals_ready, r.supplements_ready, r.morning_ready, r.exercise_ready,
     r.morning_focus, r.morning_completed, r.exercise_decision, r.exercise_note, r.exercise_completed
  from jsonb_populate_recordset(null::public.day_plans,
       coalesce(rec->'day_plans', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('day_plans', n); end if;

  insert into public.daily_meals (id, day_plan_id, meal_type, note, completed)
  select r.id, r.day_plan_id, r.meal_type, r.note, r.completed
  from jsonb_populate_recordset(null::public.daily_meals,
       coalesce(rec->'daily_meals', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('daily_meals', n); end if;

  insert into public.daily_meal_items
    (id, daily_meal_id, food_option_id, food_name_snapshot, sort_order, created_at)
  select r.id, r.daily_meal_id, r.food_option_id, r.food_name_snapshot, r.sort_order, r.created_at
  from jsonb_populate_recordset(null::public.daily_meal_items,
       coalesce(rec->'daily_meal_items', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('daily_meal_items', n); end if;

  insert into public.custom_tasks (id, day_plan_id, task_time, title, note, completed)
  select r.id, r.day_plan_id, r.task_time, r.title, r.note, r.completed
  from jsonb_populate_recordset(null::public.custom_tasks,
       coalesce(rec->'custom_tasks', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('custom_tasks', n); end if;

  insert into public.daily_supplements
    (id, day_plan_id, name_snapshot, period, planned, completed, sort_order, created_at, updated_at)
  select r.id, r.day_plan_id, r.name_snapshot, r.period, r.planned, r.completed,
         r.sort_order, r.created_at, r.updated_at
  from jsonb_populate_recordset(null::public.daily_supplements,
       coalesce(rec->'daily_supplements', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('daily_supplements', n); end if;

  insert into public.daily_exercise_items
    (id, day_plan_id, exercise_option_id, name_snapshot, sort_order, created_at)
  select r.id, r.day_plan_id, r.exercise_option_id, r.name_snapshot, r.sort_order, r.created_at
  from jsonb_populate_recordset(null::public.daily_exercise_items,
       coalesce(rec->'daily_exercise_items', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('daily_exercise_items', n); end if;

  insert into public.routine_tasks (id, day_plan_id, kind, title, completed)
  select r.id, r.day_plan_id, r.kind, r.title, r.completed
  from jsonb_populate_recordset(null::public.routine_tasks,
       coalesce(rec->'routine_tasks', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('routine_tasks', n); end if;

  return jsonb_build_object('imported', imported, 'total', total);
end;
$$;

-- ================================================================ 权限

-- 三个函数都只给 `authenticated`，并且先从 `public` 收回来。
-- PostgreSQL 给新建函数默认授予 `public` 执行权，不收回的话
-- 未登录（`anon`）也能调——虽然 `auth.uid()` 为空会让它们直接报错，
-- 但「默认谁都别调，明确授权才可调」是这类写接口该有的姿态。
revoke all on function public.cloud_sync_summary() from public;
grant execute on function public.cloud_sync_summary() to authenticated;

revoke all on function public.export_cloud_snapshot() from public;
grant execute on function public.export_cloud_snapshot() to authenticated;

revoke all on function public.import_local_backup(jsonb) from public;
grant execute on function public.import_local_backup(jsonb) to authenticated;

revoke all on function public.snapshot_timestamp(timestamptz) from public;
grant execute on function public.snapshot_timestamp(timestamptz) to authenticated;
