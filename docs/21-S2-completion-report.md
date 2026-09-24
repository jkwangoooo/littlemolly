# S2 完成报告：本地变更追踪

> 任务线：`docs/19-sync-execution-plan.md` §5 的 S2；方案依据：`docs/18-sync-architecture-plan.md` §4–§5。
> 上一阶段：`docs/20-S1-completion-report.md`。
> 完成日期：2026-09-19。**本阶段结束时应用仍不发任何网络请求**——推送是 S3/S4 的事。

## 1. 任务达成

| 任务 | 内容 | 状态 |
| --- | --- | --- |
| S2-T1 | 仓库三分类拆分（穷尽表驱动）；`BACKUP_STORES` 去掉设备仓库 | 完成（**实现与方案原文不同，见 §3.2**） |
| S2-T2 | `DB_VERSION` 5→6；新增 `sync_outbox` / `sync_state`；`MIGRATIONS[6]` 只建表；两个新仓库补字段契约 | 完成 |
| S2-T3 | `put` / `remove` / `runTransaction` 加 `{ track?: boolean }`；同事务内入队；`clear` 的显式保护 | 完成 |
| S2-T4 | 写入路径审计：`put`/`add`/`delete`/`clear` 四类一起扫，除 `localDb.ts` 外零命中 | 完成 |
| S2-T5 | 压缩规则：同键只留最后一条、`attempts > 0` 不参与、批内「后写覆盖先写」 | 完成 |
| S2-T6 | 新增 `npm run check:sync`（49 项纯函数回归） | 完成 |
| S2-T7 | `check:local-data` 11→13 仓库 + 三分类 + 写入钩子；`verify:local` 补 v5→v6 冷升级与队列运行时证据 | 完成 |

### 1.1 具体改动

**新增**

| 文件 | 作用 |
| --- | --- |
| `src/services/local/outboxRules.ts` | 队列的**纯规则**：压缩、批内去重、依赖层级排序、序号生成。不碰 IndexedDB，供写入钩子与 `check:sync` 共用 |
| `scripts/check-sync.mjs` | 49 项纯函数回归（入队范围 / 压缩 / 层级 / 序号 / 备份纯度 / 新仓库契约） |
| `docs/21-S2-completion-report.md` | 本文件 |

**改写**

| 文件 | 改动 |
| --- | --- |
| `src/services/local/localDb.ts` | `DB_VERSION` 5→6；`LocalStore` 加两张设备表并导出 `UserDataStore`；`STORES` 加两条定义（`seq`、`store_record` 索引）；`MIGRATIONS[6]`；`WriteOptions`；`buildOutboxEntries` / `writeOutbox` / `storeNamesFor`；三个写入口接入钩子 |
| `src/services/local/recordSchemas.ts` | 新增穷尽表 `STORE_KIND` 与派生常量 `USER_DATA_STORES`(10) / `META_STORES`(1) / `DEVICE_STORES`(2) / `ALL_STORES`(13)；`isSyncableStore` 改成类型谓词；`RECORD_SCHEMAS` 补两个新仓库的契约（13 张全有契约） |
| `src/services/local/backupFormat.ts` | `BACKUP_STORES` 改为「`SCHEMA_STORES` 去掉设备仓库」；`BACKUP_META_STORES` 改从 `META_STORES` 取；格式示例的 `db_version` 5→6 |
| `src/features/preferences/preferencesLabels.ts` | 仓库中文名表补 `sync_outbox` / `sync_state` 两项（`Record<BackupStore, string>` 要求穷尽） |
| `scripts/check-local-data.mjs` | 34 → **51** 项：v6 迁移、13 仓库、三分类不交叉且完备、设备表索引、写入钩子挂在三个入口、队列记录校验在事务外、`clear` 保护、直接写库扫描扩到四类操作 |
| `scripts/check-cloud-parity.mjs` | 56 → **58** 项：云端表覆盖口径改为「用户数据 + 元数据」，新增「云端覆盖的仓库 = 数据库全部仓库去掉设备状态」 |
| `scripts/verify-local.mjs` | 106 → **112** 项：冷升级补 v5→v6（表齐备 / 索引 / 空表 / 队列内容 / 删除也进队列） |
| `scripts/launcher.mjs` | 12 → **13** 项（新增 `check:sync`），重新编号，并修正 S1 起就未同步的项数 note |
| `package.json` | 新增 `check:sync` 脚本 |
| `README.md` / `HANDOFF.md` | 活文档同步（`DB_VERSION`、仓库数、命令与项数、S2 摘要） |
| `docs/18` / `docs/19` | 方案与任务线同步，含三处「实施修正」标注 |

**未动**：`src/services/cloud/*`、`src/services/api/*`、`src/services/contracts.ts`、`src/services/capabilities.ts`、业务界面（除仓库名表）。**本阶段业务行为零变化**，`verify:local` 里所有 S1 及更早的用例逐项未回退。

## 2. 关键决策

### 2.1 队列记录**不存数据副本**（方案原文的 `payload` 被砍掉）

`docs/18` §4.1 的 `OutboxEntry` 里有 `payload: Record<string, unknown> | null`。没有实现，队列只记 `store` / `record_id` / `op`。两条理由：

1. **契约系统只认标量字段**。`recordSchemas.ts` 的 `FieldRule` 是 `string | number | boolean`，要塞一个任意形状的对象就得给这一张表开一个不受校验的口子，而契约的全部价值正在于「任何落库的记录都过同一道关」。
2. **副本会与主表分叉**。推送时按 `record_id` 回主表读到的才是真正的最后值；存一份写入瞬间的快照，等于在库里放两个可能不一致的真相。

代价：推送时要多一次按主键读。这个代价换来的是「队列永远不可能比主表更新或更旧」。

### 2.2 `seq` 用「时间戳 × 1000 + 会话内自增」，而不是持久化计数器

方案要求 `seq` 单调递增。持久化计数器（每次写入都读一次 `sync_state` 再写回）会让**每一次业务写入多开一次读写**，而且读-改-写在同一事务里做不了跨事务互斥，多标签页下会撞号。

现方案：`Date.now() * 1000 + (会话内自增 % 1000)`。同一毫秒内连续写入也严格递增，跨会话按时间排序，零额外 I/O。**真正的推送顺序由依赖层级决定**（`SYNC_LAYERS`），`seq` 只负责给批次一个稳定的全序与分页依据——这也是它不需要绝对全局唯一的原因。

### 2.3 `clear` 命中用户数据仓库时**要求显式 `track: false`**，而不是自动记一批删除

`runTransaction` 的 `clear` 删的是整张表。如果按默认 `track: true` 放行，本地表空了、队列里却一条记录都没有，云端永远收不到这批删除——**这正是「不得伪装成功」要挡的形状**。

自动补一批删除也不对：`clear` 必须在事务里先读全部主键、再逐条入队，会打乱现有「clear → remove → put」的请求顺序（IndexedDB 事务按请求顺序执行，异步链式读会把 `clear` 挤到 `put` 之后）。

所以选择**大声失败**：`clear` 命中用户数据仓库且未显式 `track: false` 时直接抛错，让调用方说清楚「这批删除要不要同步」。当前无任何调用方（`clear` 只在 `localDb.ts` 里被定义），S5 的「云端恢复到本地」会用 `track: false`，语义正好。

### 2.4 `BACKUP_STORES` 用「过滤」而不是「拼接」

见 §3.2。简单说：`SCHEMA_STORES` 的键序就是摘要里「日计划 3 · 三餐 1 · 餐次内容 6」的排列顺序，拼接会把用户看得见的文案顺序改掉；而且拼接会丢掉 `users`。

### 2.5 队列规则住在 `local/` 而不是未来的 `sync/`

`docs/18` §8 把「出站队列的读写、压缩、按层级排序」划给 S3 的 `src/services/sync/outbox.ts`。这里把**纯规则**单独放进 `src/services/local/outboxRules.ts`，理由是：

- 规则要在**写入事务里**生效（压缩就是写入的一部分），而 `local/` 不该反向依赖将来会依赖它的 `sync/`；
- 规则必须能在 Node 里被 `check:sync` 直接导入，而 `sync/outbox.ts` 会带上网络与 IndexedDB 的 I/O。

S3 的 `sync/outbox.ts` 只负责「读队列、推送、出队、退避」，规则从 `outboxRules.ts` 取，两份实现不会分叉。

### 2.6 队列记录的字段校验挪到**事务外**

初版把 `assertRecord('sync_outbox', entry)` 放在事务中途（和业务写入同一个同步段）。这个形状有个隐患：一旦校验抛出，业务写入的请求**已经发出去**，事务照样会提交，结果就是「数据写了、队列没记」——恰好是这个钩子要防的事。

改为 `buildOutboxEntries()` 在开事务之前完成校验与组装，校验失败时连事务都不会开。这条不变量由 `check:local-data` 静态断言（「队列记录在事务外先过 `sync_outbox` 字段契约」）。

## 3. 计划外改动

### 3.1 `check:cloud-parity` 的云端表覆盖口径（必需）

第 4 组断言原本对 `LOCAL_SCHEMA.stores`（全部本地仓库）要求云端有对应表。设备状态表进来后必然假失败：`sync_outbox` / `sync_state` 是**本机**状态，云端没有、也不该有对应表。

已改为「用户数据 + 元数据仓库」口径（10 + 1 = 11，与 S1 时相同），并**新增一条反向断言**「云端覆盖的仓库 = 数据库全部仓库去掉设备状态」——防止以后有人加了一张用户数据表却忘了加云端表。`check:cloud-parity` 56 → 58 项。

### 3.2 方案原文两处算错（已纠正并回写 `docs/18` §4.2）

1. **`USER_DATA_STORES` 是 10 个不是 11 个**。`users` 已单独归入 `META_STORES`，三分类互不交叉，10 + 1 + 2 = 13 才对得上「13 张对象仓库」（`docs/18` 与 `docs/19` 的原文都写成 11）。
2. **`BACKUP_STORES` 不能写成 `[...USER_DATA_STORES]`**。那样会连 `users` 一起丢掉，而 `records.users` 是 `day_plans.user_id` 外键校验的父记录，后果是**应用自己导出的备份文件自己读不回来**（`parseBackup` 会把 `users` 判成「不认识的仓库」）。`check:backup` 第 106 行「备份仓库数等于 11 张业务表」当场抓到了这个错误。

实际实现：`SCHEMA_STORES.filter((store) => !DEVICE_STORES.includes(store))`，结果仍是原来的 11 张、顺序不变，`check:backup` 62/62 未回退。「过滤」不会漏掉将来新增的仓库——三分类表是 `Record<LocalStore, ...>`，漏分类一张表编译不过。

### 3.3 `scripts/launcher.mjs` 重新编号 + 修正陈旧项数

新增 `check:sync` 后任务从 12 项变 13 项，插在「静态回归」之后，后续任务重新编号；同步修正了 `README.md` 里引用编号的两处（`launch.cmd 7` → `8`、「第 10 项」→「第 11 项」）与 `launcher.mjs` 内部两处硬编码编号。

顺带发现并修正：任务 6 的 note 从 S1 起就没同步过（写着 `local-data 27 · backup 55 · cloud-parity 47`，实际是 34 / 62 / 56）。**项数变了要同步三处**（`README.md` 命令清单、`launcher.mjs` 的 note、`docs/19` §4 基线表）——这次把三处一起对齐了。

### 3.4 `preferencesLabels.ts` 的仓库名表必须补两项

`BACKUP_STORE_LABEL` 的类型是 `Record<BackupStore, string>`（`BackupStore = LocalStore`），加了仓库就编译不过。补了 `sync_outbox: '待上传队列'` / `sync_state: '同步状态'`，并在注释里写明这两项**永远不会出现在备份摘要里**（备份不含设备仓库），它们存在只是为了类型穷尽。

## 4. 验收证据

### 4.1 项数

| 命令 | S1 后 | S2 后 |
| --- | --- | --- |
| `typecheck` / `lint` / `build` | 通过 | 通过 |
| `check:dates` | 48 | 48 |
| `check:local-data` | 34 | **51** |
| `check:backup` | 62 | **62**（未回退，证明设备仓库没污染备份） |
| `check:cloud-parity` | 56 | **58** |
| `check:sync` | — | **49**（新增） |
| `verify:local` | 106 | **112** |
| `verify:pwa` | 43 | 43 |
| `dist` 命中 `supabase\|GoTrueClient\|PostgREST` | 0 | 0 |

### 4.2 关键输出（`verify:local`，真实浏览器）

```
PASS  v1 老库被升级到 v6 且十三张表齐备
      → version=6, tables=custom_tasks,daily_exercise_items,daily_meal_items,daily_meals,
        daily_supplements,day_plans,exercise_options,food_options,routine_tasks,
        supplement_templates,sync_outbox,sync_state,users
PASS  v6 建出 sync_outbox 并带 seq / store_record 索引  → indexes.sync_outbox=["seq","store_record"]
PASS  v6 建出 sync_state（单行表，无索引）              → indexes.sync_state=[]
PASS  v6 只建空表：同步状态还没有行（尚未绑定云端账号）  → sync_state=0 行
PASS  注册与播种的写入都进了待上传队列，且只含用户数据仓库
      → 队列 15 条：day_plans · exercise_options · food_options · routine_tasks · supplement_templates
PASS  队列条目都是尚未尝试过的（S2 不推送）             → attempts=[0]
PASS  删除食物后队列里出现一条 food_options 的 delete   → 队列 49 条，操作类型=["upsert","delete"]
PASS  未配置云端时整轮交互零跨域请求                   → http://127.0.0.1:13008 之外 0 条
```

这四条运行时证据合起来说明：**钩子在真浏览器里确实被调用了**，且入队范围正确——注册 + 播种产生 15 条队列记录（含休息日自动带出的 `routine_tasks`），一条 `users` 都没有；真删掉一项食物后队列里出现对应的 `delete`。`check:sync` 只能证明规则正确，这四条证明规则真的挂上了。

### 4.3 备份格式

导出的备份仍然是 `version: 2`（记录形状没变），`db_version` 从 5 变成 6——`parseBackup` 对 `db_version` 不一致只给一条提醒、不拒绝导入，所以 S1 时期的备份照样能导进来。

## 5. 缺陷与延后项

1. **队列只增不减**。S2 不推送，所以 `sync_outbox` 会一直累积。好在压缩生效，**队列大小 = 不同的「有变更的记录数」**，不是写入次数——日常使用是几十条量级，不会无限增长。S3 推送成功后出队，S5 的整体替换会清空队列。
2. **`attempts > 0` 的压缩分支只有纯函数覆盖**。S2 里 `attempts` 恒为 0，这条安全边界在运行时走不到，只有 `check:sync` 用构造数据验证。等 S3 真的开始推送、失败重试出现后才会被真实走到。
3. **每次写入多一次索引读 + 一次写入**。压缩需要先按 `store_record` 查旧行。批量导入 43 条会多 43 次索引读，实测无感知（`verify:local` 的备份往返用例耗时未变），但值得知道。
4. **`clear` 的 `track: false` 路径没有运行时覆盖**。当前无调用方，只有 `check:local-data` 的静态断言守着「保护存在」。S5 写 `replaceLocal` 时会是第一个真实调用方。
5. **跨标签页并发没有处理**。两个标签页同时写同一条记录，会各自入队一条（压缩只保证库内同键唯一，不保证跨事务的读-改-写互斥）。S4 的 Web Locks 是解决点，S2 不引入。

## 6. 未验证项

- **真实 Supabase 的任何行为**（RLS、约束、触发器、schema cache）——S2 不联网，这部分完全没有被触及。
- **推送 / 出队 / 退避 / 幂等**——S3、S4 的范围。
- **`sync_state` 的写入路径**——S2 只建了表与契约，一行都没写过；`verify:local` 断言的是「它还是空的」。
- **多标签页同时升级数据库**（`onblocked` 路径）——沿用 L5 的既有实现，S2 未新增覆盖。

## 7. 对下一阶段（S3）的影响

**现成可用的东西**

- `sync_outbox` 已经在记录变更，压缩已生效，`attempts` / `last_error` 字段已就位——S3 的推送引擎只需要「读队列 → 按 `SYNC_LAYERS` 排序 → 推送 → 成功出队 / 失败写回 `attempts` + `last_error`」。
- `sortChangesForPush()` / `layerOf()` / `compactionVictims()` 已是纯函数，S3 直接用，不必重写。
- `sync_state` 的表与契约已定（含 `cloud_user_id` / `bound_at` / `last_push_at` / `last_error_message` / `last_error_at`），S3 的账号绑定直接写这张表。
- `capabilities.ts` 的 `cloudSyncConfigured` 已就位，S3 用它决定同步卡是否可用。

**需要注意的点**

1. **推送前必须回主表读当前行**（§2.1）。队列里只有引用，读不到记录就说明它已经被删了——按 `op` 判断该跳过还是该报错。
2. **`users` 永远不进队列**，所以推送时 `cloud_user_id` 只能从 `sync_state` 取，不能从记录里取。
3. **`user_id` 重写**：四张带 `user_id` 的表（`day_plans` / `food_options` / `supplement_templates` / `exercise_options`）推送时要把本地 `user_id` 换成 `cloud_user_id`（`docs/18` §5.2）。
4. **S3 一旦开始写 `sync_state`，就要给 `put` 传 `{ track: false }`**——虽然 `sync_state` 是设备仓库、`isSyncableStore` 已经拦住了，显式传值能让意图更清楚，也符合 `docs/18` §5.1 的约定。
5. **`check:sync` 是扩充点**：S3 加推送后，队列规则回归要补「成功出队」「失败写回 `attempts`」「批次上限 100」。
