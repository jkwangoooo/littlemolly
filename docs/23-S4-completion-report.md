# S4 完成报告：自动上传（增量推送）

> 执行文档：`docs/19-sync-execution-plan.md` §5 的 S4 任务表。
> 方案：`docs/18-sync-architecture-plan.md`（§5.4 推送、§6 模块清单）。
> 完成日期：2026-09-20。上一阶段报告见 `docs/22-S3-completion-report.md`。

## 1. 任务达成

S4 的目标是**本地写 → 自动推到云端**。七项任务全部落地：

| 任务 | 状态 | 落地位置 |
| --- | --- | --- |
| S4-T1 本地行 ↔ 云端行映射 | ✅ | `src/services/sync/mapper.ts`（新建） |
| S4-T2 出队、批次切分、推送执行 | ✅ | `src/services/sync/outbox.ts`（新建） |
| S4-T3 防抖 / 跨标签互斥 / 指数退避 | ✅ | `src/services/sync/pushQueue.ts`（新建） |
| S4-T4 状态接线与文案 | ✅ | `SyncCard.tsx`、`preferencesLabels.ts`、`shared/date/relativeTime.ts`（新建） |
| S4-T5 新增 `verify:sync` | ✅ | `scripts/verify-sync.mjs`（新建，49 项） |
| S4-T6 `stage5` 迁移 + 列级对齐断言 | ✅ | `database/migrations/202609200001_stage5_sync.sql`（新建）、`scripts/check-cloud-parity.mjs` |
| S4-T7 云端遗留适配器清理 | ✅ | 删除 `src/services/cloud/` 下 8 个文件（1156 行） |

### 1.1 具体改动

**新建（5 个源码文件）**

- `src/services/sync/mapper.ts` —— `toCloudRow()`、`ROW_MAPPERS`（类型 `Record<UserDataStore, RowMapper>`，
  漏一张表编译不过）、`USER_SCOPED_STORES`、`isUserScoped()`。
- `src/services/sync/outbox.ts` —— `pushOnce()`：读队列 → 排序 → 截批 → 回主表读当前行 → 分组发请求 → 出队或写回。
- `src/services/sync/pushQueue.ts` —— `startPushScheduler()`：四个触发点、`navigator.locks`、退避。
- `src/shared/date/relativeTime.ts` —— `formatRelativeTime()`（纯函数，可被 `check:sync` 回归）。
- `database/migrations/202609200001_stage5_sync.sql` —— 三张子表补服务端 `updated_at` 与触发器。

**新建（1 个验收脚本）**

- `scripts/verify-sync.mjs` —— 假云端 + CDP `Fetch` 域拦截，49 项。

**改造**

- `src/main.tsx` —— 调度器接线（`cloudSyncConfigured` 为真时启动）。
- `src/services/sync/outbox.ts` —— 推送结果写回 `sync_state`（成功写 `last_push_at` 并清错误，失败写原因）。
- `src/services/contracts.ts` —— 从「两侧等价」改成**页面接口清单**。
- `src/features/preferences/preferencesLabels.ts` —— 删掉 S3 的过渡话术，新增「上传失败」与两种队列说明。
- `src/features/preferences/components/SyncCard.tsx` —— 接上真实上传状态，相对时间优先。
- `src/services/cloud/supabase.ts` —— 顶部注释更新（它已是同步层传输通道，不再是「冻结的种子」）。
- `scripts/check-sync.mjs` —— 54 → **85** 项（+ 批次上限 / 事件名 / 相对时间 / 文案口径 / 映射层）。
- `scripts/check-cloud-parity.mjs` —— 60 → **66** 项（+ 列级对齐 / `updated_at` / 策略 / 清理钉死；− 旧契约两侧等价）。
- `scripts/check-local-data.mjs` —— 账号规则断言的消费者从「本地 + 云端」收敛为「本地」。
- `package.json` / `scripts/launcher.mjs` —— 新增 `verify:sync`（任务编号 10，共 14 项）。
- `README.md`、`HANDOFF.md`、`docs/19` —— 活文档同步。

---

## 2. 关键决策

### 2.1 调度器接线放在 `src/main.tsx`，不放 `App` 的 effect

`pushQueue.ts` 是**全局单例**（四个触发点挂在 `document` / `window` 上）。放进 `App` 的
`useEffect` 会撞上 React StrictMode 的「挂载 → 卸载 → 再挂载」：

清理函数与 `await import()` 的完成顺序**不保证**——可能出现「第二次挂载刚拿到停止函数，
就被第一次挂载的清理函数把监听器摘掉」。结果是**调度器静默失效而界面一切正常**：
写入照常进队列，界面照常显示「待上传 N 条」，只是永远不推。

放 `main.tsx` 之后生命周期与应用一致，不存在这个竞态。同时用 `cloudSyncConfigured` 兜住：
为假时**不调用**，否则启动阶段就会把 supabase 那个 chunk 拉下来。

### 2.2 假云端与页面**同源**

`verify:sync` 用**同一个空闲端口**既跑 Vite 又当 `VITE_SUPABASE_URL`。于是整条链路没有跨域：

- 不需要伪造 CORS 头；
- 不需要 `--disable-web-security` 这类会**改变被测行为**的启动开关；
- CDP 的 `Fetch` 域能按 `/auth/v1/*` 与 `/rest/v1/*` 两个路径前缀精确拦下来。

拦截时必须注意一处：**CDP 的 `Fetch` 域在网络条件之前生效**。所以「断网」分支不能只是
`failRequest` 后就不管——那种写法会让「断网」用例走的是被拦截的路径，而不是真实的网络失败。
本脚本对 `cloud.offline` 为真的请求一律 `continueRequest` 放行给网络栈，让失败真的来自网络。

两条**自检**断言留在里面（构建期配置确实注入、CDP 模式确实拦到了 `POST /auth/v1/token`）：
它们不成立时，后面所有同步断言都会以「云端收到 0 条」的形式失败，
而根因根本不在业务代码里——这种失败最费时间。

### 2.3 推送是**整批**成功或失败

任何一个请求报错，整批条目的 `attempts` 都加一。不做「部分成功」的精细账：

- 推送本身幂等（upsert 按主键、delete 按 id），整批重试无害；
- 维护一份「哪些成功了」的账反而引入新的错位可能。

与之配套的两条：**成功才出队**；失败写回的条目 `attempts > 0`，而 S2 的压缩规则规定
`attempts > 0` 的不参与压缩——所以重试的账本不会被后续写入吃掉。

### 2.4 先排序再截批，而不是 `slice(0, 100)`

直接切前 100 条会把「删除在前、写入在后」的层级顺序切碎：例如前 100 条恰好全是某张子表的写入，
而它的父表删除排在第 101 条，这一批推上去就会在云端留下悬空引用。

代价是要把整个队列读进内存。可以接受：队列条目数 = **不同记录数**（S2 压缩过），
单机应用在千条以内。真要更大时改成按层级分段取，规则不变。

### 2.5 `updated_at` 是**云端自己的列**，不是「与本地对齐」（T6 的口径修正）

`docs/19` 原先把 T6 写成「补齐 11 张表的 `updated_at` **差额**」，措辞容易被读成
「云端缺列导致推不上去」。实现前先写了一个临时探针把两侧逐表对齐，结论有两条：

1. **推送方向本来就没有缺列**。`stage4` 建的三张子表与本地契约**逐字段完全一致**
   （`daily_meal_items` 6/6、`daily_exercise_items` 6/6、`routine_tasks` 5/5）。
   反倒是 `day_plans.exercise_content`、`daily_meals.plan_content`、
   `daily_meals` 与 `custom_tasks` 的 `created_at` / `updated_at` 这**六列云端有、本地没有**，
   由 `mapper.ts` 剔除。
2. 真正缺 `updated_at` 的只有那三张子表，**理由是服务端时间戳**（`docs/18 §5.4` 的多设备
   last-write-wins 需要一份来自数据库触发器、可比较可审计的变更时间），**不是**与本地对齐。

所以这三列**不该**进 `src/services/local/recordSchemas.ts`：加了就会变成上报本机时钟，
恰好破坏它存在的理由。这条写进了迁移文件头部，也由第 ⑨ 组断言拦住这种改法。

原计划里的「`device_sync_state` 诊断表（可选）」**不做**：一期按决策 D2 不做增量拉取，
这张表没有消费者。

### 2.6 T7 做成**删除**而不是改造

计划写的是「改造为同步传输层（保留 upsert 原语）」。实际做成了删除，因为原语不需要搬：
`sync/outbox.ts` 早就自己实现了 upsert（`from(store).upsert(rows, { onConflict: 'id' })`）
与 delete（`.delete().in('id', ids)`），**没有复用那批适配器里的任何函数**。

留着半死的模块比删掉更贵：它们会让人以为「改本地签名要同步改云端」——
而这正是 S1 已经否掉的模型。

**删除的硬证据**：删前删后各构建一次，产物**逐字节同尺寸**
（`index` 295.23 kB、`supabase` 221.11 kB、`accountLink` 1.83 kB、`pushQueue` 3.11 kB、
`syncState` 0.67 kB、`status` 0.66 kB，只有内容哈希变了）——它们本来就没被打进任何 chunk。

### 2.7 契约重新定位为**页面接口清单**

`contracts.ts` 不再是「两种后端的等价性判据」。它现在只做两件事，各自有一条机器判据：

1. **编译期**：`Pick<typeof import('./local/xxx'), 键名>` 保证清单里的名字在本地实现里真实存在
   （不存在则 `typecheck` 失败），所以清单不会漂成一个不存在的接口；
2. **静态**：`check:cloud-parity` 第 1 组直接导入 `CONTRACT_KEYS`，断言每个名字在
   本地实现与四个门面里都真的导出——**清单只有一份**，不存在「脚本里另抄一份」的分叉。

---

## 3. 计划外改动

### 3.1 `check:cloud-parity` 第 1、2、7、8 组口径更新（必需）

| 组 | 旧口径 | 新口径 |
| --- | --- | --- |
| 1 | 契约名字在**本地 + 云端**两侧都导出 | 契约名字在**本地实现 + 四个门面**都导出 |
| 2 | `cloud/parity.ts` 用契约类型做断言 | **云端目录只剩同步传输层四模块** + L6 适配器已删除 |
| 7 | 云端 `dayPlanService` 调用的是 `copy_yesterday_stage4` | SQL 里有 `stage4` **且已无 TS 调用方**（整条链路在本地完成） |
| 8 | 示例清单两侧共用 | 只剩本地播种一个消费者 |

第 2 组是新加的：把 T7 的清理结果钉住，将来谁想加回一个「云端 xxxService」都得先改这条断言，
也就必须回答「它到底服务谁」。

### 3.2 列解析器必须同时读 `create table` 与 `alter table … add column`（踩坑）

第 ⑨ 组的列解析器第一版只读 `create table`，于是 `day_plans` 解析出 **7 列**
（`stage3` 的 11 列是 `alter table … add column` 加的），断言立刻报「云端缺 10 列」——
**一个完全虚假的失败**。更隐蔽的是：迁移文件都以 `--` 注释开头，
锚定 `^create table` 的判断会被注释行顶掉，所以第一版甚至解析出 **0 列**。

修法是两层：先剥掉 `--` 行注释再按分号切语句；`create table` 与 `alter table … add column` 两处都收。
并留了一条**解析器自检**（「`day_plans` 共 18 列」）钉住解析能力——它一旦退回 7，
下面所有列级断言都会变成假失败。

### 3.3 断言做了**反证**，不是空断言

第 ⑨ 组写完就通过，所以专门验了一次它会不会「怎么写都绿」：
临时把 `stage5` 迁移移出 `database/migrations/` 再跑，该条立刻以
`["daily_meal_items","daily_exercise_items","routine_tasks"]` 失败，移回后恢复全绿。

顺带证明了一件事：移走 `stage5` 时「本地契约的每个字段在云端都有同名列」**仍然通过**——
即那三张表本来就与本地契约逐字段一致，`updated_at` 确实是**额外的云端列**。
这条反证同时印证了 §2.5 的结论。

### 3.4 删除前做了目录级备份（因为 `.git` 不可用）

本机 `git rev-parse` 报 `not a git repository`，**没有版本控制可回滚**。
所以在删除 T7 那 8 个文件之前，把整个 `src/services/cloud/` 原样复制到
`.workbuddy-ai/backup/cloud-l6-adapters/`（12 个文件、1344 行，与删除前逐行一致）。
需要回退时把其中 8 个文件拷回原位即可。

### 3.5 `verify:sync` 的控制台断言拆成两段

脚本会**刻意**注入一次云端 500 来验证失败路径，浏览器因此会留下
`Failed to load resource: … 500` 这条噪声。若只写一条「控制台干净」，
这条刻意制造的噪声会把它喂成假失败。

改为两段：注入之前**完全干净**（0 条）；注入之后只允许多出这一种，
用白名单正则放行，其余任何 error / warning 都算失败。

### 3.6 `check-sync` 用错 `record()` 签名两次

`verify:sync` 的 `record(name, ok, detail)` 第三参是**详情文本**，不是期望值。
一度写成 `record('…', cond, false)`，于是 `detail` 变成空字符串、失败被静默吞掉。
已改回 `cond === false` 的写法，并记进项目笔记。

---

## 4. 验收证据

### 4.1 项数（全部实测）

| 命令 | S3 后 | S4 后 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | 通过 |
| `npm run lint` | 通过 | 通过 |
| `npm run build` | 通过 | 通过 |
| `check:dates` | 48 | 48 |
| `check:local-data` | 51 | 51 |
| `check:backup` | 62 | 62 |
| `check:cloud-parity` | 60 | **66** |
| `check:sync` | 54 | **85** |
| `verify:local` | 114 | 114 |
| `verify:pwa` | 43 | 43 |
| `verify:sync` | — | **49（新增）** |

> `check:cloud-parity` 的中间值是 68（T6 之后），T7 删掉云端适配器后净 −2 到 66。

### 4.2 构建产物：懒加载边界仍然成立

```
dist/assets/index.html                2.00 kB │ gzip:  1.17 kB
dist/assets/index-BbcjZ1pu.css       12.45 kB │ gzip:  3.28 kB
dist/assets/status-D1NiRO7c.js        0.66 kB │ gzip:  0.37 kB   ← 纯本地状态聚合
dist/assets/syncState-B3SxhncZ.js     0.67 kB │ gzip:  0.39 kB   ← 纯本地单行状态
dist/assets/accountLink-CKtIQOYw.js   1.83 kB │ gzip:  1.05 kB
dist/assets/pushQueue-CwVNdgDC.js     3.11 kB │ gzip:  1.43 kB
dist/assets/supabase-VVnRxvT7.js    221.11 kB │ gzip: 58.02 kB   ← 含 supabase，按需加载
dist/assets/index-DisyK3hs.js       295.23 kB │ gzip: 92.36 kB   ← 主 chunk
```

主 chunk 里只会出现 supabase 的**文件名**（Vite 给动态 import 生成的预载表），不是把库打了进去。
判断时别看 `grep supabase`，要看有没有 `supabase-*.js` 之外的命中。

### 4.3 `verify:sync` 的关键输出（假云端 + 真实浏览器）

```
PASS  云端恢复后按退避自动重试成功                       → pendingCount=0
PASS  重试成功后失败原因被清掉（界面不挂过期信息）        → null
PASS  重复推送同一条记录不会在云端产生第二行              → 2 → 2
PASS  重复推送后云端内容与本地最后一次写入一致            → 云端 name=被拒绝的食物·改名后重推
PASS  设备状态表从未被推送                                → day_plans | food_options | supplement_templates | exercise_options
PASS  本地账号表从未被推送
PASS  刷新后绑定关系仍在（sync_state 持久化）             → bound=true
PASS  注入云端 500 之前控制台完全干净                     → 0 条
PASS  注入 500 之后只多出刻意制造的那条噪声               → 多出 2 条，均为刻意制造的 500
结果：49/49 通过
```

### 4.4 `check:cloud-parity` 第 ⑨ 组（列级对齐）

```
PASS  列解析器同时读得到建表列与增列（day_plans 共 18 列）
PASS  每张云端表都有 updated_at 列
PASS  每张云端表都挂了 set_updated_at 触发器
PASS  每张用户数据仓库都有推送映射
PASS  本地契约的每个字段在云端都有同名列
PASS  云端多出的列都能被省略（有默认值或可空）
PASS  带 user_id 的云端表与 USER_SCOPED_STORES 完全一致
PASS  每张云端表都有至少一条策略
结果：66/66 通过
```

### 4.5 `verify:local` 仍然零跨域请求

```
PASS  未配置云端时整轮交互零跨域请求  → http://127.0.0.1:13359 之外 0 条
结果：114/114 通过
```

S4 开始推送之后这条断言仍然成立，因为本机没有 `.env.local`（`cloudSyncConfigured` 为假）。
**真正被 `verify:sync` 覆盖的是「已配置且已绑定」那一态。**

---

## 5. 缺陷与延后项

| # | 项 | 说明 | 计划 |
| --- | --- | --- | --- |
| 1 | **休息日注册撞 `user_date` 唯一索引** | 见 §6.1，**既有缺陷，与 S4 无关** | 待用户裁决 |
| 2 | **`sync_state` 未记本地账号 → 换账号串推** | 见 §6.2，设计缺口 | 待用户裁决 |
| 3 | 跨标签互斥只做了结构性实现 | `navigator.locks` 的**真实多标签**并发未实测 | 真机验收时补 |
| 4 | 退避只活在内存里 | 刷新页面后退避归零、立刻重试一次 | 有意为之：持久化退避会让「用户刚修好网络」也等满 60s |
| 5 | 队列超千条时整表读进内存 | 见 §2.4，量级内可接受 | 真出现时按层级分段取 |
| 6 | `stage1`–`stage5` 五个迁移从未真实执行 | 本机无 Supabase 项目、无 PostgreSQL | S5/S6 在真实项目上补 |

---

## 6. 两个待裁决项（S4 期间发现）

### 6.1 休息日注册后显示「读取失败：Unable to add key to index 'user_date'」

**症状**：在**休息日**注册新账号，日计划读取失败。**与 S4 无关**——
写了一个临时探针（不配置云端）复现，同样触发。

**根因**：`local/dayPlanService.ts` 的 `upsertDayPlan` 是「读-改-写」
（`plansForUser` → find → `put`），而 `useDayPlanData` 会在**正常休息日自动创建** rest 计划，
两条路径并发：都判定「不存在」→ 各自生成一个 id → 撞 `day_plans.user_date` 唯一索引。

**为什么没修**：修法涉及业务行为（要么串行化、要么把「自动建 rest 计划」改成幂等的
`put` 而非 `add`），属于业务改动，不在 S4 范围。探针已删除。

### 6.2 `sync_state` 是设备级单行，没记住「绑定是在哪个本地账号下建立的」

**症状**：一台设备上换本地账号（先退出登录、再用另一个账号登录）之后，
新账号的改动会被推送到**上一个账号绑定的云端账号**里——`user_id` 被重写成那个云端 id，
等于把 B 的计划写进 A 的云端。

**为什么没修**：要修必须先定产品语义——绑定是「设备级」还是「本地账号级」。
方案 `docs/18` 与执行文档 `docs/19` 都没写这一条，所以没有擅自改。

---

## 7. 未验证项

**本机没有真实 Supabase 项目（无 `.env.local`），因此下列内容全部未验证**：

1. **`stage1`–`stage5` 五个迁移在真实库上的执行**：全部只做过静态检查
   （`check:cloud-parity` 的 SQL 解析 + 列级对齐），从未在真实 PostgreSQL 上跑过。
2. **真实凭据下的推送链路**：`verify:sync` 用的是内存假云端，
   真实 Supabase 的 RLS、PostgREST 的 upsert 语义、`on_conflict=id` 的行为都未实测。
3. **`navigator.locks` 的真实多标签互斥**：`verify:sync` 是单页，
   跨标签并发没有覆盖。
4. **`updated_at` 触发器与多设备 last-write-wins**：需要两个真实账号 + 两台设备。
5. **`docs/18 §9.3` 的人工清单**：连接 / 断开 / 失败提示的观感需要人对着真实界面看一遍。

> 这些不是「已知有 bug」，而是「本机条件下无法覆盖」。S6-T3 / S6-T4 会在真实项目上逐项补做。

---

## 8. 对下一阶段（S5）的影响

### 8.1 可以直接用的现成件

- `sync/outbox.ts` 的 upsert / delete 原语（S5 的整体替换若走 RPC 则不需要，
  但「替换成功后清空 outbox」要复用它的事务写法）。
- `sync/mapper.ts` 的 `toCloudRow()` —— 上传方向的形状转换已钉死。
- `backupService.collectUserRecords()` —— S5-T5「本地上传云端」的取数（S3 已抽好）。
- `cloud/rpc.ts` 的 `callRpc()` —— 建好但**至今没有调用方**，S5-T1/T3/T4 的三个 RPC 走这里。
- `local/outboxRules.ts` 的 `sortChangesForPush` / `layerOf` / `BATCH_LIMIT`。

### 8.2 三条不能破的约束

1. **推送前必须回主表读当前行**：队列里只有 `store` / `record_id` / `op`，没有数据副本。
2. **`users` 永远不进队列**，`cloud_user_id` 只能从 `sync_state` 取。
3. **`user_id` 重写**：四张带 `user_id` 的表推送时换成 `cloud_user_id`。

### 8.3 S5 会踩到的两处

1. **`export_cloud_snapshot()` 必须逐列投影，不能 `select *`**：
   云端现在有六列本地没有（`day_plans.exercise_content`、`daily_meals.plan_content`、
   `daily_meals` 与 `custom_tasks` 的 `created_at` / `updated_at`），
   而 `parseBackup` 对未知字段**严格拒绝**（`docs/01` 的导入侧纪律）。
   第 ⑨ 组的「云端多出的列都能被省略」已经把这份清单钉住，照着它剔。
2. **`stage5` 新加的 `updated_at` 也在那份清单里**（三张子表），别漏。

### 8.4 一句提醒

S4 的验收覆盖的是**假云端**。真实项目上的第一次推送，最可能出问题的地方是
**RLS 与 `with check`**（推送的行 `user_id` 是否等于 `auth.uid()`）——
`verify:sync` 的假云端不实现 RLS，这条只能靠真实项目。
