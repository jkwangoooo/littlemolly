# 两个缺陷的修复报告（并发建计划 / 换账号串推）

> 日期：2026-09-19 · 上一份报告：`docs/23-S4-completion-report.md`
> 执行文档：`docs/19-sync-execution-plan.md` §4（基线表「缺陷修复后」一列）、§7

## 1. 这一批做了什么

S4 收尾时，我把两件事标为「待用户裁决」写进了 `docs/23` §6，理由都是「修法涉及业务行为，不擅自改」。
用户随后指示：**「直接给我完成这项改造，遇到问题查市面上相似软件的最佳实践，然后进行改造。」**
于是先做调研、再定案、再落地。两件事都改了业务行为，因此单独成一份报告，不进 S1–S6 的任何一段。

| # | 缺陷 | 用户可见症状 | 定案 |
| --- | --- | --- | --- |
| ① | `upsertDayPlan` 的读-改-写拆在两次调用里 | 休息日注册后界面报「读取失败：Unable to add key to index 'user_date'」 | 新增 `readModifyWrite`（事务内先读后写），读与写收进同一个 `readwrite` 事务 |
| ② | `sync_state` 是设备级单行，没记住绑定属于哪个本地账号 | 换本地账号后，新账号的改动被推到**上一个账号绑定的云端账号**里（界面还显示「已连接」） | 绑定定为**本地账号级**：`sync_state` 一行一个本地账号，`sync_outbox` 记归属并在推送时过滤，`DB_VERSION` 6→7 做一次搬迁 |

两处都补了**反证**（把实现退回旧写法，确认新断言立刻失败），证据见 §6。

## 2. 缺陷 ①：读-改-写不在一个事务里

### 2.1 根因

改之前 `upsertDayPlan` 是两段：

```ts
const existing = (await plansForUser(uid)).find((plan) => plan.plan_date === planDate)  // 事务 A：读
const next = { ...(existing ?? emptyPlan(planDate, uid)), ...patch, id: existing?.id ?? newId() }
await put('day_plans', next)                                                          // 事务 B：写
```

读与写之间隔着事务边界。两个并发调用会同时读到「不存在」，各自生成一个新 id，
第二条 `put` 撞上 `day_plans` 的 `user_date` 唯一索引（`['user_id','plan_date']`），
整个写入失败并冒泡到界面。

**为什么休息日注册必然踩到**：`useDayPlanData.load()` 在「非历史 + `mode === 'rest'` + 无人工覆盖」时
会先建一份 rest 计划（`docs/00`「仅正常休息日自动带家务」），而界面上的首次写入
（`DayPlanScreen.ensurePlan` / `savePlan`）同时也在建同一份。开发模式下 StrictMode 还会把加载副作用跑两遍，
两条路径必然并发。

### 2.2 市面上的做法

查了 IndexedDB 的权威描述（MDN `IDBTransaction`）与 local-first 应用的通行做法，结论有三条：

1. **事务在创建那一刻就开始**，不是发出第一个请求时。原文：
   > Transactions are started when the transaction is created, not when the first request is placed.

2. **同一对象仓库上的两个 `readwrite` 事务串行执行**。MDN 的例子直接说明 `trans2` 会在 `trans1` 之后运行。
   也就是说，只要把读和写放进同一个事务，第二个调用读到的必然是第一个已经写好的结果，
   「两个人都以为不存在」这个前提在结构上就不成立了。

3. **`put()` 命中带唯一约束的索引键会让请求报错、事务中止**，这是 MDN 列的失败原因之一：
   > trying to `add()` the same key twice, or `put()` with the same index key with a uniqueness constraint

所以正确的修法是**把读-改-写放进同一个 `readwrite` 事务**，而不是加锁、也不是改成确定性主键。
（确定性主键只解决「同一条记录被写两次」，解决不了「两边都基于空值算 patch，后写的把先写的字段抹掉」。）

### 2.3 落地

`src/services/local/localDb.ts` 新增一个写入口：

```ts
export async function readModifyWrite<T extends { id: string }>(input: {
  stores: LocalStore[]                                    // 事务要带上的仓库
  writeStore: LocalStore
  read: (tx: TransactionReader) => Promise<T | null>      // 事务内读（get / getByIndex / getAll）
  build: (existing: T | null) => T                        // 纯计算，不发请求
  track?: boolean
}): Promise<T>
```

两条纪律写在函数注释里，都是这个项目里踩过的坑：

1. **`read` 里只能 await 本事务发出的请求。** 事务在没有待处理请求时自动提交；promise 回调是微任务
   （仍在同一个任务内），所以紧接着发下一个请求是安全的；一旦 await 了 `fetch` / `setTimeout` /
   另一个事务，事务会先提交，后面的写入会抛 `TransactionInactiveError`。
2. **校验必须在写入请求发出之前完成。** 事务中途抛错时事务会照常提交，
   所以顺序被钉死为「读 → 算 → 校验（`assertRecord`）→ 写」，校验不过时那条 `put` 根本不会发出去。

`upsertDayPlan` 改成按 `user_date` 唯一索引读——**读的就是要守的那条约束本身**：

```ts
return readModifyWrite<DayPlan>({
  stores: ['day_plans'],
  writeStore: 'day_plans',
  read: (tx) => tx.getByIndex<DayPlan>('day_plans', 'user_date', [uid, planDate]),
  build: (existing) => ({ ...(existing ?? emptyPlan(planDate, uid)), ...patch, id: existing?.id ?? newId(), user_id: uid, plan_date: planDate, updated_at: timestamp }),
})
```

**同一形状的第二个落点也一并修了**：`setMealCompleted` 是「读这一餐 → 写这一餐」，
`daily_meals` 的 `plan_type`（`['day_plan_id','meal_type']`）也是唯一索引，
只修一处等于把同一个坑留在隔壁。

## 3. 缺陷 ②：同步状态没有归属人

### 3.1 根因

`sync_state` 早先是设备级单行（`id` 恒为 `'singleton'`）。于是：

1. A 在设置页绑定云端账号 `cloud-A` → 写 `sync_state`；
2. A 退出登录（**本地账号卡的「退出登录」只清会话，不清 `sync_state`**，这是有意的）；
3. B 登录 → `readSyncStatus()` 读到 A 那一行 → 界面显示「已连接 A 的云端」；
4. B 写入 → 队列 → 推送时 `toCloudRow` 把 `user_id` 重写成 **A 的云端 id** → **B 的数据进了 A 的云端账号**。

全程没有任何提示。这是**静默的数据事故**，不是显示问题。

### 3.2 市面上的做法

查了 Firebase / Firestore 的离线持久化文档：官方只说「缓存不会在会话之间自动清除」，
并建议「处理敏感信息时先问用户是否在可信设备上」——**官方文档里没有多用户 / 换账号时的缓存隔离指导**。
这恰好说明这是这类应用的通病，而不是本项目独有的疏漏；但方向是清楚的：
**同步账本（绑定关系 + 待上传队列）必须按账号隔离，不能按设备共享。**
Notion / Obsidian Sync 这类产品的队列与绑定状态也都是 per-account + per-device 的。

由此定下产品语义：**绑定是「本地账号 ↔ 云端账号」的关系，不是「设备 ↔ 云端」的关系。**

### 3.3 落地

**（a）`sync_state` 一行一个本地账号**（主键就是本地账号 id）

`readSyncState()` 只可能读到**当前登录账号**那一行，`writeSyncState()` 只写当前账号那一行。
「读到别人的绑定」在结构上就不成立了，不依赖任何调用方记得先判断归属——
这是这个项目一贯的偏好（对比 `syncState.ts` 文件头对「为什么拆文件」的解释）。

一个账号的绑定会一直留着：A 退出、B 登录再切回 A 时，A 仍然是已连接状态。

**（b）`sync_outbox` 每条记 `local_user_id`，推送时过滤**

只有 `sync_state` 按账号分行是不够的。反例：A 绑定后写了几条、退出；B 登录（未绑定）也写了几条、
退出；A 再登录 → A 仍是已绑定 → 推送 → **B 的条目被推到 A 的云端**。
所以队列条目也必须记归属，`readBatch()` 只取属于当前账号的条目。

过滤规则抽成纯函数 `outboxRules.entriesOfOwner(entries, owner)`：
`owner` 为 `null`（没有登录会话）时返回**空数组**而不是全部——宁可什么都不推。
`check:sync` 直接回归它（这条规则错了的后果是跨账号串数据，界面上完全没有痕迹）。

**（c）`DB_VERSION` 6→7，只追加迁移**

```ts
7: { migrate: rekeySyncStateByLocalUser },
```

结构一个字节都没变（`keyPath` 一直是 `id`、本来就没有索引），只做一次搬迁：
把老库里的 `'singleton'` 行重新归属到**升级那一刻登录中的本地账号**，并删掉旧主键那一行。
**升级时没人登录就删掉那一行**——无法归属到任何本地账号的绑定是不可用的，留着只会让下一个登录的账号读到它，
正是这次改造要防的事。删除方向是安全的：用户重新绑一次即可，本地业务数据一条都不动。

规则本身抽成纯函数 `rekeySyncStateRows(rows, owner)`（幂等、四种情形都有回归），
理由与 `bindingRules.ts` / `outboxRules.ts` 一致：**能回归的规则才算规则**。

**（d）连带修掉的三处**

1. **`status.ts` 的「待上传 N 条」改成同口径**（`entriesOfOwner` 过滤）。
   早先是 `count('sync_outbox')`，换过账号后会把上一个账号的条目也算进来——
   界面显示「待上传 30 条」而这个账号一条都没有，且永远不会减少。**推送看什么，这里就数什么。**
2. **`bindCloudAccount` / `disconnectCloudAccount` 只清自己那一份。**
   绑定清队列的理由不变（队列是增量不是全量），但不再牵连别的账号的账本；
   断开时「状态行 + 队列」仍在同一个事务里清，保留原来的原子性。
3. **注册播种的条目要记归属。** 这是实现过程中被 `verify:sync` 抓出来的：
   `signUp` 的顺序是「建账号 → 播种示例选项 → `writeSession()`」，
   播种时读不到会话，那批条目会变成「无归属」→ 永不被推送，而界面一直显示「待上传 N 条」。
   修法是 `WriteOptions` 新增 `owner`（唯一正当用途就是「写入发生在会话建立之前」），
   `seedExampleOptions(userId)` 显式传自己的 userId。
   **没有**改成「先写会话再播种」——那样播种失败会留下「已登录但没有选项」的账号，
   而注册界面还在显示错误，是更糟的状态。

## 4. 改动清单

| 文件 | 改动 |
| --- | --- |
| `src/services/local/localDb.ts` | `DB_VERSION` 6→7；新增 `TransactionReader` / `readModifyWrite` / `requestResult`；`WriteOptions` 加 `owner`；`buildOutboxEntries` 改由调用方传归属人（新增 `outboxOwner`）；新增 `rekeySyncStateRows`（纯函数）与 `MIGRATIONS[7]`；`STORES` 的 `sync_state` 注释改为「按本地账号分行」 |
| `src/services/local/outboxRules.ts` | `OutboxEntry` 加 `local_user_id`；新增纯函数 `entriesOfOwner` |
| `src/services/local/recordSchemas.ts` | `sync_outbox` 契约加 `local_user_id`（可空）；`sync_state` 注释改为按账号分行 |
| `src/services/local/dayPlanService.ts` | `upsertDayPlan` 改走 `readModifyWrite` + `user_date` 索引；`setMealCompleted` 改走 `readModifyWrite` + `plan_type` 索引 |
| `src/services/local/optionSeed.ts` | 三处 `put` 显式带 `{ owner: userId }` |
| `src/services/sync/syncState.ts` | 按本地账号分行：新增 `currentLocalUserId()`，删掉 `SYNC_STATE_ID`，`emptySyncState(localUserId)`，`readSyncState` 用 `getOne(当前账号)`，`writeSyncState` 无会话时返回 `null` 且不写 |
| `src/services/sync/outbox.ts` | `readBatch` 按归属过滤；新增 `clearOwnOutbox()` 与 `ownOutboxIds()` |
| `src/services/sync/status.ts` | `pendingCount` 改为按归属过滤（不再用 `count('sync_outbox')`） |
| `src/services/sync/accountLink.ts` | 绑定改调 `clearOwnOutbox()`；断开只删当前账号的状态行与队列条目 |
| `scripts/check-local-data.mjs` | 51 → **62**：v7 迁移登记、搬迁纯规则四例、`readModifyWrite` 的读写顺序与校验时机、四个写入口都入队、`upsertDayPlan` / `setMealCompleted` 的接线 |
| `scripts/check-sync.mjs` | 85 → **96**：`sync_outbox` 契约的 `local_user_id`、`entriesOfOwner` 四例、`sync_state` 按账号分行、`DB_VERSION` 7、v7 迁移登记 |
| `scripts/verify-local.mjs` | 114 → **119**：`LATEST_VERSION` 7、并发建计划回归（10 个并发调用）、v6 老库真实升级到 v7 的搬迁用例（造库 → 会话 → 重载 → 回读） |
| `scripts/verify-sync.mjs` | 49 → **56**：播种条目记归属、绑定记在账号名下、换账号后看到「未连接」、未绑定的新账号不发请求、换回原账号绑定仍在、另一个账号的条目留在队列里没被推走；`outbox()` 辅助函数回传 `local_user_id` |
| `README.md` / `HANDOFF.md` / `docs/19` §4·§7 / `scripts/launcher.mjs` | 基线项数与说明同步 |

## 5. 已知残余（**没修**，以及为什么）

1. **`saveMeals` 仍是「读现有三餐 → 逐条写回」**（`daily_meals` 的 `plan_type` 是唯一索引）。
   两次并发提交理论上会撞索引。没顺手改的原因：它要写三餐 + 内容项共十几条记录，
   收进一个事务需要一个「事务内读 + 批量写」的更强原语，而那个原语会让「校验失败时数据已写一半」
   的风险重新出现（写入钩子必须与业务写入同事务，见 `localDb.ts` 的 `WriteOptions` 注释）。
   收益与风险不匹配，留给将来有真实并发证据时再动。
2. **`signUp` 的「先查重再写」**（`users.username` 唯一索引）：两个并发的同名注册会撞索引。
   UI 在提交期间禁用按钮，实际不可达；真要做需要把「查重 + 写入」也放进一个事务。
3. **`ensureRestDayRoutines` / `ensureDaySupplements` 的补齐**：并发调用会补出重复行（无唯一索引，不会报错）。
   实际路径由 `useDayPlanData` 单次加载触发，StrictMode 下两条并发补齐理论上会各写一次；
   `verify:local` 的休息日家务用例（含「不重复补齐」）目前全绿，未观察到重复。
4. **`sync_outbox` 里 `local_user_id` 为 `null` 的老条目不会被清理**，只被过滤（永不被推送），
   下次绑定 / 解绑时随队列一起清掉。有意不删：删除不可逆，而「不推」已经足够安全。

## 6. 验收证据

### 6.1 全量（均为本次实测）

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` / `npm run lint` / `npm run build` | 通过 |
| `npm run check:dates` | 48/48 |
| `npm run check:local-data` | **62/62** |
| `npm run check:backup` | 62/62 |
| `npm run check:cloud-parity` | 66/66 |
| `npm run check:sync` | **96/96** |
| `npm run verify:local` | **119/119** |
| `npm run verify:pwa` | 43/43 |
| `npm run verify:sync` | **56/56** |

### 6.2 反证（这是本报告最要紧的一节）

新写的断言如果永远为真，就等于没写。四条新断言各自把实现退回旧写法跑了一遍：

| 断言 | 退回的实现 | 反证结果 |
| --- | --- | --- |
| 10 个并发调用建同一天的日计划，没有一次失败 | `upsertDayPlan` 改回「先全表找、再 `put`」 | **FAIL**：`Unable to add key to index 'user_date': at least one key does not satisfy the uniqueness requirements.` —— 与用户看到的那句话逐字一致 |
| 换账号后新账号看到的是「未连接」 | `readSyncState` 改回「读第一行」+ `entriesOfOwner` 不过滤 | **FAIL**：B 的界面显示「已连接：syncprobe@molly.local / 待上传 0 条」 |
| 另一个账号的待上传条目留在队列里 | 同上 | **FAIL**：云端食物出现 `换账号测试食物` —— 正是这次改造要防的跨账号串数据 |
| v7 把老状态行重新归属到登录中的本地账号 | `rekeySyncStateRows` 去掉 `remove.push(row.id)` | **FAIL**：`行数 2，主键=["singleton","verify-rekey-user"]` —— 旧主键那一行留在了库里 |
| 静态：`upsertDayPlan` 走 `readModifyWrite` / 按 `user_date` 读 | 同上（改回旧写法） | **FAIL** ×2 |
| 静态：v7 搬迁规则四例 + 迁移读会话 | 去掉删旧行 / 迁移不读会话 | **FAIL** ×2 |

### 6.3 未验证项

- **真实 Supabase 项目上仍然一次都没跑过**（与 S4 相同的遗留）：本机无 `.env.local`、无 PostgreSQL，
  `stage1`–`stage5` 五个迁移至今只做过静态检查。v7 是**本地**迁移，与云端无关，因此不受影响。
- 换账号用例覆盖的是「同一浏览器内换本地账号」。**多设备**场景（两台设备各绑同一云端账号）
  属于 S5 的 LWW 与整体替换范围，本次未涉及。

## 7. 对 S5 的影响

1. **S5 的两个整体替换要按当前本地账号操作。** 绑定已经是账号级的，`replaceCloud` / `replaceLocal`
   在实现时必须先取 `currentLocalUserId()`，不能假设「这台设备只有一个账号」。
2. **`cloud/rpc.ts` 的 `callRpc` 仍然没有调用方**（S3 建好，S4 没用上）——S5 的三个 RPC 从这里走。
3. **`rekeySyncStateRows` 是「纯规则 + 薄 I/O」的又一例**，S5 若引入新的搬迁（例如待上传队列的字段变化）
   建议沿用同一形状：规则可回归、迁移只读会话与索引、失败方向朝「不推」而不是「照推」。
