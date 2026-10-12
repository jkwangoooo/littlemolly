-- Account identity: one trusted Auth UID, default deny, no credential seed.
-- The operator must separately prepare the Auth account and approve its UID.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create table private.account_allowlist (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.account_allowlist enable row level security;
revoke all on private.account_allowlist from public, anon, authenticated, service_role;

-- The only definer lookup is private, has no caller-selected UID, and reads no
-- business data. Its table can only be changed by the trusted database owner.
create function private.is_account_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from private.account_allowlist a
    where a.singleton and a.user_id = (select auth.uid())
  );
$$;
revoke all on function private.is_account_allowed() from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.is_account_allowed() to authenticated;

create function public.account_access()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'allowed', a.allowed,
    'uid', (select auth.uid())
  ) from (select private.is_account_allowed() as allowed) a;
$$;
revoke all on function public.account_access() from public, anon, authenticated, service_role;
grant execute on function public.account_access() to authenticated;

-- A restrictive policy adds an AND gate to every existing ownership policy.
-- Old JWTs cannot bypass it, and legacy rows remain preserved for migration.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'sync_test_records',
    'day_plans', 'daily_meals', 'daily_meal_items', 'custom_tasks',
    'daily_supplements', 'daily_exercise_items', 'routine_tasks',
    'food_options', 'supplement_templates', 'exercise_options'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists account_uid_gate on public.%I', table_name);
    execute format(
      'create policy account_uid_gate on public.%I as restrictive for all to authenticated
       using ((select private.is_account_allowed()))
       with check ((select private.is_account_allowed()))',
      table_name
    );
    execute format(
      'revoke all on public.%I from public, anon, authenticated',
      table_name
    );
    if table_name = 'profiles' then
      execute format('grant select, update on public.%I to authenticated', table_name);
    else
      execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    end if;
  end loop;
end;
$$;

-- 子表外键本身只能确认“这条选项存在”，不能确认它和日期计划属于同一账号。
-- 直接调用 Data API / RPC 时不能依赖客户端的完整图校验，因此在写入边界
-- 再做一次同 UID 检查；删除选项产生的 ON DELETE SET NULL 仍然允许。
create or replace function public.enforce_daily_meal_item_owner()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  meal_owner uuid;
  option_owner uuid;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  select p.user_id into meal_owner
    from public.daily_meals m
    join public.day_plans p on p.id = m.day_plan_id
    where m.id = new.daily_meal_id;
  if uid is null or meal_owner is null or meal_owner <> uid then
    raise exception '无权访问日期计划';
  end if;
  if new.food_option_id is not null then
    select o.user_id into option_owner
      from public.food_options o
      where o.id = new.food_option_id;
    if option_owner is null or option_owner <> uid then
      raise exception '餐次的食物选项不属于当前账号';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists daily_meal_items_enforce_owner on public.daily_meal_items;
create trigger daily_meal_items_enforce_owner
before insert or update on public.daily_meal_items
for each row execute function public.enforce_daily_meal_item_owner();

create or replace function public.enforce_daily_exercise_item_owner()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  plan_owner uuid;
  option_owner uuid;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  select p.user_id into plan_owner
    from public.day_plans p
    where p.id = new.day_plan_id;
  if uid is null or plan_owner is null or plan_owner <> uid then
    raise exception '无权访问日期计划';
  end if;
  if new.exercise_option_id is not null then
    select o.user_id into option_owner
      from public.exercise_options o
      where o.id = new.exercise_option_id;
    if option_owner is null or option_owner <> uid then
      raise exception '健身项目的选项不属于当前账号';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists daily_exercise_items_enforce_owner on public.daily_exercise_items;
create trigger daily_exercise_items_enforce_owner
before insert or update on public.daily_exercise_items
for each row execute function public.enforce_daily_exercise_item_owner();

-- 触发器函数不应成为 Data API 可调用的公共入口；触发器本身不依赖这些角色的
-- EXECUTE 授权。旧的复制 RPC 仍保留给 authenticated，但明确收回 anon/service_role。
revoke all on function public.enforce_daily_meal_item_owner() from public, anon, authenticated, service_role;
revoke all on function public.enforce_daily_exercise_item_owner() from public, anon, authenticated, service_role;
revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;
revoke all on function public.copy_yesterday_stage3(date) from public, anon, authenticated, service_role;
revoke all on function public.copy_yesterday_stage4(date) from public, anon, authenticated, service_role;
grant execute on function public.copy_yesterday_stage3(date) to authenticated;
grant execute on function public.copy_yesterday_stage4(date) to authenticated;

create or replace function public.cloud_sync_summary()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  counts jsonb;
  total integer;
begin
  if uid is null then raise exception '未登录云端账号'; end if;
  if not private.is_account_allowed() then
    raise exception using errcode = '42501', message = '当前账号未获应用访问授权';
  end if;
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
      join public.day_plans p on p.id = m.day_plan_id where p.user_id = uid
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
    into counts, total from c where n > 0;
  return jsonb_build_object('counts', counts, 'total', total);
end;
$$;

-- v3 snapshots contain business data and a single profile, never credentials.
create or replace function public.export_cloud_snapshot()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  account_created timestamptz;
  records jsonb;
begin
  if uid is null then raise exception '未登录云端账号'; end if;
  if not private.is_account_allowed() then
    raise exception using errcode = '42501', message = '当前账号未获应用访问授权';
  end if;
  select p.created_at into account_created from public.profiles p where p.user_id = uid;

  records := jsonb_build_object(
    'users', jsonb_build_array(jsonb_build_object(
      'id', uid, 'username', 'W',
      'created_at', public.snapshot_timestamp(coalesce(account_created, '1970-01-01T00:00:00Z'::timestamptz))
    )),
    'day_plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'user_id', t.user_id,
        'plan_date', to_char(t.plan_date, 'YYYY-MM-DD'),
        'mode', t.mode, 'mode_override', t.mode_override,
        'created_at', public.snapshot_timestamp(t.created_at),
        'updated_at', public.snapshot_timestamp(t.updated_at),
        'outfit_ready', t.outfit_ready, 'meals_ready', t.meals_ready,
        'supplements_ready', t.supplements_ready, 'morning_ready', t.morning_ready,
        'exercise_ready', t.exercise_ready, 'morning_focus', t.morning_focus,
        'morning_completed', t.morning_completed, 'exercise_decision', t.exercise_decision,
        'exercise_note', t.exercise_note, 'exercise_completed', t.exercise_completed
      ) order by t.plan_date, t.id)
      from public.day_plans t where t.user_id = uid
    ), '[]'::jsonb),
    'daily_meals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'day_plan_id', m.day_plan_id, 'meal_type', m.meal_type,
        'note', m.note, 'completed', m.completed
      ) order by m.day_plan_id, m.meal_type, m.id)
      from public.daily_meals m join public.day_plans p on p.id = m.day_plan_id
      where p.user_id = uid
    ), '[]'::jsonb),
    'daily_meal_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'daily_meal_id', i.daily_meal_id, 'food_option_id', i.food_option_id,
        'food_name_snapshot', i.food_name_snapshot, 'sort_order', i.sort_order,
        'created_at', public.snapshot_timestamp(i.created_at)
      ) order by i.daily_meal_id, i.sort_order, i.id)
      from public.daily_meal_items i
      join public.daily_meals m on m.id = i.daily_meal_id
      join public.day_plans p on p.id = m.day_plan_id where p.user_id = uid
    ), '[]'::jsonb),
    'custom_tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'day_plan_id', t.day_plan_id, 'task_time', to_char(t.task_time, 'HH24:MI'),
        'title', t.title, 'note', t.note, 'completed', t.completed
      ) order by t.day_plan_id, t.task_time, t.id)
      from public.custom_tasks t join public.day_plans p on p.id = t.day_plan_id
      where p.user_id = uid
    ), '[]'::jsonb),
    'daily_supplements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'day_plan_id', s.day_plan_id, 'name_snapshot', s.name_snapshot,
        'period', s.period, 'planned', s.planned, 'completed', s.completed,
        'sort_order', s.sort_order, 'created_at', public.snapshot_timestamp(s.created_at),
        'updated_at', public.snapshot_timestamp(s.updated_at)
      ) order by s.day_plan_id, s.sort_order, s.id)
      from public.daily_supplements s join public.day_plans p on p.id = s.day_plan_id
      where p.user_id = uid
    ), '[]'::jsonb),
    'daily_exercise_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'day_plan_id', e.day_plan_id, 'exercise_option_id', e.exercise_option_id,
        'name_snapshot', e.name_snapshot, 'sort_order', e.sort_order,
        'created_at', public.snapshot_timestamp(e.created_at)
      ) order by e.day_plan_id, e.sort_order, e.id)
      from public.daily_exercise_items e join public.day_plans p on p.id = e.day_plan_id
      where p.user_id = uid
    ), '[]'::jsonb),
    'routine_tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'day_plan_id', r.day_plan_id, 'kind', r.kind,
        'title', r.title, 'completed', r.completed
      ) order by r.day_plan_id, r.kind, r.id)
      from public.routine_tasks r join public.day_plans p on p.id = r.day_plan_id
      where p.user_id = uid
    ), '[]'::jsonb),
    'food_options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'user_id', o.user_id, 'name', o.name, 'active', o.active,
        'sort_order', o.sort_order, 'created_at', public.snapshot_timestamp(o.created_at),
        'updated_at', public.snapshot_timestamp(o.updated_at)
      ) order by o.sort_order, o.id)
      from public.food_options o where o.user_id = uid
    ), '[]'::jsonb),
    'supplement_templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'user_id', o.user_id, 'name', o.name, 'period', o.period, 'active', o.active,
        'sort_order', o.sort_order, 'created_at', public.snapshot_timestamp(o.created_at),
        'updated_at', public.snapshot_timestamp(o.updated_at)
      ) order by o.sort_order, o.id)
      from public.supplement_templates o where o.user_id = uid
    ), '[]'::jsonb),
    'exercise_options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'user_id', o.user_id, 'name', o.name, 'active', o.active,
        'sort_order', o.sort_order, 'created_at', public.snapshot_timestamp(o.created_at),
        'updated_at', public.snapshot_timestamp(o.updated_at)
      ) order by o.sort_order, o.id)
      from public.exercise_options o where o.user_id = uid
    ), '[]'::jsonb)
  );
  return jsonb_build_object(
    'app', 'happy-little-molly', 'format', 'local-backup',
    'version', 3, 'db_version', 8,
    'exported_at', public.snapshot_timestamp(now()),
    'source_user', jsonb_build_object('username', 'W'),
    'counts', (select coalesce(jsonb_object_agg(s.key, jsonb_array_length(s.value)), '{}'::jsonb)
      from jsonb_each(records) s where s.key <> 'users' and jsonb_array_length(s.value) > 0),
    'records', records
  );
end;
$$;

create or replace function public.import_local_backup(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  version integer;
  known constant text[] := array[
    'users', 'day_plans', 'daily_meals', 'daily_meal_items', 'custom_tasks',
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
  if not private.is_account_allowed() then
    raise exception using errcode = '42501', message = '当前账号未获应用访问授权';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception '导入内容必须是一个 JSON 对象';
  end if;
  if payload->>'app' is distinct from 'happy-little-molly'
     or payload->>'format' is distinct from 'local-backup' then
    raise exception '这不是「幸福小Molly」的备份文件';
  end if;
  version := nullif(payload->>'version', '')::integer;
  -- v1/v2 identities are ignored; no backup can create an Auth account.
  if version is null or version not in (1, 2, 3) then
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
  if exists (select 1 from jsonb_each(rec) e where jsonb_typeof(e.value) <> 'array') then
    raise exception '备份仓库内容必须是数组';
  end if;
  set local molly.allow_history = 'on';

  delete from public.daily_meal_items i using public.daily_meals m, public.day_plans p
    where i.daily_meal_id = m.id and m.day_plan_id = p.id and p.user_id = uid;
  delete from public.daily_meals m using public.day_plans p
    where m.day_plan_id = p.id and p.user_id = uid;
  delete from public.custom_tasks t using public.day_plans p
    where t.day_plan_id = p.id and p.user_id = uid;
  delete from public.daily_supplements s using public.day_plans p
    where s.day_plan_id = p.id and p.user_id = uid;
  delete from public.daily_exercise_items e using public.day_plans p
    where e.day_plan_id = p.id and p.user_id = uid;
  delete from public.routine_tasks r using public.day_plans p
    where r.day_plan_id = p.id and p.user_id = uid;
  delete from public.day_plans where user_id = uid;
  delete from public.food_options where user_id = uid;
  delete from public.supplement_templates where user_id = uid;
  delete from public.exercise_options where user_id = uid;

  insert into public.food_options
    (id, user_id, name, active, sort_order, created_at, updated_at)
  select r.id, uid, r.name, r.active, r.sort_order, r.created_at, r.updated_at
  from jsonb_populate_recordset(null::public.food_options, coalesce(rec->'food_options', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('food_options', n); end if;

  insert into public.supplement_templates
    (id, user_id, name, period, active, sort_order, created_at, updated_at)
  select r.id, uid, r.name, r.period, r.active, r.sort_order, r.created_at, r.updated_at
  from jsonb_populate_recordset(null::public.supplement_templates, coalesce(rec->'supplement_templates', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('supplement_templates', n); end if;

  insert into public.exercise_options
    (id, user_id, name, active, sort_order, created_at, updated_at)
  select r.id, uid, r.name, r.active, r.sort_order, r.created_at, r.updated_at
  from jsonb_populate_recordset(null::public.exercise_options, coalesce(rec->'exercise_options', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('exercise_options', n); end if;

  insert into public.day_plans
    (id, user_id, plan_date, mode, mode_override, created_at, updated_at,
     outfit_ready, meals_ready, supplements_ready, morning_ready, exercise_ready,
     morning_focus, morning_completed, exercise_decision, exercise_note, exercise_completed)
  select r.id, uid, r.plan_date, r.mode, r.mode_override, r.created_at, r.updated_at,
    r.outfit_ready, r.meals_ready, r.supplements_ready, r.morning_ready, r.exercise_ready,
    r.morning_focus, r.morning_completed, r.exercise_decision, r.exercise_note, r.exercise_completed
  from jsonb_populate_recordset(null::public.day_plans, coalesce(rec->'day_plans', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('day_plans', n); end if;

  insert into public.daily_meals (id, day_plan_id, meal_type, note, completed)
  select r.id, r.day_plan_id, r.meal_type, r.note, r.completed
  from jsonb_populate_recordset(null::public.daily_meals, coalesce(rec->'daily_meals', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('daily_meals', n); end if;

  insert into public.daily_meal_items
    (id, daily_meal_id, food_option_id, food_name_snapshot, sort_order, created_at)
  select r.id, r.daily_meal_id, r.food_option_id, r.food_name_snapshot, r.sort_order, r.created_at
  from jsonb_populate_recordset(null::public.daily_meal_items, coalesce(rec->'daily_meal_items', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('daily_meal_items', n); end if;

  insert into public.custom_tasks (id, day_plan_id, task_time, title, note, completed)
  select r.id, r.day_plan_id, r.task_time, r.title, r.note, r.completed
  from jsonb_populate_recordset(null::public.custom_tasks, coalesce(rec->'custom_tasks', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('custom_tasks', n); end if;

  insert into public.daily_supplements
    (id, day_plan_id, name_snapshot, period, planned, completed, sort_order, created_at, updated_at)
  select r.id, r.day_plan_id, r.name_snapshot, r.period, r.planned, r.completed,
    r.sort_order, r.created_at, r.updated_at
  from jsonb_populate_recordset(null::public.daily_supplements, coalesce(rec->'daily_supplements', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('daily_supplements', n); end if;

  insert into public.daily_exercise_items
    (id, day_plan_id, exercise_option_id, name_snapshot, sort_order, created_at)
  select r.id, r.day_plan_id, r.exercise_option_id, r.name_snapshot, r.sort_order, r.created_at
  from jsonb_populate_recordset(null::public.daily_exercise_items, coalesce(rec->'daily_exercise_items', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('daily_exercise_items', n); end if;

  insert into public.routine_tasks (id, day_plan_id, kind, title, completed)
  select r.id, r.day_plan_id, r.kind, r.title, r.completed
  from jsonb_populate_recordset(null::public.routine_tasks, coalesce(rec->'routine_tasks', '[]'::jsonb)) r;
  get diagnostics n = row_count; total := total + n;
  if n > 0 then imported := imported || jsonb_build_object('routine_tasks', n); end if;
  return jsonb_build_object('imported', imported, 'total', total);
end;
$$;

revoke all on function public.cloud_sync_summary() from public, anon, authenticated, service_role;
revoke all on function public.export_cloud_snapshot() from public, anon, authenticated, service_role;
revoke all on function public.import_local_backup(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.cloud_sync_summary() to authenticated;
grant execute on function public.export_cloud_snapshot() to authenticated;
grant execute on function public.import_local_backup(jsonb) to authenticated;
revoke all on function public.snapshot_timestamp(timestamptz) from public, anon, service_role;
grant execute on function public.snapshot_timestamp(timestamptz) to authenticated;

notify pgrst, 'reload schema';
commit;
