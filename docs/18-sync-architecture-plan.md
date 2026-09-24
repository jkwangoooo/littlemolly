# 数据架构升级：本地优先 + 云端同步 实施方案

> 状态：**方案待确认，尚未动工**。本文只定义要做什么、为什么这么做、按什么顺序做、每步怎么验收。
> 现行执行线仍是 `docs/05-local-first-execution-plan.md`；本文若与其冲突，以本文为**升级后的方向**，但需要你先确认 §10 的五个决策点。

---

## 0. 一句话结论

把「构建期二选一」改成「**本地恒为写入落点，云端是可选的上行通道**」：
页面照旧只写本地 IndexedDB（离线、单机、零网络依赖全部保留），本地每一次写入自动进一条出站队列并推送到 Supabase；
另外提供两个**用户主动触发**的整体替换操作——「本地上传云端」与「云端恢复到本地」，用来换设备、搬家和灾难恢复。

这不是小改。工作量大致相当于 L5 与 L6 相加，且会**推翻当前一条硬性保证**（见 §3.3）。

---

## 1. 现状盘点（事实，不是判断）

### 1.1 服务层

```
src/services/
  contracts.ts   契约：函数名只写一遍，签名从 local 实现 Pick 出来
  backend.ts     当前后端 = import.meta.env.MODE === 'cloud' ? 'cloud' : 'local'
  api/           门面，页面只 import 这里（@backend/* 由 vite alias 决定指向）
  local/         本地实现（IndexedDB），默认
  cloud/         云端实现（Supabase），与 local 逐条等价
    parity.ts    编译期断言：云端少一个函数就 typecheck 失败
  session.ts     后端无关的会话镜像（localStorage）
```

后端由**构建模式**决定，`npm run build` 走本地、`npm run build:cloud` 走云端，**同一份产物里只有一个后端**。

### 1.2 本地库

- `DB_VERSION = 5`，11 个对象仓库：`users` / `day_plans` / `daily_meals` / `daily_meal_items` / `custom_tasks` / `daily_supplements` / `daily_exercise_items` / `routine_tasks` / `food_options` / `supplement_templates` / `exercise_options`。
- 建表收敛在 `localDb.ts` 的 `STORES` + `MIGRATIONS`（只追加），字段契约在 `recordSchemas.ts` 的 `RECORD_SCHEMAS`，`put` / `runTransaction` 入库前 `assertRecord`。
- 写入口径只有三个：`put` / `remove` / `runTransaction`，请求级错误经 `guardRequest` 上抛。
- id 由 `crypto.randomUUID()` 生成，**就是标准 uuid v4**。

### 1.3 备份

`services/local/backupFormat.ts` 是纯数据层（不碰 IndexedDB），文件形状：

```json
{ "app": "happy-little-molly", "format": "local-backup", "version": 2, "db_version": 5,
  "exported_at": "...", "source_user": { "username": "..." },
  "counts": { ... }, "records": { "day_plans": [ ... ] } }
```

`parseBackup(text)` 做全量校验（字段契约逐条 + 外键完整性 + 主键去重 + 同一天不重复），**拿到返回值就意味着一条都还没写**；
导入是单事务整体替换，`user_id` 重映射已支持换设备搬家。这套东西是本次升级最大的可复用资产（见 §5.5）。

### 1.4 云端（已定稿，未在真实项目执行）

- 四个迁移：`stage1_auth_sync` → `stage2_day_plans` → `stage3_workday_planning` → `stage4_local_parity`，覆盖 11 张表，全部 RLS。
- `docs/13` 已定稿上行迁移方案：RPC `import_local_backup(jsonb)` + 事务级 GUC `molly.allow_history` 豁免历史日期触发器。
- 云端模式下 `exportBackup` / `importBackup` 明确抛 `cloud_backup_unsupported`，不假装成功。
- **本机没有真实 Supabase 项目（无 `.env.local`），四个迁移从未真实执行过**，SQL 只做过静态检查。

### 1.5 部署

当前只有一次性静态快照（`agentos-app.run`），没有正式 CI/CD，没有 Vercel / Cloudflare 配置。

### 1.6 验收基线

| 命令 | 项数 | 说明 |
| --- | --- | --- |
| `typecheck` / `lint` / `build` | — | 三件套 |
| `check:dates` | 48 | 纯 Node |
| `check:local-data` | 27 | 纯 Node |
| `check:backup` | 55 | 纯 Node |
| `check:cloud-parity` | 50 | 纯静态 |
| `verify:local` | 104 | 真实浏览器闭环 |
| `verify:pwa` | 42 | 生产产物 + 静态服务器 |

---

## 2. 需求拆解与范围边界

### 2.1 四条能力

| 你要的能力 | 本文的实现 | 触发方式 |
| --- | --- | --- |
| 保留本地数据功能 | 本地后端**恒为**唯一写入落点，读写不依赖网络 | 自动 |
| 数据自动上传云端 | 本地每次写入进 outbox → 防抖批量 upsert 到 Supabase | 自动（后台） |
| 本地上传云端 | RPC `import_local_backup`，整体替换云端当前账号数据 | 用户主动 + 二次确认 |
| 云端恢复到本地 | RPC `export_cloud_snapshot` → 喂给现有 `parseBackup` → 单事务整体替换本地 | 用户主动 + 二次确认 |

### 2.2 明确**不做**（一期）

1. **不做自动下载（cloud → local 增量 pull）。** 你只要求「自动上传」。自动 pull 会立刻引入多设备双向冲突、时钟偏移判定、`updated_at` 可信度这一整套问题，收益与成本不成比例。换设备走「云端恢复到本地」，语义清晰且可解释。
2. **不做字段级合并。** 冲突一律 last-write-wins，跨设备靠整体替换对齐。理由沿用 `docs/13 §6.1`：计划是「整体替换内容」的编辑模型，字段级合并会产出用户没写过的组合。
3. **不做离线写入云端队列的「保证送达」。** outbox 只在本地排队，失败了就如实显示失败并重试，不承诺最终一致。
4. **不迁移本地密码。** 本地 `users.password_hash` 是 djb2，云端账号由 Supabase Auth 独立建立（沿用 `docs/13 §5.3`）。
5. **不引入 Cloudflare Workers 作为边缘代理。** anon key 本来就是公开值，多一层代理只增加 CORS 与调试成本（见 §7.3）。

### 2.3 与现有文档的冲突点（必须显式处理）

| 冲突 | 现行依据 | 升级后 |
| --- | --- | --- |
| 后端由构建模式二选一 | `backend.ts` / `vite.config.ts` | 改为**运行时**：本地恒在，云端可选 |
| 本地产物 0 命中 `supabase` | `docs/13 §2`、`README.md` | **这条保证作废**，替换为「未绑定云端账号时运行时零跨域请求」（§3.3） |
| 云端适配器与本地逐条等价 | `contracts.ts` + `cloud/parity.ts` | 云端不再是页面后端，「等价」断言改为「每个本地仓库都有云端表 + 推送映射」（§9.2） |
| 云端模式不支持本地备份 | `cloud/backupService.ts` | 本地备份**恒可用**，不再有模式限制 |

---

## 3. 目标架构

### 3.1 分层

```
                    ┌─────────────────────────────────────┐
   页面（features/） │  只 import services/api/*            │
                    └───────────────┬─────────────────────┘
                                    │
                    ┌───────────────▼─────────────────────┐
   门面 services/api │  auth / dayPlan / option / backup    │  ← 恒指向 local
                    │  sync（新增）                        │
                    └───────┬─────────────────┬───────────┘
                            │                 │
            ┌───────────────▼──────┐   ┌──────▼────────────────────┐
   本地 services/local │ IndexedDB（唯一写入落点）│  │ services/sync（新增）      │
            │  put/remove/runTx    │   │  outbox → pushQueue        │
            │   ↓ 写一条 outbox    │   │  replaceCloud / replaceLocal│
            └──────────────────────┘   └──────┬────────────────────┘
                                              │ 动态 import()，未配置时不加载
                                       ┌──────▼────────────────────┐
                                       │ services/cloud（Supabase） │
                                       │  只做传输：upsert / rpc    │
                                       └───────────────────────────┘
```

### 3.2 五条核心原则

1. **本地是唯一写入落点。** 页面写数据永远只写 IndexedDB，成功与否只看 IndexedDB。云端不参与写入路径的成败判定。
2. **上传失败绝不伪装成功。** 本地保存状态与云端上传状态是**两个独立的、各自诚实的**状态（沿用 L5 硬规则的反方向）。
3. **跨表操作走 RPC。** 整体替换、复制昨天这类「全成或全不成」的操作，在云端是单个事务，在本地是单个 `runTransaction`。
4. **整体替换的方向只有两个，且都由人触发。** 没有隐式覆盖。
5. **同步是可选模块。** 未配置 Supabase 或未绑定账号时，应用行为与现在**逐字节等价**，且不发出任何跨域请求。

### 3.3 关键取舍：产物隔离判据的替换

现在的 `build:cloud` 存在的意义是让「本地产物不含 supabase」成为可检索的事实。运行时共存后这条不成立了。

**替换为一条更强的保证**，并纳入自动验收：

> 未配置 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`，或已配置但未绑定云端账号时，
> 应用在完整一轮交互中**零跨域请求**。

做法是双保险：

- **构建期**：`services/sync/` 通过 `await import()` 懒加载，未配置时该 chunk 根本不下载（`verify:pwa` 可断言 chunk 未被请求）。
- **运行期**：`verify:local` 增加 CDP 网络监听，断言整轮交互的非同源请求数为 0。

这比原判据更强：原判据只证明「代码没打进去」，新判据证明「**运行时也不会偷偷联网**」。

---

## 4. 数据模型改动

### 4.1 本地：`DB_VERSION` 5 → 6，新增两个仓库

**`sync_outbox`（出站队列）**

```ts
interface OutboxEntry {
  id: string            // uuid，主键
  seq: number           // 单调递增序号，保证推送顺序稳定
  store: UserDataStore  // 仅用户数据仓库，不含 users / sync_*
  record_id: string
  op: 'upsert' | 'delete'
  payload: Record<string, unknown> | null   // delete 时为 null
  created_at: string
  attempts: number
  last_error: string | null
}
// 索引：seq（排序）、store+record_id（压缩用）
```

> **实施修正（S2，2026-09-19）**：`payload` 没有实现，队列只记 `store` / `record_id` / `op`。
> 原因：字段契约（`recordSchemas.ts`）只支持标量字段，塞一个任意形状的对象进去
> 等于给这一张表开一个不受校验的口子；而且数据副本会与主表分叉，
> 推送时按 `record_id` 回主表读到的才是真正的最后值。见 `docs/21` §3。

**`sync_state`（单行状态）**

```ts
interface SyncState {
  id: 'singleton'
  enabled: boolean
  cloud_user_id: string | null
  cloud_email: string | null
  device_id: string          // 首次启动生成，用于云端诊断
  bound_at: string | null
  last_push_at: string | null
  last_restore_at: string | null
  last_error: { message: string; at: string } | null
}
```

> **实施修正（S2）**：`last_error` 摊平成 `last_error_message` + `last_error_at` 两列，理由同上；
> 另加一列 `updated_at`。见 `docs/21` §3。

两个仓库都**不进备份**（设备本地状态，不是用户数据）。

### 4.2 仓库分类必须拆开（一处必要重构）

现在 `SCHEMA_STORES` 同时驱动 `BACKUP_STORES` 与字段契约，新仓库进来后会污染备份与 `check:local-data`。拆成三类：

```ts
export const USER_DATA_STORES = [...]   // 10 个，进备份、进同步
export const META_STORES = ['users']    // 只用于备份外键自洽与来源账号展示
export const DEVICE_STORES = ['sync_outbox', 'sync_state']  // 本地状态，不进备份、不同步
export const ALL_STORES = [...USER_DATA_STORES, ...META_STORES, ...DEVICE_STORES]
```

`BACKUP_STORES` 改为「`SCHEMA_STORES` 去掉设备仓库」，`recordSchemas.ts` 的 `RECORD_SCHEMAS` 补两个新仓库的契约（`DEVICE_STORES` 也必须有契约，否则 `put` 会在运行时抛「未定义字段」）。

> **实施修正（S2，2026-09-19）**：本节初稿有两处算错，实施时已纠正，见 `docs/21` §3。
>
> 1. **`USER_DATA_STORES` 是 10 个不是 11 个**。`users` 已经单独归入 `META_STORES`，
>    三分类互不交叉，10 + 1 + 2 = 13 才对得上「13 张对象仓库」。
> 2. **`BACKUP_STORES` 不能写成 `[...USER_DATA_STORES]`**：那样会连 `users` 一起丢掉，
>    而备份里的 `records.users` 是外键校验的父记录（`day_plans.user_id` 指向它），
>    丢掉的后果是**应用自己导出的文件自己读不回来**（`parseBackup` 会把 `users` 判为「不认识的仓库」）。
>    正确写法是 `SCHEMA_STORES.filter((store) => !DEVICE_STORES.includes(store))`——
>    结果仍是原来的 11 张，且顺带保住了摘要里「日计划 3 · 三餐 1 · 餐次内容 6」的排列顺序。
>    三分类本身由 `Record<LocalStore, ...>` 穷尽兜底，漏分类一张表编译不过，
>    所以「过滤」不会漏掉将来新增的仓库。

### 4.3 云端：追加迁移 `202609190001_stage5_sync.sql`

只追加，不改写前四个迁移。内容：

1. **`device_sync_state` 表**（可选，用于云端侧观测）：`(user_id, device_id)` 唯一，记 `last_push_at`、`pushed_rows`。只读用途，不参与业务。
2. **RPC `import_local_backup(payload jsonb) returns jsonb`** —— 本地上传云端（§5.4）。
3. **RPC `export_cloud_snapshot() returns jsonb`** —— 云端恢复到本地的取数口（§5.5）。
4. **RPC `cloud_sync_summary() returns jsonb`** —— 只读条数摘要，给确认框显示「云端现有 N 条」。
5. **三个历史日期判定函数加受控豁免**（`reject_historical_day_plan` / `reject_historical_stage3_rows` / `reject_historical_meal_items`）：

```sql
if coalesce(current_setting('molly.allow_history', true), '') = 'on' then
  return case when tg_op = 'DELETE' then old else new end;
end if;
```

豁免只在 `import_local_backup` 的事务内、只对调用者自己的数据生效；`security invoker`，RLS 全程有效。日常编辑路径一个字不放。

6. **确保 11 张表都有 `updated_at` 与 `set_updated_at` 触发器**（`stage4` 已覆盖大部分，`stage5` 补齐差额并由 `check:cloud-parity` 断言）。

**约束口径不变**（`docs/13 §3`）：云端约束不得比本地更严；引用选项的外键一律 `on delete set null`。

---

## 5. 同步引擎设计

### 5.1 变更捕获（outbox）

**唯一钩子点是 `localDb` 的 `put` / `remove` / `runTransaction`。** 这是整个方案里最省事的一处：所有本地写入都过这三个口，不需要在每个业务服务里埋点。

```ts
put(store, value, options?: { track?: boolean })
remove(store, id, options?: { track?: boolean })
```

- 默认 `track: true`：同一事务内追加一条 outbox 记录（`upsert` / `delete`），**与业务写入原子**。
- `track: false`：不记录。只用于三类写入：
  1. 写 outbox / sync_state 自身（否则自激循环）；
  2. **云端恢复到本地**的整体替换（数据来自云端，回推没有意义）；
  3. 迁移搬迁（`MIGRATIONS[n].migrate`）。

`runTransaction` 的签名需要加一个「参与仓库列表」概念——现在它已经能跨仓库原子，把 `sync_outbox` 加进去即可。

**压缩规则**：同一 `(store, record_id)` 若有多条待推送记录，只保留最后一条（`upsert` 覆盖 `upsert`、`upsert` 后 `delete` 只留 `delete`）。
安全边界：**`attempts > 0`（已尝试过、可能已在途）的条目不参与压缩**，避免把正在推送的内容改掉。

### 5.2 推送（自动上传）

```
触发：本地写入成功 → 1.5s 防抖 → 且 navigator.onLine → 且已绑定账号
互斥：navigator.locks.request('molly-sync-push', ...)  ← 跨标签页只允许一个推送在跑
      （iOS 15.4+ / Chrome / Firefox 均支持；不支持时退化为「本标签页内的单飞标志 + IDB 租约」）
批次：按依赖层级排序，每批最多 100 条
      L0: food_options, supplement_templates, exercise_options
      L1: day_plans
      L2: daily_meals, custom_tasks, daily_supplements, daily_exercise_items, routine_tasks
      L3: daily_meal_items
      删除按层级**倒序**
失败：指数退避（1s → 2s → 4s … 上限 60s），写回 attempts / last_error，状态显示为「上传失败」
成功：删除对应 outbox 记录，更新 last_push_at
```

**幂等**：全部按主键 upsert（`on conflict (id) do update`）。本地 id 就是 uuid v4，**保留原 id 直接作为云端主键**，父子外键不需要重映射（`docs/13 §5.2`）。

**`user_id` 重写**：推送时把本地 `user_id` 换成 `cloud_user_id`（即 `auth.uid()`）。只有四张表有 `user_id`：`day_plans` / `food_options` / `supplement_templates` / `exercise_options`。子表不带 `user_id`（`docs/01` 不变量 2）。

**不推送的字段**：云端遗留列 `day_plans.exercise_content`、`daily_meals.plan_content` 不发送（映射器只发本地形状里存在的字段）。

**PWA 交互**：service worker **不缓存任何跨域请求**（现行规则），因此云端响应永远不会被本地缓存伪造。后台同步不做——iOS 不支持 Background Sync，做了也是两套行为；改为「应用回到前台」「`online` 事件」两个触发点。

### 5.3 云端账号绑定

**本地账号仍然是应用身份**，云端账号是可选侧挂。`AppSession` 与 `services/session.ts` **不改**——Supabase 自己的会话持久化（`persistSession: true`）管它自己的 token，两者互不干扰。

绑定流程（选项 → 账号与同步）：

```
未绑定：  [连接云端账号] → 输入邮箱 / 密码
          → supabase.auth.signInWithPassword（或 signUp）
          → 读 cloud_sync_summary() 得到「云端现有 N 条」
          → 分三种情形给不同确认文案：
             ① 云端 0 条：直接「把本地数据上传到云端」
             ② 云端有数据、本地也有数据：必须二选一，且写明会覆盖哪一边
             ③ 云端有数据、本地是空账号：建议「从云端恢复到本地」
          → 写 sync_state（enabled / cloud_user_id / cloud_email / bound_at）
          → 清空 outbox（此时两边已对齐）
已绑定：  云端账号邮箱 / 待上传条数 / 最后上传时间 / 上次失败原因
          [立即上传] [从云端恢复] [断开连接]
```

「断开连接」只清 `sync_state` 与 outbox，**不动本地数据，也不动云端数据**。

### 5.4 本地上传云端（整体替换）

```
选项 → 账号与同步 → [上传本地数据到云端]
  → 读本地全量（复用 exportBackup 的取数逻辑）
  → 显示「将用本地 N 条替换云端当前账号的全部数据，不可撤销」二次确认
  → supabase.rpc('import_local_backup', { payload })
  → 云端单个事务内：delete 当前用户全部业务行 → insert 全部 → 返回条数摘要
  → 成功后清空 outbox，更新 last_push_at
```

云端 RPC 要点：

- `security invoker`，**绝不**用 `service_role` 在浏览器直连。
- 事务内 `set local molly.allow_history = 'on'`，否则历史计划必然全数被触发器拒绝（**这是主路径，不是边角情况**，见 `docs/13 §5.4`）。
- 删除顺序：`daily_meal_items` → `daily_meals` → 其余子表 → `day_plans` → 三类选项。
- 插入顺序反向。
- 返回 `{ "imported": { "day_plans": 12, ... }, "total": 128 }`。

### 5.5 云端恢复到本地（整体替换）

**这一条几乎是白捡的**：云端的 `export_cloud_snapshot()` 直接吐出**与本地备份完全相同的文件形状**，本地侧喂给现有的 `parseBackup` + `importBackup` 即可，一条新的写入路径都不用写。

```
选项 → 账号与同步 → [从云端恢复到本地]
  → supabase.rpc('export_cloud_snapshot')
  → 得到 { app, format:'local-backup', version:2, db_version, exported_at,
            source_user:{username: <云端邮箱>}, counts, records }
  → parseBackup(JSON.stringify(snapshot))   ← 全量校验，一条都没写
  → 显示「将用云端 N 条替换本地当前账号的全部数据」二次确认
  → 本地单事务整体替换（track: false），user_id 重映射到当前本地账号
  → 清空 outbox
```

**一个必须处理的细节**：`parseBackup` 的外键校验要求 `day_plans.user_id` 能在 `records.users` 里找到父记录。所以 `export_cloud_snapshot()` 必须**额外输出一条合成 `users` 行**：

```json
"users": [{ "id": "<cloud_user_id>", "username": "<云端邮箱>" }]
```

本地导入的 `user_id` 重映射（L5 已实现，用于换设备搬家）会把它换成当前本地账号 id。这样云端快照与本地备份走**完全相同**的校验与写入路径，不存在第二条分支。

### 5.6 冲突与失败

| 场景 | 处理 |
| --- | --- |
| 两台设备先后推送同一天 | 云端 last-write-wins（`updated_at` 较新者胜），不做提示 |
| 一台设备推送、另一台不知道 | **接受**。另一台要拿到改动必须走「从云端恢复」。这是 §2.2 第 1 条范围的必然结果 |
| 断网时写入 | 本地照常成功（这是本地优先的意义），outbox 累积，恢复网络后自动补推 |
| 断网时推送 | 显示「上传失败」+ 错误码，**不显示「已上传」**；退避重试 |
| 推送中途失败 | 该批次内已成功的条目出队，未成功的保留并重试；下次推送重新发送（幂等 upsert） |
| outbox 丢失但本地数据在 | 删除操作不传播到云端。兜底是「本地上传云端」整体替换 |
| 云端有别的账号的数据 | RLS 保证看不见；`import_local_backup` 只删自己的行 |
| 上传/恢复过程中关页面 | 云端是单事务，要么全成要么全不成；本地是单事务，同理 |

**不做软删除、不做冲突表、不做 CRDT。** 单人使用，冲突面极小；引入合并协议会让最简单的主路径复杂化，收益为负（沿用 `docs/13 §6.1` 的判断）。

### 5.7 状态可见与文案红线

**两个状态必须分开显示，且都只说事实：**

| 位置 | 文案 | 禁止 |
| --- | --- | --- |
| 日计划页顶部（沿用 `SaveStatusBar`） | 「本地保存状态：已保存 / 正在保存 / 保存失败」 | 不说「已同步」 |
| 选项 → 账号与同步 | 「待上传 3 条」「已上传，2 分钟前」「上传失败：<错误码>」 | 不说「已保护」「数据安全」 |
| 备份卡 | 「备份是唯一的兜底路径」 | 不说「云端有备份就够了」 |

沿用 `docs/16` 已确立的红线：**安装不等于保护，上传不等于备份。** 云端同步是便利，不是保险。

---

## 6. 服务层改造清单（逐文件）

### 新增

| 文件 | 职责 |
| --- | --- |
| `src/services/capabilities.ts` | 取代 `backend.ts`：`DATA_BACKEND` 恒为 `'local'`；`cloudSyncConfigured`（构建期 env）；`supportsLocalBackup` 恒 true |
| `src/services/sync/outbox.ts` | 出站队列的读写、压缩、按层级排序 |
| `src/services/sync/pushQueue.ts` | 防抖、Web Locks 互斥、退避、批次推送 |
| `src/services/sync/mapper.ts` | 本地记录 ↔ 云端行映射（`user_id` 重写、遗留列剔除） |
| `src/services/sync/accountLink.ts` | 绑定 / 解绑、`sync_state` 读写、三种绑定情形的判定 |
| `src/services/sync/replaceCloud.ts` | 本地上传云端（取数 → 二次确认数据 → RPC） |
| `src/services/sync/replaceLocal.ts` | 云端恢复到本地（RPC → `parseBackup` → 单事务替换） |
| `src/services/sync/status.ts` | 同步状态聚合（待上传条数 / 最后成功时间 / 最后错误） |
| `src/services/api/syncService.ts` | 门面：页面只认这里 |
| `src/services/cloud/rpc.ts` | Supabase RPC 调用与错误标准化 |
| `src/features/preferences/components/SyncCard.tsx` | 账号与同步子屏 |
| `vercel.json`、`public/_redirects`、`public/_headers` | 部署配置 |

### 改造

| 文件 | 改动 |
| --- | --- |
| `src/services/local/localDb.ts` | `DB_VERSION` 5→6；加 `sync_outbox` / `sync_state`；`put`/`remove`/`runTransaction` 加 `track` 选项；`MIGRATIONS[6]` |
| `src/services/local/recordSchemas.ts` | 补两个新仓库契约；导出 `USER_DATA_STORES` / `META_STORES` / `DEVICE_STORES` |
| `src/services/local/backupFormat.ts` | `BACKUP_STORES` 改为「`SCHEMA_STORES` 去掉设备仓库」（见 §4.2 的实施修正） |
| `src/services/contracts.ts` | 新增 `SYNC_KEYS`；删除「云端必须实现同一契约」的语义 |
| `src/services/cloud/parity.ts` | 断言改为：每个 `USER_DATA_STORE` 都有云端表 + 推送映射 |
| `src/services/cloud/backupService.ts` | 不再是「明确拒绝」，改为转发到 `sync/replaceLocal`、`sync/replaceCloud` |
| `src/services/api/backupService.ts` | 恒指向 local 实现 |
| `src/features/preferences/PreferencesScreen.tsx` | 「账号与同步」子屏接新卡片 |
| `src/features/preferences/preferencesLabels.ts` | 同步文案段 |
| `src/app/styles.css` | 同步状态样式 |
| `vite.config.ts` | 移除 `@backend` 的 cloud 分支（或保留但不再用于部署） |
| `package.json` | 新增 `check:sync`、`verify:sync`；`build:cloud` 标记废弃 |
| `scripts/check-cloud-parity.mjs` | 判据重写（§9.2） |

### 废弃

- `src/services/cloud/authService.ts`、`dayPlanService.ts`、`optionService.ts`：不再作为页面后端。其中可复用的 upsert / 错误标准化逻辑迁到 `sync/` 与 `cloud/rpc.ts`，其余删除。
- `dist-cloud/` 与 `build:cloud`：不再需要（先保留一个版本周期，确认无回归后删）。

---

## 7. 部署方案

### 7.1 Supabase（数据与认证）

- 按文件名顺序执行五个迁移：`stage1` → `stage2` → `stage3` → `stage4` → **`stage5_sync`**。
- **关闭邮箱验证**（或配好 SMTP）。开着验证时 `signUp` 拿不到会话，适配器会明确报错——这是有意行为，但对「连接云端账号」这个流程是硬阻塞。
- Auth 设置：`Site URL` 与 `Redirect URLs` 需要**逐个部署域名加白名单**（Vercel 生产域名、Cloudflare Pages 域名、本地 `http://localhost:5173`）。
- 只用 `anon` / `publishable` key。**`service_role` 绝不出现在前端或 `.env.local`。**
- 免费额度对本项目（单人、纯文本、每天几十行）完全够用。

### 7.2 Vercel

`vercel.json`：

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [
    { "source": "/sw.js", "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }] },
    { "source": "/manifest.webmanifest", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
    { "source": "/assets/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }
  ]
}
```

- Build Command：`npm run build`；Output Directory：`dist`。
- 环境变量（Production / Preview / Development 三档都要配）：`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`。

### 7.3 Cloudflare Pages

- 同一份 `dist/`，配置放在源码里：
  - `public/_redirects`：`/*  /index.html  200`
  - `public/_headers`：与上面的 Cache-Control 规则一致
- Pages 会**先查静态资源**再应用 `_redirects`，所以 `/sw.js`、`/assets/*`、`/icons/*` 不会被 SPA 兜底吞掉。
- **Cloudflare Workers 一期不用。** anon key 是公开值，不需要边缘代理去藏；引入 Workers 会带来 CORS、额外故障点与调试成本。若以后需要（例如把导出文件归档到 R2、或做全局速率限制），再单独立项。

### 7.4 两个平台并存

同一份产物可同时部署到 Vercel 与 Cloudflare Pages，两个配置文件互不干扰（Vercel 不读 `_headers`/`_redirects`，Cloudflare 不读 `vercel.json`）。
两者都需要在 Supabase 的 Redirect URLs 里加白名单。**推荐先只上一个**（Vercel 更省事），验收通过后再加第二个。

---

## 8. 分阶段实施计划

> 每阶段结束都跑：`typecheck` / `lint` / `build` + 四个 check 脚本 + `verify:local`；改动 PWA 外壳时另跑 `verify:pwa`。

### S1 架构切换与能力声明

**目标**：把「构建期二选一」改成「本地恒在 + 云端可选」，且**行为零变化**。

- 新增 `capabilities.ts`，`backend.ts` 保留为兼容转发后删除。
- `api/*` 门面全部改为直接指向 `../local/*`（去掉 `@backend/*`）。
- `cloud/` 从「页面后端」降级为「传输层」，页面不再 import。
- 产物隔离判据替换（§3.3）：`verify:local` 增加「整轮交互零跨域请求」断言。

**验收**：三件套 + 四个 check + `verify:local`（104 + 新增断言）全绿，**行为与 S1 之前逐项一致**。

### S2 本地变更追踪

**目标**：写入自动进 outbox，但不推送。

- `DB_VERSION` 5→6；`sync_outbox` / `sync_state` 落库。
- `put` / `remove` / `runTransaction` 加 `track` 选项，默认记录。
- 仓库三分类拆分（§4.2），`recordSchemas.ts` 补契约。
- 新增 `npm run check:sync`（纯 Node）：outbox 压缩规则、层级排序、`track:false` 不记录、备份不含设备仓库。

**验收**：`check:local-data` 更新到 13 仓库全绿；`check:sync` 全绿；`check:backup` 62 项不回退（证明设备仓库没污染备份）；`verify:local` 含 v5→v6 冷升级。

### S3 云端账号绑定与连接

**目标**：能连上云端账号，但还不动数据。

- `sync/accountLink.ts` + `cloud/rpc.ts` + `cloud_sync_summary()` RPC。
- 选项 → 账号与同步子屏：连接 / 状态 / 断开。
- `services/sync/` 懒加载（`await import()`），未配置时不加载。
- 三种绑定情形的判定与文案。

**验收**：`verify:local` 新增「未配置云端时同步卡片显示不可用且不发起任何请求」；有凭据时人工验收连接流程。

### S4 自动上传（增量推送）

**目标**：本地写 → 自动推到云端。

- `sync/outbox.ts` + `pushQueue.ts` + `mapper.ts` + `status.ts`。
- 防抖 1.5s、Web Locks 互斥、指数退避、批次上限 100。
- 同步状态卡显示「待上传 N 条 / 已上传，X 前 / 上传失败：<原因>」。

**验收**：新增 `npm run verify:sync`——用 CDP 拦截 `*.supabase.co/rest/v1/*` 与 `/rpc/*`，用一个内存假云端跑完整闭环：
写入 → outbox → 推送 → 假云端收到正确行；断网 → 状态为失败且 outbox 不清空；恢复 → 自动补推；重复推送幂等（假云端行数不变）。
**这是本次唯一不需要真实凭据就能闭环验收的部分**，也是最有价值的一条。

### S5 双向整体替换

**目标**：两个手动操作落地。

- 云端：`import_local_backup` + `export_cloud_snapshot` + 三个触发器的 GUC 豁免。
- 本地：`replaceCloud.ts` / `replaceLocal.ts`（后者复用 `parseBackup` + `importBackup`）。
- 二次确认文案与不可撤销说明；成功后清空 outbox。

**验收**：`check:sync` 增加「云端快照 → `parseBackup` 必须通过」的用例（用假快照 JSON）；`check:cloud-parity` 断言 `stage5` 里两个 RPC 与豁免代码存在；真实项目上跑一次完整往返（本地导出 → 上传云端 → 清空本地 → 从云端恢复 → 逐项核对）。

### S6 部署与真机验收

- `vercel.json` / `_redirects` / `_headers`；Supabase Auth 域名白名单。
- 上 Vercel → 真机装 PWA → 走完整流程：本地记账 → 看上传状态 → 换设备 → 云端恢复。
- 更新 `README.md`、`HANDOFF.md`，写 `docs/19` 完成报告。

**验收**：§9.3 的清单逐项打勾，含 RLS 双账号与断网。

---

## 9. 验收与回归改造

### 9.1 新增

| 命令 | 内容 |
| --- | --- |
| `check:sync` | 纯 Node：outbox 压缩、层级排序、`track:false`、备份不含设备仓库、云端快照能过 `parseBackup` |
| `verify:sync` | 真实浏览器 + 假云端（CDP 拦截），覆盖推送 / 失败 / 补推 / 幂等 / 整体替换 |

### 9.2 改造

| 命令 | 改动 |
| --- | --- |
| `check:local-data` | 11 → 13 仓库；断言三分类不交叉；`DB_VERSION = 6` 且迁移只追加 |
| `check:backup` | 断言 `BACKUP_STORES === USER_DATA_STORES`，设备仓库不进备份 |
| `check:cloud-parity` | **判据重写**：① 每个 `USER_DATA_STORE` 在 `stage1..stage5` 里都有表；② 每张表都有 RLS 与 `updated_at` 触发器；③ `stage5` 含两个 RPC 与三处 GUC 豁免；④ 引用选项的外键仍是 `on delete set null`；⑤ 页面不绕过门面直连 `services/local` |
| `verify:local` | 新增「零跨域请求」断言；v5→v6 冷升级；未配置云端时同步卡显示不可用 |
| `verify:pwa` | 新增：未配置云端时 `sync` chunk 未被请求；`/sw.js` 的 Cache-Control 正确 |

### 9.3 必须有真实凭据才能做（人工清单）

1. 五个迁移在真实项目按序执行成功，表 / 策略 / 触发器齐备。
2. 关闭邮箱验证后：连接云端账号 → 上传 → 退出 → 重新登录 → 状态恢复。
3. **RLS 双账号**：账号 B 看不到账号 A 的任何数据（含子表），直接构造越权查询被拒。
4. **断网**：写入本地成功、上传显示失败、恢复网络后自动补推成功。
5. **历史日期**：上传含历史计划的备份必须成功（这是 GUC 豁免的主路径验证）。
6. **整体替换往返**：本地 → 云端 → 清空本地 → 云端 → 本地，逐项核对历史计划、名称快照、准备与执行状态。
7. 真机：Vercel 域名装 PWA，走完整流程；确认底部导航不被 Home 指示条遮挡。
8. 两个部署平台各自冒烟（若上两个）。

---

## 10. 风险、未决项与需要你确认的决策

### 10.1 必须你拍板的五件事

| # | 决策点 | 选项 | 我的建议 |
| --- | --- | --- | --- |
| 1 | **产物隔离保证作废**，是否接受 | A 接受，改用「零跨域请求」判据 ／ B 保留 `build:cloud`，做三构建模式 | **A**。B 会让测试面翻倍，且「本地构建不含 supabase」这条保证在运行时共存后本就没有意义了 |
| 2 | **是否需要自动下载（cloud → local 增量）** | A 一期不做 ／ B 一起做 | **A**。B 会引入多设备冲突、时钟偏移、`updated_at` 可信度一整套问题；「从云端恢复」已覆盖换设备场景 |
| 3 | **Cloudflare 的角色** | A 只做静态托管（Pages） ／ B 加 Workers 边缘代理 ／ C 只做 DNS/CDN | **A**。B 没有实际收益（anon key 本就公开），只增加故障点 |
| 4 | **同时上 Vercel 和 Cloudflare 还是先上一个** | A 先 Vercel ／ B 两个都上 | **A**。两个平台的 `_redirects` / `vercel.json` 都准备好，但验收只跑一个，稳定后再加 |
| 5 | **本地账号与云端账号的关系** | A 本地账号是应用身份，云端账号侧挂绑定（不迁密码） ／ B 直接用云端账号做应用身份 | **A**。B 会让应用在离线 / 未配置时无法使用，直接摧毁本地优先 |

### 10.2 已知风险

- **`verify:sync` 的假云端是自建的**，它证明的是「我们的推送逻辑正确」，**不能**证明「真实 Supabase 会接受这些请求」（RLS、约束、触发器、schema cache 都可能不一样）。真实项目验收不可替代。
- **多设备一致性有限**：不做自动 pull，B 设备不会自动看到 A 设备的改动。这是刻意的范围边界，但**必须在界面上说清楚**，否则用户会以为「上传了就等于到处都有了」。
- **outbox 与业务写入的原子性依赖 `runTransaction`**。若某条写入路径没走 `runTransaction` 而是独立 `put`，两者可能不同步。S2 需要审计所有写入路径。
- **`updated_at` 由数据库触发器生成**，多设备时钟不同步不会影响（时间戳来自服务器），但「较新者胜」的判定需要云端 `updated_at` 真正可用——`stage4` 是否已覆盖全部 11 张表需要在 S5 前核实。
- **免费额度**：Supabase 免费项目长时间无活动会被暂停。对本项目（每天使用）不构成问题，但值得知道。
- **iOS 后台限制**：PWA 在后台不会被唤醒，推送只发生在应用前台。这是平台限制，不是缺陷。

### 10.3 未决项（实施中再定）

- `device_sync_state` 是否真的需要（可能只是诊断用，S4 看情况）。
- outbox 是否需要在「应用启动时」做一次完整性检查（对比 outbox 与数据，找出漏记的写入）。
- 断网时是否在界面上加一个「有 N 条待上传」的常驻小提示，还是只在选项页显示。

---

## 附：与既有文档的关系

| 文档 | 关系 |
| --- | --- |
| `docs/01-architecture-data-contract.md` | 七条不变量**全部继续有效**，云端落点见 `docs/13 §4` |
| `docs/05-local-first-execution-plan.md` | L0–L6 已完成，本文是其后的新执行线 |
| `docs/13-L6-cloud-migration-and-conflict-plan.md` | §5 的上行迁移方案**被本文采纳**（`import_local_backup` + GUC 豁免），从「阶段二待做」变为 S5 |
| `docs/16-pwa-shell-completion-report.md` | PWA 外壳与缓存策略**不变**；「安装不等于保护」的红线继续适用 |
| `docs/17-options-page-ia-research.md` | 选项页「概览 + 子屏」结构不变，「账号与同步」子屏扩容 |
