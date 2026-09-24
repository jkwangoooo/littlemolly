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
