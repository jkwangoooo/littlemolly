# 幸福小Molly：本地优先 + 云端同步 执行任务线

> 本文是 `docs/18-sync-architecture-plan.md`（方案）的**执行版**：把方案拆成可逐条开工、逐条验收的任务。
> 上一代执行线是 `docs/05-local-first-execution-plan.md`（L0–L6，已完成）。
>
> **2026-10-13 现行认证方向已由 [账密改造详细执行文档](43-账密改造详细执行文档.md) 接替。**
> 本文保留 S1-S6 实施历史，同时更新现行决策、基线与生产待办；历史的本地注册、双身份绑定和旧验收数量不再用于发布新版。

## 1. 已锁定的决策

以下五条已确认，实施期间不再重新讨论；如要推翻，先改本节。

| # | 决策 | 结论 |
| --- | --- | --- |
| D1 | 产物隔离判据 | Supabase SDK 保持动态加载；无 Auth 配置如实显示不可登录，不能本地注册绕过。状态展示不隐式请求云端，认证、首次恢复及上传按明确生命周期执行 |
| D2 | 自动下载（cloud → local 增量 pull） | 不做通用增量 pull 或自动合并；新设备/未准备工作区认证后必须先恢复该 UID 数据，再开放业务。既有工作区保留未上传编辑；两个手动整体替换继续要求确认 |
| D3 | Cloudflare 的角色 | **只做静态托管（Pages）**。不引入 Workers 边缘代理 |
| D4 | 部署平台 | **先只上 Vercel**。两个平台的配置都写好，验收只跑一个 |
| D5 | 账号模型 | **Supabase Auth 唯一认证，同一 Auth UID 关联资料、业务和队列**。只保留 W 的可用身份，移除本地密码认证、公开注册与二次绑定；旧数据先保全和隔离，不猜归属 |

## 2. 目标状态（一句话）

Supabase Auth 验证 W 并准备同一 UID 的工作区；本地 IndexedDB 恒为业务唯一写入落点，
每次写入进 outbox，经联网身份重验后上传到 Supabase。新设备先恢复该 UID 数据，
既有工作区离线编辑与未上传队列保留；另有两个用户主动触发的整体替换操作——「本地上传云端」与「云端恢复到本地」。

## 3. 执行原则

1. **每阶段只做本阶段范围**，做完再进下一阶段；每阶段结束必须全绿。
2. **本地保存状态与云端上传状态永远分开、各自诚实**。上传失败绝不显示「已上传」。
3. **跨表操作走单事务**：本地 `runTransaction`，云端 RPC。不做逐表写一半。
4. **既有工作区整体替换只由人触发**，且确认框必须写明「替换」与不可撤销。新设备首次恢复仅针对未准备的工作区，不覆盖既有未上传编辑。
5. **云端约束不得比本地更严**；引用选项的外键一律 `on delete set null`。
6. **`docs/01` 的七条不变量继续有效**，包括名称快照、复制不带执行状态、历史日期只读。
7. 页面只 import `src/services/api/`，不得直连 `services/local` 或 `services/cloud`。

## 4. 每个阶段结束都要跑的验收

```bash
npm run typecheck && npm run lint && npm run build
npm run check:dates && npm run check:local-data && npm run check:backup && npm run check:cloud-parity && npm run check:sync
npm run verify:local
```

改动 PWA 外壳或构建产物时追加 `npm run verify:pwa`；改动同步引擎（`services/sync/`）时追加 `npm run verify:sync`；
改动 `database/migrations/` 或四个应用 RPC（`account_access` / `cloud_sync_summary` / `export_cloud_snapshot` / `import_local_backup`）时
追加 `npm run verify:sql`。它是唯一一条**真的连数据库**的验收（起临时集群跑真实迁移），
需要本机装 PostgreSQL 16+，因此**不放进 `all`**——`all` 要能在任何开发机上跑完。
身份与反馈上下文改动时另跑 `npm run check:feedback`。交付前另跑 `node scripts/验证认证并发.mjs`、`node scripts/验证旧工作区迁移.mjs` 和 `node scripts/验证部署凭据护栏.mjs`，覆盖 SDK 事件竞态、真实旧库迁移和凭据输出护栏；这些专项也不在启动器 `all` 中。

### 当前基线（2026-10-13）

下列为本轮已确认的实测结果，全部通过，最终命令退出码均为 0。

| 命令 | 当前结果 | 现行覆盖 |
| --- | --- | --- |
| `typecheck` / `lint` | 通过，退出码 0 | 类型与静态检查 |
| `build:no-empty` | 通过，退出码 0 | 生产构建 |
| `check:dates` | 48/48 | 日期规则 |
| `check:local-data` | 75/75 | v8、18 仓库、旧身份隔离与本地写入契约 |
| `check:backup` | 96/96 | v3 无凭据备份与 v1/v2 兼容、父链及来源引用保护 |
| `check:cloud-parity` | 114/114 | 页面门面、Auth 边界、7 迁移及权限契约 |
| `check:sync` | 149/149 | 统一 UID、队列、映射及替换规则 |
| `check:feedback` | 16/16 | 身份变化时反馈上下文 |
| `node scripts/验证认证并发.mjs` | 12/12，退出码 0 | 准备期间退出、迟到广播、UID 变化与连续重登 |
| `node scripts/验证旧工作区迁移.mjs` | 69/69（v6 19 项、v7 50 项） | 真实旧库升级、隔离、事务回滚、幂等重试与显式复制 |
| `node scripts/验证部署凭据护栏.mjs` | 20/20 | 部署凭据和错误输出护栏 |
| `verify:local` | 172/172，退出码 0 | 真实浏览器业务与认证/迁移回归 |
| `verify:pwa` | 64/64，退出码 0 | 本轮构建懒模块预缓存、首次离线工作区/账号页、更新失败旧首页保护、缓存头与键盘避让 |
| `verify:sync` | 195/195，退出码 0 | 假 Auth/云端及异步身份隔离 |
| `verify:sql` | 87/87，退出码 0 | 临时 PostgreSQL、7 个迁移、4 RPC、RLS/GRANT |

本地假 Auth/云端和临时 PostgreSQL 不证明真实 Supabase、W、现网或真机通过。
计数变更同步 `README.md`、`scripts/launcher.mjs`、本表与 `HANDOFF.md` 顶部当前基线。
SQL 验收与浏览器验收串行，避免把基础设施超时误作 SQL 规则拒绝。

### 历史阶段基线

下表为 S1-S6 旧模型实施时的实测记录，保留历史证据：

| 命令 | S1 后 | S2 后 | S3 后 | S4 后 | 缺陷修复后 | S5 后 | UI 一期后 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `check:dates` | 48 | 48 | 48 | 48 | 48 | 48 | 48 |
| `check:local-data` | 34 | 51（13 仓库 + 三分类 + 写入钩子） | 51 | 51 | **62**（+ v7 搬迁规则 / 读写原语契约 / 账号归属） | 62 | 62 |
| `check:backup` | 62 | 62（证明设备仓库没污染备份） | 62 | 62 | 62 | 62 | 62 |
| `check:cloud-parity` | 56 | 58（云端表只对用户数据仓库，设备仓库不要求有表） | **60**（+ 同步门面必须动态 import） | **66**（+ 列级对齐 / `updated_at` / 推送映射 / 策略；T7 清理后净 −2） | 66 | **78**（+ 第 ⑩ 组：三个 RPC / `security invoker` / 三处豁免的顺序与事务级开关） | 78 |
| `check:sync` | — | 49（新增） | 54（+ 绑定情形判定） | **85**（+ 批次上限 / 事件名 / 相对时间 / 文案口径 / 映射层） | **96**（+ 队列归属 / `sync_state` 按账号分行 / v7 迁移登记） | **113**（+ 第 13、14 组：整体替换的前置规则 / 云端快照必须能过 `parseBackup`） | 113 |
| `verify:local` | 106（含零跨域断言） | 112（+ v5→v6 冷升级 + 队列运行时证据） | **114**（+ 未配置云端时同步卡说明不可用） | 114 | **119**（+ 并发建计划回归 + v6→v7 真实搬迁） | 119 | **125**（+ 下一步、连续完成与撤销、本地失败重试反馈、工作日切休息日庆祝动效） |
| `verify:pwa` | 43（含工作日判定） | 43 | 43 | 43 | 43 | **49**（+ 六条部署配置断言：`vercel.json` SPA 回退与缓存头 / `_headers` 进了产物 / 不放 `404.html` 与 `_redirects`） | 49 |
| `verify:sync` | — | — | — | **49（新增）** | **56**（+ 换本地账号不串推） | **74**（+ 双向整体替换：二次确认 / 整份替换不是合并 / 失败如实报错且两边一行没动） | 74 |
| `verify:sql` | — | — | — | — | — | **39（新增）** | 39 |

> **「缺陷修复后」这一列**是 2026-09-19 的两次缺陷修复（`docs/24`），不属于 S1–S6 任何一段：
> ① `upsertDayPlan` 的读-改-写拆在两次调用里，并发时会撞 `day_plans.user_date` 唯一索引；
> ② `sync_state` 是设备级单行，换本地账号后会把新账号的数据推到上一个账号绑定的云端。
> 两处都改了**业务行为**（新增 `readModifyWrite` 原语、`DB_VERSION` 6→7 的一次搬迁），
> 所以基线与 S4 不同。S5 的项数在 S5 开工时重算。

> **S4 的项数口径**：`verify:sync` 的 49 项里有两项是**自检**（构建期配置确实注入、
> CDP 的 URL 模式确实拦到了请求）。留着它们是因为这两件事一旦不成立，
> 后面所有同步断言都会以「云端收到 0 条」的形式失败，很难看出根因不在业务代码。

> **`verify:sql` 的 39 项**（2026-09-20 新增，是 **S5 的前置**，不属于 S1–S6 任何一段）：
> stage1–stage5 五个迁移从写下到 S5 之前**只做过静态检查**。`check:cloud-parity` 是文本比对，
> 它证明「该写的都写了」，证明不了「写的东西跑得起来」——语法错、函数名拼错、策略写反、
> `jsonb_populate_recordset` 的列不匹配，这一类只有真库能发现，而症状全都出现在运行时（也就是用户那边）。
> 其中最要紧的一条是**快照字段集合与本地 `RECORD_SCHEMAS` 逐张表严格比对**。
> 这个脚本自己也踩过两个坑，记在这里免得下次重犯：
> ① Windows 版 `psql` 的 stdout 是 **CRLF**，多行输出 `split('\n')` 之后每行末尾留一个不可见的 `\r`，
> 逐行比对会**整片假失败**（打印出来两侧字符串一模一样），归一放在 `query()` 一处；
> ② 一张表在快照里**没有行**时，它那一行的字段集合是空的，比对失败看起来像「字段清单与契约分叉」，
> 其实是夹具没覆盖到这张表——所以另立一条「夹具覆盖了快照里的每一张表」，把这两类失败分开。
> 两条断言都做了反证：给 stage6 的 `supplement_templates` 清单故意多加一列 → 精确报出该表多出 `legacy_note`；
> 把 `exercise_options` 从夹具清空 → 精确报出该表没有数据。确认它们真的会红之后才留下。

> **S2 的一处计划外改动**：`check:cloud-parity` 的第 4 组断言原本对**全部**本地仓库要求云端有表，
> 设备状态表进来后必然假失败（`sync_outbox` / `sync_state` 云端没有、也不该有对应表）。
> 已改为「用户数据 + 元数据仓库」口径，并新增一条「云端覆盖的仓库 = 数据库全部仓库去掉设备状态」，
> 防止反过来漏掉某张用户数据表。

---

## 5. 分阶段任务线

S1-S5 为历史实施记录，保留当时的任务与证据。当前认证、首次恢复和 owner 迁移按第 43 份文档执行；S6 使用下方更新后的发布前置。

### S1：架构切换与能力声明

**目标**：把「构建期二选一」改成「本地恒在 + 云端可选」，**业务行为零变化**。

| 任务 | 内容 |
| --- | --- |
| S1-T1 | 新增 `src/services/capabilities.ts`：`DATA_BACKEND` 恒为 `'local'`、`cloudSyncConfigured`（构建期 env）、`supportsLocalBackup` 恒 `true`。删除 `src/services/backend.ts` |
| S1-T2 | 四个门面（`api/authService` / `dayPlanService` / `optionService` / `backupService`）改为直接 `export * from '../local/xxx'`；`vite.config.ts` 移除 `@backend` 别名 |
| S1-T3 | 随能力声明调整文案与卡片：`SAVE_STATUS_PREFIX` 恒为「本地保存状态：」、`ACCOUNT_TEXT` / `STORAGE_WHY` 去掉云端分支、`BackupCard` 去掉 `available` 开关 |
| S1-T4 | 构建脚本与启动器收口：移除 `dev:cloud` / `build:cloud`，更新 `scripts/launcher.mjs` 的任务清单 |
| S1-T5 | 判据替换：`check-cloud-parity` 重写（去掉 `@backend` 相关断言，保留 SQL 覆盖断言）；`verify:local` 增加「整轮交互零跨域请求」断言 |
| S1-T6 | 文档同步：`README.md` 的数据后端一节、`HANDOFF.md` 的交接摘要 |

**验收**：三件套 + 四个 check + `verify:local` 全绿；业务行为与 S1 之前逐项一致；`src/services/cloud` 仍不被任何非云端模块引用（此时云端适配器是冻结的种子，S4 才启用）。

---

### S2：本地变更追踪

**目标**：写入自动进 outbox，但**还不推送**。

| 任务 | 内容 |
| --- | --- |
| S2-T1 | 仓库三分类拆分：`recordSchemas.ts` 导出 `USER_DATA_STORES`（**10**）/ `META_STORES`（`users`）/ `DEVICE_STORES`（`sync_outbox`、`sync_state`）/ `ALL_STORES`（13），由一张穷尽表 `Record<LocalStore, 'user'\|'meta'\|'device'>` 驱动；`backupFormat.ts` 的 `BACKUP_STORES` 改为「`SCHEMA_STORES` 去掉设备仓库」 |
| S2-T2 | `localDb.ts`：`DB_VERSION` 5→6，新增 `sync_outbox`（索引 `seq`、`store_record`）与 `sync_state`（单行）；`MIGRATIONS[6]` 登记且不做数据搬迁；两个新仓库补 `RECORD_SCHEMAS` 契约 |
| S2-T3 | 写入钩子：`put` / `remove` / `runTransaction` 增加 `{ track?: boolean }`，默认 `true` 时在同一事务内追加 outbox 记录；`track:false` 用于 outbox 自身、迁移搬迁、以及 S5 的云端恢复。`clear` 命中用户数据仓库时要求显式 `track:false`（不静默漏记） |
| S2-T4 | 写入路径审计：逐个确认 `local/*` 的业务写入都过 `put` / `remove` / `runTransaction`，不存在绕过钩子的直连 `objectStore` 写操作（`put`/`add`/`delete`/`clear` 四类一起扫） |
| S2-T5 | outbox 压缩：同一 `(store, record_id)` 只保留最后一条；`attempts > 0` 的条目不参与压缩；批内同键去重按「后写覆盖先写」（先删后写的顺序保证导入备份收敛成 `upsert`） |
| S2-T6 | 新增 `npm run check:sync`（纯 Node）：入队范围、压缩规则、依赖层级排序、序号单调、设备仓库进不了备份、两个新仓库的字段契约 |
| S2-T7 | 更新 `check:local-data`（11→13 仓库、三分类不交叉、写入钩子挂在三个入口）与 `verify:local`（冷升级链路补 v5→v6、队列内容的运行时证据） |

**验收**：`check:local-data` / `check:backup` / `check:sync` 全绿；`verify:local` 含真实 v5→v6 冷升级且老数据可读；**此时应用仍不发任何网络请求**。

---

### S3：云端账号绑定与连接

**目标**：能连上云端账号，但**还不动数据**。

| 任务 | 内容 |
| --- | --- |
| S3-T1 | `src/services/cloud/rpc.ts`：Supabase RPC 调用封装 + 错误标准化（复用 `cloud/errors.ts`） |
| S3-T2 | `src/services/sync/accountLink.ts`：绑定 / 解绑、`sync_state` 读写、三种绑定情形判定（云端空 / 两边都有 / 本地空） |
| S3-T3 | `src/services/sync/status.ts`：同步状态聚合（待上传条数、最后成功时间、最后错误） |
| S3-T4 | `SyncCard.tsx` + `preferencesLabels.ts` 同步文案段；接进「账号与同步」子屏 |
| S3-T5 | 懒加载：`services/sync/` 全部经 `await import()` 进入，未配置云端时不加载该 chunk |
| S3-T6 | `verify:local` 增加断言：未配置云端时同步卡显示不可用、且整轮交互零跨域请求（与 S1-T5 合并口径） |

**验收**：三件套 + 全部 check 全绿；未配置云端时行为与 S2 完全一致；有凭据时人工验收连接 / 断开流程。

---

### S4：自动上传（增量推送）

**目标**：本地写 → 自动推到云端。

| 任务 | 内容 |
| --- | --- |
| S4-T1 | `src/services/sync/mapper.ts`：本地记录 ↔ 云端行映射（`user_id` 重写为 `cloud_user_id`、剔除云端遗留列 `exercise_content` / `plan_content`） |
| S4-T2 | `src/services/sync/outbox.ts`：出队、批次切分（按依赖层级 L0–L3，删除倒序）、成功后删除 |
| S4-T3 | `src/services/sync/pushQueue.ts`：1.5s 防抖、`navigator.locks` 跨标签互斥（降级方案：单飞标志 + IDB 租约）、指数退避（1s→60s 上限）、批次上限 100 |
| S4-T4 | 状态接线：`SyncCard` 显示「待上传 N 条 / 已上传，X 前 / 上传失败：<原因>」；**两个状态分开、都不说「已同步」** |
| S4-T5 | 新增 `npm run verify:sync`：CDP 拦截 `*.supabase.co/rest/v1/*` 与 `/rpc/*`，挂内存假云端，覆盖 写入→推送→假云端收到正确行 / 断网失败且 outbox 不清空 / 恢复后自动补推 / 重复推送幂等 |
| S4-T6 | `database/migrations/202609200001_stage5_sync.sql`：给 `daily_meal_items` / `daily_exercise_items` / `routine_tasks` 补服务端 `updated_at` 与 `set_updated_at` 触发器（`stage4` 只覆盖了 7/11）；`check:cloud-parity` 增加 `updated_at` / 触发器 / **列级对齐** / 推送映射断言 |
| S4-T7 | 清理 L6 遗留的页面后端适配器：`cloud/` 下的 `authService` / `dayPlanService` / `optionService` / `backupService` / `optionSeed` / `types` / `syncTestRecordService` / `parity` **整批删除**（页面只走本地，它们零消费者；upsert / delete 原语已在 `sync/outbox.ts`，无需搬迁），只留同步传输层四模块 `errors` / `identity` / `rpc` / `supabase`；`contracts.ts` 从「两侧等价」改成**页面接口清单**，`check:cloud-parity` 第 1 组改为断言「本地实现 + 门面」，并新增第 2 组钉住这次清理 |

**验收**：`verify:sync` 全绿；`check:cloud-parity` 增加「每个 `USER_DATA_STORE` 都有云端表 + 推送映射」断言。

---

### S5：双向整体替换

**目标**：两个手动操作落地。

| 任务 | 内容 |
| --- | --- |
| S5-T1 | SQL：`import_local_backup(payload jsonb)`——`security invoker`，事务内 `set local molly.allow_history = 'on'`，先删后插，返回条数摘要 |
| S5-T2 | SQL：三个历史日期判定函数（`reject_historical_day_plan` / `reject_historical_stage3_rows` / `reject_historical_meal_items`）加受控豁免 |
| S5-T3 | SQL：`export_cloud_snapshot()` 返回与本地备份**完全相同的文件形状**，**必须额外输出一条合成 `users` 行**（否则 `parseBackup` 外键校验整份拒绝） |
| S5-T4 | SQL：`cloud_sync_summary()` 只读条数摘要，供确认框显示「云端现有 N 条」 |
| S5-T5 | `src/services/sync/replaceCloud.ts`：读本地全量 → 二次确认 → RPC → 成功后清空 outbox |
| S5-T6 | `src/services/sync/replaceLocal.ts`：RPC → `parseBackup` 全量校验 → 单事务整体替换（`track:false`）→ 清空 outbox |
| S5-T7 | `check:sync` 增加第 13、14 组（整体替换的前置规则：非 UUID 的 id 与空的一侧都要拦住；云端快照必须能过 `parseBackup`）；`check:cloud-parity` 增加第 ⑩ 组，断言 `stage6` 含三个 RPC、都显式 `security invoker`、三处历史日期豁免**写在日期比较之前**且用事务级 `set local` 打开 |
| S5-T8 | 新增 `npm run verify:sql`：起临时 PostgreSQL 真跑六个迁移，断言结构 / 三个 RPC 往返 / **快照字段集合与本地契约逐张对齐** / 替换语义（先删后插）/ 豁免不泄漏到事务外 / RLS 双账号隔离 |

**验收**：全部 check + `verify:local` + `verify:sync` + **`verify:sql`** 全绿；真实项目上跑一次完整往返（本地导出 → 上传云端 → 清空本地 → 从云端恢复 → 逐项核对）。

---

### S6：部署与真机验收

**目标**：上线并跑通真机流程。

| 任务 | 内容 |
| --- | --- |
| S6-T1 | ~~`vercel.json`：SPA rewrite + `/sw.js` 与 manifest 的 `Cache-Control: no-cache` + `/assets/*` 长缓存~~ **已完成（2026-09-20）**，见下 |
| S6-T2 | ~~`public/_headers`（同缓存规则），为 Cloudflare Pages 备好~~ **已完成（2026-09-20）**；**`public/_redirects` 经查证后刻意不写**，见下 |
| S6-T3 | 本地认证改造验收完成后，核实真实项目与迁移历史；执行缺失迁移，可信准备 W 与实际 UID allowlist，核实密码策略、身份确认、注册限制及 Site URL/Redirect URLs |
| S6-T4 | 按 `docs/27` 和第 43 份文档验收真实表/RPC/RLS/GRANT、W 登录/重登、新设备恢复、断网重验、旧 JWT 门禁、历史日期往返、缓存头与真机；设置构建变量后发布 |
| S6-T5 | 收口 `README.md`、`HANDOFF.md`、本文当前基线与中文实施/发布记录；未验证项逐条保留，不宣称生产完成 |

**验收**：现行 [部署执行说明](27-deploy-runbook-for-codex.md) 的真实清单逐项记录；旧 `docs/18 §9.3` 仅作为历史业务往返参考。

#### S6-T1 / T2 落地说明（2026-09-20）

**`vercel.json`**（仓库根目录）：一条 `rewrites: [{ source: "/(.*)", destination: "/index.html" }]`
做 SPA 深链接回退，加四条 `headers`——`/sw.js` 与 `/manifest.webmanifest` 与 `/index.html` 一律 `no-cache`，
`/assets/(.*)` 一年 `immutable`。理由：`/assets/*` 文件名带内容哈希、内容永不改；反过来
service worker 必须每次回源，否则用户永远拿不到新版本（它自己控制了其余缓存）。

**`public/_headers`**（会随 `vite build` 复制进 `dist/`）：Cloudflare Pages 的等价物，
路径行 + 缩进头，`/assets/*` 用单星号，与 `vercel.json` 同一套缓存口径。

**`public/_redirects` 刻意不写**——这一条与计划原文相反，依据是 Cloudflare 官方文档：

> Redirects defined in `_redirects` are **always executed, whether or not there is a matching static asset**.

原计划的 `/* /index.html 200` 是一条 catch-all，按上述语义会把 `/sw.js` 与 `/assets/*`
**一起改写**成 `index.html`：浏览器拿一份 HTML 当 JS 解析 → **整站白屏**，且本地完全看不出来。
而 Cloudflare Pages 在构建产物**没有顶层 `404.html`** 时会自动启用 SPA 回退
（官方：*Pages assumes that you are deploying a single-page application*），本就不需要 `_redirects`。

三条对应断言已进 `verify:pwa`（49 项）：
① `vercel.json` 有指向 `/index.html` 的通配 rewrite；② 两份配置的缓存口径一致且都进了产物；
③ 产物里**没有**顶层 `404.html`（有了会静默关掉内置回退）；④ 产物里**没有** `_redirects`（守「别加回来」）。
四条都做了反证：逐条破坏 → 确认只红对应那一条 → 还原 → 复验回绿。

**顺带修掉一个会让 `verify:pwa` 假失败的沙箱问题**：脚本里有两次构建，而 Vite 默认在
build 开始时把 `dist/` 整个清空重建——在受沙箱保护的机器上，那是「一轮内递归删掉几十个文件」，
会被 `safe-delete` 的批量保护拦下（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`，阈值 50、**按 turn 累计**），
于是脚本在浏览器阶段**全绿**之后倒在最后一步，报出被截断的 Vite 堆栈、看起来像项目自己的 bug。
修法：新增 `npm run build:no-empty`（`tsc -b && vite build --emptyOutDir=false`），
`verify:pwa` 两次构建都走它、**不删 `dist/`**（旧哈希文件留着不违反任何断言）。
`npm run build` 保持原样，供人工 / CI 做干净构建。

---

## 6. 每步必须守住的东西

- 新增 IndexedDB 仓库走满四步：`LocalStore` → `STORES` → `DB_VERSION` → `MIGRATIONS`，并在 `RECORD_SCHEMAS` 补字段契约。
- 改 `localDb` 写入口径（`put` / `remove` / `runTransaction`）时，请求级错误必须经 `guardRequest` 上抛。
- 新增云端表必须在 `stage5` 之后**追加**新迁移，并让 `check:cloud-parity` 的表覆盖 / RLS / 触发器断言继续通过。
- 新增本地服务函数时，同步侧的映射要同步；漏改由 `check:sync` 与 `check:cloud-parity` 拦下。
- 任何「上传 / 同步」相关文案，先问一句：**这句话是事实吗？** 说得出「上次同步时间」就等于暗示同步成功。

## 7. 当前下一步

**2026-10-13 账密改造源码与本机自动验收已完成，本次尚未生产迁移、准备 W、更新 Vercel 环境或发布。**
详细方案见第 43 份文档，本地实施与部署交接见第 44 份文档，完整实测数量见 §4 当前基线。

1. 保留本机完整验收证据，完成文件差异与敏感内容复核并记录本地实施提交；将第 44 份文档和现行部署说明交给部署员。本地实现与验收已完成，生产操作仍按后续前置推进。
2. 用已有本机受保护凭据只读核实真实 Supabase/Vercel 项目、现网提交和迁移历史，盘点旧数据与 W 的目标 UID。已有库只执行缺失迁移，空库才使用完整合并 SQL。
3. 在可信 Auth 管理入口核实/准备 W、用户指定密码与身份确认，关闭公开注册及无关身份入口，核实 URL 配置；实际 Auth 用户存在后才写受保护单行 allowlist。
4. 核实 12 张 public 表、4 应用 RPC、RLS/GRANT 与旧 UID/JWT 门禁，刷新 schema cache，再设置 Production 构建变量和发布。
5. 在真实域名完成登录、重登、新设备恢复、断网重验、首页/深链接/缓存头和真机验收；失败与未验证如实记录。旧数据处置未明确前不删身份、不自动合并。

**本机四项部署凭据已存在，无需重复索取或输出值。** 真实项目 ref、W UID、密码策略、线上提交与真实验收尚未核实，不能由本地结果推断成功。

### 历史进度（2026-09-20）

**S1 已完成（2026-09-19）**，完成报告见 `docs/20-S1-completion-report.md`。
**S2 已完成（2026-09-19）**，完成报告见 `docs/21-S2-completion-report.md`。
**S3 已完成（2026-09-19）**，完成报告见 `docs/22-S3-completion-report.md`。全部 check 与两个 verify 全绿。

**S4 已完成（2026-09-20）**：自动上传（增量推送）。T1–T7 全部落地，完成报告见 `docs/23-S4-completion-report.md`。
全部 check 与三个 verify 全绿（`check:dates` 48 · `check:local-data` 51 · `check:backup` 62 ·
`check:cloud-parity` 66 · `check:sync` 85 · `verify:local` 114 · `verify:pwa` 43 · `verify:sync` 49）。

**S4 收尾时的两个缺陷已修复（2026-09-19）**，完成报告见 `docs/24-two-defect-fixes-report.md`：

1. **`upsertDayPlan` 的读-改-写拆在两次调用里**，并发时会撞 `day_plans.user_date` 唯一索引
   （休息日注册后界面报 `Unable to add key to index 'user_date'`）。
   修法：`localDb.ts` 新增 `readModifyWrite`（**事务内先读后写**），
   `upsertDayPlan` 与同形状的 `setMealCompleted` 都改走它。
2. **`sync_state` 是设备级单行**，换本地账号后新账号会读到上一任的绑定，
   把自己的数据推到**别人的云端账号**里。修法：`sync_state` 改成**按本地账号一行**
   （主键 = 本地账号 id），`sync_outbox` 记归属账号并在推送时过滤，
   `DB_VERSION` 6→7 做一次只追加搬迁（`MIGRATIONS[7]`）。

修复后的基线：`check:dates` 48 · `check:local-data` **62** · `check:backup` 62 ·
`check:cloud-parity` 66 · `check:sync` **96** · `verify:local` **119** · `verify:pwa` 43 · `verify:sync` **56**。

> **S5 的代码与 SQL 已落地（2026-09-20）**，任务表见 §5：`stage6` 迁移的三个 RPC、
> `sync/replaceCloud.ts` / `replaceLocal.ts` / `replaceRules.ts`、`check:sync` 第 13、14 组、
> `check:cloud-parity` 第 ⑩ 组都已就位。
>
> 与之配套新增了 **`npm run verify:sql`（39 项）**：它起一个临时 PostgreSQL 集群，
> 把 `database/migrations/` 里的六个迁移**真的执行一遍**再断言行为。
> 所以「`stage1`–`stage5` 五个迁移只做过静态检查」这句话**不再成立**——
> 静态检查（`check:cloud-parity`）证明「该写的都写了」，`verify:sql` 证明「写的东西跑得起来」。
>
> **剩下的是「在真实 Supabase 项目上跑一次完整往返」**（本地导出 → 上传云端 → 清空本地 →
> 从云端恢复 → 逐项核对），前置条件仍是真实凭据。`verify:sql` 证明不了的正是那一层：
> PostgREST 的 schema cache、GoTrue 的会话与邮箱验证、Site URL、连接池——只有真实项目能验。
> S5 的完成报告见 **`docs/25-S5-completion-report.md`**；基线见 §4 表的「S5 后」一列。
> 那份报告的 §6 就是这一阶段剩下的全部工作（真实凭据 + 真机清单）。

> **S6 的部署配置已落地（2026-09-20）**：`vercel.json`（S6-T1）与 `public/_headers`（S6-T2 的一半）
> 已就位，并有四条断言（`verify:pwa` 43 → **49**）守着它们，全部做了反证。
> **`public/_redirects` 经查证后刻意不写**——Cloudflare 文档明确 `_redirects` 的规则
> 「不管有没有静态资源匹配都会执行」，原计划的 catch-all 会把 `/sw.js` 与 `/assets/*`
> 一起改写成 HTML、导致整站白屏；而 Pages 在无顶层 `404.html` 时自带 SPA 回退，本就不需要它。
> 详细依据与断言见 §5 的「S6-T1 / T2 落地说明」。
>
> **所以 S6 剩下的确实只有「有凭据才能做的事」**：S6-T3（Supabase 控制台配置）、
> S6-T4（真实凭据 + 真机清单）、S6-T5（收口文档）。见 `docs/26-S6-handoff-for-codex.md`。

> **S4 执行期间的 T7 清理（删了 8 个文件，1156 行）：** 这批 L6 遗留的页面后端适配器
> （`cloud/authService` 113 行、`dayPlanService` 634 行、`optionService` 204 行、
> `backupService` 56 行、`optionSeed` 65 行、`syncTestRecordService` 42 行、`parity` 34 行、`types` 8 行）
> 在 S1 之后**零消费者**：页面只走本地，同步层只用 `errors` / `identity` / `rpc` / `supabase` 四个模块。
>
> 计划里写的是「改造为同步传输层（保留 upsert 原语）」，实际做成了**删除**，理由是原语不需要搬：
> `sync/outbox.ts` 早就自己实现了 upsert（`from(store).upsert(rows, { onConflict: 'id' })`）
> 与 delete（`.delete().in('id', ids)`），并没有复用那批适配器里的任何函数。
> 留着半死的模块比删掉更贵——它们会让人以为「改本地签名要同步改云端」，
> 而这正是 S1 已经否掉的模型。
>
> **删除的硬证据**：删前删后各构建一次，产物**逐字节同尺寸**
> （`index` 295.23 kB、`supabase` 221.11 kB、`accountLink` 1.83 kB、`pushQueue` 3.11 kB、
> `syncState` 0.67 kB、`status` 0.66 kB，只有内容哈希变了）——它们本来就没被打进任何 chunk。
> 因为 `.git` 在本机不可用（无法回滚），删除前把整个 `cloud/` 目录原样备份到
> `.workbuddy-ai/backup/cloud-l6-adapters/`（12 个文件、1344 行，与删除前逐行一致）。
>
> 契约随之换了定位：`contracts.ts` 不再是「两种后端的等价性判据」，而是**页面接口清单**
> （四个模块的键名数组 + 从本地实现 `Pick` 出的类型，编译期保证清单里的名字真实存在）。
> `check:cloud-parity` 第 1 组因此从「本地 + 云端两侧都导出」改成「本地实现 + 四个门面都导出」，
> 第 2 组换成**「云端目录只剩同步传输层四模块」+「L6 适配器已删除」**——
> 把清理结果钉住，将来谁想加回一个「云端 xxxService」都得先改这条断言。

> **S4 执行期间的一处口径修正（T6）：** 本节原先把 T6 写成「补齐 11 张表的 `updated_at` **差额**」，
> 措辞容易被读成「云端缺列导致推不上去」。实测不是这样——先写了一个临时探针把
> 「本地字段契约」与「云端建表 / 加列」逐表对齐，结论是：
>
> 1. **推送方向本来就没有缺列**。`stage4` 建的三张子表（`daily_meal_items` 6 列、
>    `daily_exercise_items` 6 列、`routine_tasks` 5 列）与本地契约**逐字段完全一致**，
>    反而是 `day_plans.exercise_content` / `daily_meals.plan_content` /
>    `daily_meals.created_at`、`updated_at` / `custom_tasks.created_at`、`updated_at`
>    这六列**云端有、本地没有**，由 `mapper.ts` 剔除。
> 2. 真正缺 `updated_at` 的只有三张子表，**理由是服务端时间戳**（`docs/18 §5.4` 的多设备
>    last-write-wins 需要一份来自数据库、可审计的变更时间），**不是**「与本地对齐」。
>    这三列是云端自己的列，本地契约里**不该**有：加了就会变成上报本机时钟，
>    恰好破坏 LWW 的可信度。
> 3. 原计划里「`device_sync_state` 诊断表（可选）」一期没有消费者（D2 不做增量拉取），
>    **不做**。
>
> 顺带补上的断言比原计划宽：T6 验收只要「每个 `USER_DATA_STORE` 都有云端表 + 推送映射」，
> 实际把**列级对齐**也钉住了（本地字段在云端都有同名列 / 云端多出的列都可省略 /
> `user_id` 归属与映射层一致 / 每张表都有策略）。表名对得上不代表推得动，
> 「本地有字段、云端无此列」的报错症状是「本地正常、云端一条没有、队列堆积」，最难倒查。
> 断言做过反证：临时移走 `stage5` 后该条立刻以三张表名失败，不是空断言。

> **S3 执行期间的四处计划外改动（已记入完成报告）：**
> 1. **`backupService.ts` 抽出 `collectUserRecords()`**：「当前账号有哪些数据」这个问题现在有三个消费者
>    （导出备份、绑定云端时判断本地是否为空、S5 的「本地上传云端」取数），而子表归属要沿父键逐级推导，
>    写第二遍必然分叉。`exportBackup` 改为调它，行为不变（`check:backup` 62/62 守住）。
> 2. **`backupFormat.ts` 的 `countRecords` 改为导出**：界面上的「本地共 N 条」必须与备份摘要的 `total`
>    同一口径，否则会出现「界面说 12 条、导出的备份说 10 条」。
> 3. **`localDb.ts` 新增 `count(storeName)`**：数条数不该把数据读进内存（队列可能积压上千条）。
> 4. **`judgeBindingCase` 拆到 `sync/bindingRules.ts`**：第一次写回归时才发现 `sync/accountLink.ts`
>    在纯 Node 下 import 不了（它拖着的 `@supabase/functions-js` 解析失败，`MODULE_NOT_FOUND`）。
>    按 `local/outboxRules.ts` 的同一套做法拆成纯文件——**能回归的规则才算规则**。
>
> 另有一处断言口径更新（不是新增能力）：`check:cloud-parity` 第 6 组从
> 「除云端目录自身没有任何模块引用 `services/cloud`」改为「只允许 `services/sync/` 引用，
> 且同步门面必须用动态 `import()`」——S3 起云端适配器重新有了消费者，旧口径必然假失败。

> **S2 执行期间的三处计划外改动（已记入完成报告）：**
> 1. `check:cloud-parity` 的云端表覆盖断言从「全部本地仓库」改为「用户数据 + 元数据仓库」——
>    设备状态表按定义在云端没有对应表，原断言必然假失败。
> 2. `backupFormat.ts` 的 `BACKUP_STORES` 不能写成 `[...USER_DATA_STORES]`（会连 `users` 一起丢掉，
>    导致应用自己导出的备份自己读不回来），实际实现是「`SCHEMA_STORES` 去掉设备仓库」。
> 3. `scripts/launcher.mjs` 重新编号（12 → 13 项），并顺手修正了「静态回归四件套」note 里
>    从 S1 起就未同步的项数（`local-data 27 · backup 55 · cloud-parity 47` → 实测值）。

> **S1 执行期间的两处计划外改动（已记入完成报告）：**
> 1. `scripts/verify-pwa.mjs` 补上「目标日先确认为工作日」——原脚本假定当天是工作日，在周六 / 周日会假失败（实测 2026-09-19 周六 39/42）。`verify-local.mjs` 从 L3 起就有同样处理，这次是补齐，不是新做法。
> 2. 同文件把「执行今天空计划一屏放下」改成按当天实际模式分别断言——正常休息日 `useDayPlanData` 会自带拖地 / 洗衣，页面本就不是空的，「余量 ≥24」这个为空页面留的 iOS 字体缓冲不适用。**「内容区不需要滚动」这一条不分模式，始终要求。**
>
> 两处都是测试脚本的日期依赖问题，不涉及业务代码。

