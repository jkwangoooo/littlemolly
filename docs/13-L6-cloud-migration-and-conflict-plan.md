# L6 云端迁移与冲突处理方案

> 状态：**方案定稿，尚未在真实 Supabase 项目上执行**。
> L6 阶段一已交付「服务门面 + 云端适配器 + 云端表结构对齐」；本文定义阶段二要做的上行迁移与冲突处理。
> 当前生效后端仍是**本地**（构建期默认），云端是可选构建，见 §2。

## 1. 为什么需要一份单独的方案

前五个阶段把「本地库是唯一数据源」当成了前提，因此有一批规则是围绕本地特性写的，搬到云端不能照抄：

| 本地特性 | 云端对应物 | 处理方式 |
| --- | --- | --- |
| IndexedDB 跨仓库事务 | PostgREST 逐表请求 | 跨表写改成服务端 RPC（`copy_yesterday_stage4`、上行导入） |
| 客户端 `crypto.randomUUID()` 造 id | `gen_random_uuid()` 默认值 | 保留客户端 id 能力：本地 id 本来就是 uuid v4，可直接复用（§5.2） |
| 本地 `users` 表 + djb2 哈希 | Supabase Auth + `profiles` | 认证不再自持密码；`user_id` 全部换成 `auth.uid()`（§5.3） |
| 无网络失败概念 | 请求可能超时 / 断网 | 失败必须可见，本期不做离线排队（§6.2） |
| 历史日期只读在服务层判断 | 数据库触发器 | 两边都判，且导入通道需要一条受控豁免（§5.4） |

## 2. 两种后端如何共存

```
src/services/
  contracts.ts      契约：函数名只写一遍，签名从 local 实现取（Pick<typeof import(...)>）
  backend.ts        当前后端（由构建模式决定），以及「本地备份是否可用」等派生标记
  api/              门面：页面只 import 这里
  local/            本地实现（默认）
  cloud/            云端实现（与 local 逐条等价）
    parity.ts       编译期断言：云端满足契约，少一个函数就 typecheck 失败
```

- 切换方式是**构建模式**：`npm run build` / `npm run dev` 走本地，`npm run build:cloud` / `npm run dev:cloud` 走云端。
  `vite.config.ts` 依据 `mode` 把 `@backend/*` 指到 `../local/` 或 `../cloud/`。
- 选择构建期而不是运行期，是为了让「本地构建产物里不含 supabase」继续成为可检查的事实：
  本地构建 0 命中 `supabase|PostgREST|GoTrueClient`，云端构建 0 命中 `indexedDB|happy-little-molly-local`。
- 页面的业务接口一行没改：只是把 `services/local/xxx` 的导入换成 `services/api/xxx`，函数名、参数、返回值完全一致。

## 3. 本地对象仓库 → 云端表映射

| 本地仓库 | 云端表 | 备注 |
| --- | --- | --- |
| `users` | `auth.users` + `profiles` | 不迁移密码；见 §5.3 |
| `day_plans` | `day_plans` | 主记录，`unique(user_id, plan_date)` 两边一致 |
| `daily_meals` | `daily_meals` | `unique(day_plan_id, meal_type)` 两边一致 |
| `daily_meal_items` | `daily_meal_items` | L6 新增 |
| `custom_tasks` | `custom_tasks` | — |
| `food_options` | `food_options` | L6 新增 |
| `supplement_templates` | `supplement_templates` | L6 新增 |
| `exercise_options` | `exercise_options` | L6 新增 |
| `daily_supplements` | `daily_supplements` | L6 新增 |
| `daily_exercise_items` | `daily_exercise_items` | L6 新增 |
| `routine_tasks` | `routine_tasks` | L6 新增 |

列级差异只有一处：云端 `day_plans` 多一个遗留列 `exercise_content`（L2 之前健身内容存自由文本）。
适配器的字段清单里**不包含**它，读取一律按本地形状返回；本地库里同名遗留字段也仍在原地（v3 迁移有意保留）。

两条约束口径，写迁移时必须守住：

1. **云端约束不得比本地更严。** 除了两边都有的唯一约束，新表不加额外 unique / 非空检查。
   选项的「同名不可重复」、补剂的「时段 + 名称去重」是服务层职责，由适配器复刻；
   数据库再来一遍就会出现「本地能存、云端报错」这种最难查的分歧。
2. **引用选项的外键一律 `on delete set null`，绝不 `restrict`。**
   本地删选项是硬删除，历史计划靠名称快照独立保存（docs/01 不变量 5）。
   若外键是 restrict，「删掉一个不再吃的食物」会被历史计划挡住，两种后端行为立刻分叉。

## 4. 不变量在云端的落点

| docs/01 不变量 | 云端实现 |
| --- | --- |
| 1. `day_plans` 对 `(user_id, plan_date)` 唯一 | 表级 `unique` + 适配器 `upsert(..., { onConflict: 'user_id,plan_date' })` |
| 2. 从属记录只能引用同用户计划 | 子表不存 `user_id`，RLS 通过父记录 `exists` 判定；触发器再校验一次归属 |
| 3. 私有表启用 RLS | 11 张业务表全部 `enable row level security`；`check:cloud-parity` 逐表断言 |
| 4. 后端拒绝改今天之前 | 适配器 `assertWritableDate` + 数据库触发器（`Asia/Shanghai`）双层 |
| 5. 保存名称快照 | 列名与本地一致（`food_name_snapshot` / `name_snapshot`）；删选项不改历史 |
| 6. 复制不带执行状态 | `copy_yesterday_stage4` 里所有 `completed` 显式写 `false`，准备勾选显式写 `false` |
| 7. 临时不上班不带家务 | `ensureRestDayRoutines` 判 `mode === 'rest' && !mode_override`；复制不碰 `routine_tasks` |

## 5. 本地 → 云端上行迁移

目标：换设备后，把本地账号的数据搬进云端账号。**等价于本地备份的「导入」换一个落点**，
因此严格复用同一套格式与校验（`services/api/backupFormat`），迁移的输入就是一份本地导出的备份 JSON。

步骤（阶段二实现）：

1. 用户在云端构建里登录（或注册）云端账号；
2. 粘贴 / 选择本地导出的备份文件；
3. `inspectBackup` 全量校验（与本地同源），拿到条数与来源邮箱，二次确认；
4. 确认后调用服务端 RPC **一次完成**替换，返回写入条数摘要。

### 5.1 为什么必须是服务端 RPC

客户端逐表写入做不到「全成或全不成」，中途失败会留下删了一半的账号。
更关键的是 §5.4 的历史日期豁免必须在数据库侧受控。

拟新增（阶段二，追加迁移）：

```sql
create or replace function public.import_local_backup(payload jsonb)
returns jsonb language plpgsql security invoker set search_path = public
as $$
begin
  -- 事务级开关：只在本事务内放行历史日期写入
  set local molly.allow_history = 'on';
  ...
end;
$$;
```

配套把三个历史日期判定函数（`reject_historical_day_plan` / `reject_historical_stage3_rows` /
`reject_historical_meal_items`）改成：

```sql
if coalesce(current_setting('molly.allow_history', true), '') = 'on' then
  return case when tg_op = 'DELETE' then old else new end;
end if;
```

要点：

- **`security invoker`，不是 `security definer`。** 普通写入路径的历史只读规则完全不变，
  豁免只在本事务内、只对调用者自己的数据生效；RLS 全程有效。
- 绝不用 `service_role` 密钥在浏览器里直连：那等于把整个库的权限交给前端。

### 5.2 id 与父子关系

本地 id 由 `crypto.randomUUID()` 生成，就是标准 uuid v4，可直接作为云端主键。
因此**保留原 id**：父子外键（`day_plan_id`、`daily_meal_id`）不需要重映射，导入是纯插入，
顺序只需满足外键依赖：

```
删：daily_meal_items → daily_meals → 其余子表 → day_plans → 三类选项
插：三类选项 → day_plans → daily_meals → daily_meal_items
    → custom_tasks / daily_supplements / daily_exercise_items / routine_tasks
```

### 5.3 账号：不迁移密码

本地 `users.password_hash` 是 djb2 哈希，只够本地单人使用，**不迁移、也不假装能迁移**。
云端账号由 Supabase Auth 建立（邮箱 + 密码 + 邮箱验证），`profiles.user_id` 与之 1:1。
迁移时备份里的 `users` 记录只用于读取来源邮箱，其余字段丢弃；所有 `user_id` 重写为 `auth.uid()`。

### 5.4 历史日期是最大的障碍

本地备份里绝大多数是**过去的**计划，而云端触发器一律拒绝写今天之前的日期。
所以「直接逐表 insert」的方案在真实数据上必然全数失败——这不是边角情况，是主路径。
上面的 GUC 豁免就是为它准备的：把「迁移」和「日常编辑」区分开，
前者在受控事务里放行历史写入，后者的历史只读规则一个字不放。

### 5.5 迁移顺序是单向的

- 迁移**只读**本地库，不删除、不修改。本地数据在迁移后依然完整，可继续用本地后端。
- 不做云端 → 本地的反向迁移：那会引入「两份数据谁是真的」的问题，而本地后端已经能用本地备份自洽恢复。
- 因此回滚成本极低：重新部署本地构建即可，数据零损失。

## 6. 冲突与失败

### 6.1 冲突

| 场景 | 处理 |
| --- | --- |
| 同一账号两台设备同时编辑同一天 | last-write-wins，最后一次写入生效。不做事后合并：计划是「整体替换内容」的编辑模型，字段级合并会产出用户没写过的组合 |
| 导入时云端已有数据 | **替换**而非合并：先清空当前账号全部业务数据再写入，与本地备份导入语义一致（docs/05 L5）。确认框必须写明「替换」且不可撤销 |
| 两台设备同时导入 | 后到的整体覆盖先到的。这是「替换」语义的必然结果，确认框里已说明 |
| 选项被删而历史计划引用它 | 外键 `on delete set null`：历史项保留名称快照，只是失去来源链接；展示不受影响 |

不做「软删除 + 冲突表」的原因：本项目是单人使用，冲突面极小；
引入一套合并协议会让最简单的主路径（一个人、一台设备、改今天或明天）复杂化，收益为负。

### 6.2 断网与失败可见性

- 任何 Supabase 请求失败 → `normalizeSupabaseError` 收敛成 `DataError` → 界面显示
  「云端保存状态：保存失败」并给出错误码 / 原因，**不显示「已保存」**。
  这与 L5 的一条硬规则同源：本地保存不得伪装成云端同步成功，反方向同样成立。
- **本期不支持离线写入**（不排队、不重试、不落本地缓存）。
  理由：那会引入第三份数据副本和真正的双向冲突问题，而「断网时看不到云端数据」是云端模式的诚实代价。
  断网时用户看到的是明确的失败提示，而不是一个假成功的勾。
- 跨表操作（复制昨天、上行导入）走 RPC，天然在单个事务里，不存在写一半的中间态。

## 7. 验收清单

### 7.1 已在本机完成（无需云端凭据）

- `npm run typecheck` / `lint` / `build` 三件套。
- `npm run check:cloud-parity`：契约 ↔ 两种实现 ↔ 门面 ↔ 云端 SQL 的对应关系 50 项。
- `npm run verify:local`：本地后端闭环，行为与 L5 基线一致。
- 本地产物 0 命中 `supabase|PostgREST|GoTrueClient|copy_yesterday`；
  云端产物 0 命中 `indexedDB|happy-little-molly-local`。

### 7.2 必须有真实 Supabase 项目才能做（阶段二）

1. 按 `database/migrations/` 的**文件名顺序**执行四个迁移，确认四批都成功、且表 / 策略 / 触发器齐备（本机无 PostgreSQL，SQL 只做过静态检查）。
2. 关闭邮箱验证（或配好 SMTP），否则注册拿不到会话——适配器会明确报错而不是假装登录成功。
3. 注册 → 登录 → 退出 → 刷新恢复会话（`profiles` 由 `on_auth_user_created` 触发器自动建行）。
4. 跨设备同步：A 设备改今天的计划，B 设备刷新后看到同样内容。
5. RLS 双账号：账号 B 登录后看不到账号 A 的任何数据（含子表），直接构造越权查询也必须被拒。
6. 断网失败：断网后写入必须显示「保存失败」，恢复网络后可继续写入。
7. 本地数据上行迁移：导入一份本地备份，逐项核对历史计划、名称快照、准备与执行状态。
8. 真实上线：`npm run build:cloud` 产物部署，`.env.local` 只放 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_ANON_KEY`（都是可公开值；**不放 service_role**）。

## 8. 已知风险与未验证项

- **SQL 未在真实 PostgreSQL 上执行过**（本机没有 psql / Docker）。函数体、触发器与 RLS 策略只经过静态检查与 `check:cloud-parity` 的结构断言。
- **上行导入尚未实现**：云端模式下 `exportBackup` / `importBackup` 会明确抛 `cloud_backup_unsupported`，界面显示「本地模式专属」的说明，不静默失败。
- **邮箱验证依赖部署配置**：开启验证时注册流程会被明确拒绝并说明原因，属于有意行为，不是缺陷。
- **多表写入的非原子性**：除 `copy_yesterday_stage4` 与将来的导入 RPC 外，其余路径是逐表请求。
  中途失败会留下部分写入（例如三餐已存、内容项未存），下次保存会整体替换修正。
  这是 PostgREST 的固有限制；接受它的前提是本项目的编辑模型本身就是「整体替换」。
- **`updated_at` 冲突判定尚未启用**：docs/01 提到「用 `updated_at` 告知较新内容」，
  当前实现是 last-write-wins 加失败可见，没有做「提示对方有更新版本」。阶段二如启用，需要先定义提示时机。
