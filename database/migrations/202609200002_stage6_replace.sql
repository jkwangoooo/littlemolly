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
