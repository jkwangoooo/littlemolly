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
