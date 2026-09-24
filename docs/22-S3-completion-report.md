# S3 完成报告：云端账号绑定与连接

> 执行文档：`docs/19-sync-execution-plan.md` §5 的 S3 任务表。
> 方案：`docs/18-sync-architecture-plan.md`（§5.3 绑定流程、§6 模块清单）。
> 完成日期：2026-09-19。上一阶段报告见 `docs/21-S2-completion-report.md`。

## 1. 任务达成

S3 的目标是**能连上云端账号，但还不动数据**。六项任务全部落地：

| 任务 | 状态 | 落地位置 |
| --- | --- | --- |
| S3-T1 RPC 调用封装 + 错误标准化 | ✅ | `src/services/cloud/rpc.ts`（新建） |
| S3-T2 绑定 / 解绑、`sync_state` 读写、三种情形判定 | ✅ | `src/services/sync/accountLink.ts`、`sync/syncState.ts`、`sync/bindingRules.ts`（新建） |
| S3-T3 同步状态聚合 | ✅ | `src/services/sync/status.ts`（新建） |
| S3-T4 `SyncCard.tsx` + 文案段 | ✅ | `src/features/preferences/components/SyncCard.tsx`（新建）、`preferencesLabels.ts` |
| S3-T5 懒加载 | ✅ | `src/services/api/syncService.ts`（新建门面，全部 `await import()`） |
| S3-T6 `verify:local` 补断言 | ✅ | `scripts/verify-local.mjs`（112 → 114 项） |

### 1.1 具体改动

**新建（7 个源码文件）**

- `src/services/cloud/rpc.ts` —— `callRpc()`（S4/S5 的 RPC 入口，S3 期间还没有调用方）、
  `countRows()` / `countCloudRows()`（四张根表的只读计数探测）。
- `src/services/cloud/identity.ts` —— 「账号名 → 合成邮箱」规则，从 `cloud/authService.ts` 抽出。
- `src/services/sync/syncState.ts` —— `sync_state` 单行读写、`deviceId()`、`emptySyncState()`。
- `src/services/sync/status.ts` —— `readSyncStatus()` / `countLocalRows()`，**纯本地**。
- `src/services/sync/accountLink.ts` —— `connectCloudAccount()` / `bindCloudAccount()` /
  `abandonCloudSession()` / `disconnectCloudAccount()`。
- `src/services/sync/bindingRules.ts` —— `judgeBindingCase()`（纯函数）。
- `src/services/api/syncService.ts` —— 页面唯一入口，四个函数全部动态 import。
- `src/features/preferences/components/SyncCard.tsx` —— 同步卡片（未配置 / 未绑定 / 已绑定三态 + 两个确认框）。

**改造**

- `src/services/local/localDb.ts` —— 新增 `count(storeName)`（数行数不读数据）。
- `src/services/local/backupService.ts` —— 抽出 `collectUserRecords()`，`exportBackup` 改为调它。
- `src/services/local/backupFormat.ts` —— `countRecords` 改为导出。
- `src/services/cloud/authService.ts` —— 改用 `identity.ts` 的 `emailForUsername`，删掉本地的重复实现。
- `src/features/preferences/PreferencesScreen.tsx` —— 「账号与同步」子屏挂上 `SyncCard`。
- `src/features/preferences/components/AccountCard.tsx` —— 注释与职责说明更新（卡片本身只改了注释）。
- `src/features/preferences/preferencesLabels.ts` —— `ACCOUNT_TEXT` 更新 + 新增 6 组同步文案。
- `scripts/check-cloud-parity.mjs` —— 第 6 组断言口径更新 + 2 条新断言（58 → 60 项）。
- `scripts/check-sync.mjs` —— 新增绑定情形判定回归（49 → 54 项）。
- `scripts/verify-local.mjs` —— 新增 2 条同步卡断言（112 → 114 项）。
- `scripts/launcher.mjs` —— 项数 note 同步。
- `README.md`、`HANDOFF.md`、`docs/19` —— 活文档同步。

---

## 2. 关键决策

### 2.1 绑定 ≠ 登录：**刻意不复用** `cloud/authService.ts`

这是 S3 里最容易埋雷的一处。`cloud/authService.ts` 的 `signIn` / `signUp` 在成功后会
`writeSession(...)`，把云端用户写进 `services/session.ts` 的本地会话镜像。

那是 L6 的语义（云端账号 = 应用账号）。但 S3 的语义是**本地账号是应用身份、云端账号侧挂绑定**（决策 D5）。
直接复用会有一个很隐蔽的后果：**本地数据一条没丢，但用户被「换」成了云端账号**，
于是所有按 `user_id` 过滤的查询（`dayPlanService` / `optionService` / `backupService` 全是）
立刻全部落空——界面看起来像「数据全没了」，而实际只是当前登录换了个人。

因此 `accountLink.ts` 自己调 `supabase.auth.*`，只有「账号名 → 合成邮箱」这一条规则共用
（抽到 `cloud/identity.ts`）——那条规则必须一致，否则同一个账号在两条路径下会指向两个云端身份。

### 2.2 云端探测**不新增 SQL**

方案 §5.3 的绑定流程写的是「读 `cloud_sync_summary()` 得到云端现有 N 条」，
但那个 RPC 属于 **S5-T4**（给整体替换的确认框显示条数用）。S3 只需要一个布尔。

为一个布尔提前建迁移会破坏「每阶段只做本阶段范围」，而且会让 S3 的验收依赖一个真实 Supabase 项目。
改为用 PostgREST 的 `head: true` 计数**四张带 `user_id` 的根表**：

- 这四张（`day_plans` / `food_options` / `supplement_templates` / `exercise_options`）是根表，
  其余六张都是挂在 `day_plans` 下的子表、不带 `user_id`。**根表全空则子表必然也空**；
- 反过来只数子表会漏判——用户可能只建了选项、一个计划都还没排；
- 天然受 RLS 限制（`auth.uid() = user_id`），数出来的就是当前账号自己的行数。

### 2.3 `sync_state` 读写**单独成文件**，而不是留在 `accountLink.ts`

`docs/19` 把「`sync_state` 读写」记在 `accountLink.ts` 名下，实现时拆了出来，因为依赖方向相反：

- `accountLink.ts` 要连云端（supabase），属于「需要网络」的那一半；
- `status.ts` 只读本机状态给界面显示，**一个请求都不该发**。

若 `sync_state` 留在 `accountLink.ts`，`status.ts` 就不得不 import 它，于是「打开设置页」这条路径
会把 supabase 拖进依赖图——而「未配置云端时整轮交互零跨域请求」正是不能破的那条判据。
拆开之后这条边界是**结构性成立**的，不依赖谁记得住。

### 2.4 懒加载做成**结构性**的，而不是靠条件判断

门面 `api/syncService.ts` 的每个函数都 `await import()` 取实现；`SyncCard` 在
`cloudSyncConfigured === false` 时**连 `SyncPanel` 都不挂载**。

两者缺一不可：

- 只有门面动态 import，而卡片照常挂载 → 挂载时 `useEffect` 仍会触发 `readSyncStatus()`，
  chunk 照样下载（虽然不发跨域请求，但「未配置时不加载该 chunk」这条就名存实亡）；
- 只有卡片不挂载，而门面静态转发 → `export * from '../sync/accountLink'` 会把 supabase
  直接打进主 chunk，而且 `typecheck` / `lint` / `build` **都不会报错**。

第二条因此进了静态断言（`check:cloud-parity`：「同步门面用动态 import 取实现，不静态转发」）。

### 2.5 `device_id` 存 **localStorage**，不存 `sync_state`

方案写的是「首次启动生成」。但「断开连接」按 §5.3 会清掉 `sync_state`——
若 `device_id` 存在那一行里，用户每断一次、连一次就换一个设备身份，
云端诊断表（S4 的 `device_sync_state`）里会出现一堆来历不明的「新设备」。

因此存 localStorage（与 `services/session.ts` 同一套载体），写 `sync_state` 时带一份副本供上报。
localStorage 不可用时（隐私模式）退化成一次性 id，不抛错打断用户操作——它只用于诊断。

### 2.6 `judgeBindingCase` 拆到 `sync/bindingRules.ts`

写 `check:sync` 回归时才发现 `sync/accountLink.ts` **在纯 Node 下 import 不了**：
它拖着的 `@supabase/functions-js` 解析失败（`MODULE_NOT_FOUND`）。

按 `local/outboxRules.ts` 的同一套做法拆成纯文件。理由与 S2 完全一致：
**能回归的规则才算规则**。这条规则判错的后果不是报错，而是让用户选错覆盖方向，
比「队列压缩写错」更需要机器盯着。

### 2.7 S3 期间**不清空 outbox**

方案 §5.3 的流程末尾有一句「清空 outbox（此时两边已对齐）」。那一步依赖**上传动作**（S5）。

S3 提前清空会更糟：S2 的写入钩子已经在对每一次本地写入记账，提前清掉等于让
「本地改了但没上传」这件事从账本里彻底消失。所以 S3 的正确过渡状态是——
**绑定后 `sync_outbox` 继续堆积，界面如实显示「待上传 N 条」并注明「当前版本只记录变更，还没有开始上传」**。

---

## 3. 计划外改动

### 3.1 `backupService.ts` 抽出 `collectUserRecords()`（必需）

「当前账号有哪些数据」这个问题现在有**三个**消费者：导出备份、绑定云端时判断本地是否为空
（`sync/status.ts`）、以及 S5「本地上传云端」的整体替换取数（`docs/18 §5.4` 已预告复用）。

而这段恰恰最容易写错：子表没有 `user_id`，归属要**沿父键逐级推导**——
`daily_meals` 靠 `day_plans.id`、`daily_meal_items` 靠 `daily_meals.id`。
少推一级就会把别的账号的数据算进来，或者漏掉自己的数据（表现为「明明有记录却提示本地是空的」）。

写第二遍必然分叉，所以抽成一份。`exportBackup` 改为调它，**行为完全不变**
（`check:backup` 62/62 守住），并且 `collectUserRecords` **不含 `users`**——
那是备份为了外键自洽才补的合成记录。

### 3.2 `backupFormat.ts` 的 `countRecords` 改为导出

界面上的「本地共 N 条」必须与备份摘要的 `BackupSummary.total` **同一口径**，
否则会出现「界面说本地有 12 条，导出的备份却说 10 条」这种自相矛盾。
`countRecords` 本来就是那个口径的实现，导出即可，不需要再写一个。

### 3.3 `localDb.ts` 新增 `count(storeName)`

数条数不该把数据读进内存：`getAll(...).length` 会把整个队列搬进来，而队列在 S3 期间只增不减。
用 IDB 自带的 `count()` 由存储层直接数。

### 3.4 `check:cloud-parity` 第 6 组断言口径更新（必需）

原断言：**「除云端目录自身，没有任何模块引用 `services/cloud`」**——S1 的产物隔离判据，
那时 `cloud/` 是冻结的种子、没人碰它。

S3 起云端适配器重新有了消费者（绑定与探测要连云端），旧口径**必然假失败**。
新口径是两层：

1. 引用 `services/cloud` 的**只允许** `services/sync/`（界面层、本地层一律不许）；
2. 同步门面必须用动态 `import()`（守住「门面没有退化成静态转发」）。

产物侧的对应证据是构建产物里 supabase 只出现在 `accountLink` chunk，
由 `verify:local` 的零跨域请求断言兜底。

> **写这条断言时踩了一个小坑**：第一次实现把「门面不许静态转发」写成对文件内容的
> `/export\s+\*\s+from\s+['"]\.\.\/sync\//` 匹配，结果**被文件自己的注释喂成了假失败**——
> `syncService.ts` 的注释里正好写着 `export * from '../sync/accountLink'` 这个反例作为警示。
> 现在先剥掉块注释再判断，并把这件事写进了脚本注释。

### 3.5 `ACCOUNT_TEXT` 必须改（否则 S3 之后它就不准了）

原文案是「数据保存在当前浏览器中，账号与计划都还没有上传到任何服务器，**也没有同步时间可显示**」。
S3 之后「账号与同步」子屏会显示同步状态，后半句不再成立。改为：

> 应用用本地账号登录，数据保存在当前浏览器中。云端同步是可选的：连不连都不影响本地使用，
> 连上之后也仍然用本地账号登录。

前半句（「还没有上传到任何服务器」）在 S3 期间仍然成立，但 S4 开始真正上传后同样要改——
已记入第 7 节。

### 3.6 `AccountCard` 与 `SyncCard` 拆成两张卡，而不是合成一张

本地账号与云端账号是两件事（决策 D5），用户完全可以一辈子不连云端。
合成一张卡会让「退出登录」和「断开连接」这两个后果完全不同的动作长得像一对
（前者退出应用，后者只清队列、不动数据）。

`AccountCard` 的注释相应更新为「只负责应用身份这一半」，并写明本卡片不显示任何上传 / 同步状态——
两边都显示迟早会出现「一张说待上传 3 条、另一张说已保存」这种自相矛盾的画面。

---

## 4. 验收证据

### 4.1 项数（全部实测）

| 命令 | S2 后 | S3 后 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | 通过 |
| `npm run lint` | 通过 | 通过 |
| `npm run build` | 通过 | 通过 |
| `check:dates` | 48 | 48 |
| `check:local-data` | 51 | 51 |
| `check:backup` | 62 | 62 |
| `check:cloud-parity` | 58 | **60** |
| `check:sync` | 49 | **54** |
| `verify:local` | 112 | **114** |
| `verify:pwa` | 43 | 43 |

### 4.2 构建产物：懒加载边界成立

```
dist/assets/index-CTcSt5xJ.js        293.56 kB │ gzip: 91.76 kB   ← 主 chunk，0 命中 supabase
dist/assets/accountLink-C1RPzNaC.js  222.78 kB │ gzip: 58.87 kB   ← 含 supabase，按需加载
dist/assets/status-WUgngMXv.js         1.35 kB │ gzip:  0.67 kB   ← 纯本地状态聚合
```

主 chunk 内 `supabase|GoTrueClient|PostgREST` 命中数为 **0**（S1 的判据在本地产物层面仍然成立）。

### 4.3 `verify:local` 的关键输出（真实浏览器）

```
PASS  本地模式说明不伪装云端同步成功
      → 账号与同步 / 退出登录 / 本地模式 · 当前登录：a1789834509159 /
        应用用本地账号登录，数据保存在当前浏览器中。云端同步是可选的：连不连都不…
PASS  未配置云端时同步卡说明不可用，且不给可点的连接按钮
      → 云端同步 / 这个版本没有配置云端服务，云端同步不可用。 /
        数据仍然保存在当前浏览器中，本地备份不受影响。
PASS  未配置云端时同步卡不出现任何「已同步」说法
PASS  未配置云端时整轮交互零跨域请求
      → http://127.0.0.1:5099 之外 0 条
结果：114/114 通过
```

最后一条是 S3 最关键的证据：**同步卡片挂载、读取状态、渲染完成之后，整轮交互仍然零跨域请求**。
它证明 `sync/status.ts` 那条路径确实是纯本地的。

### 4.4 `check:sync` 的新增项

```
PASS  云端为空 → cloud-empty（没有覆盖风险）
PASS  两边都有数据 → both-sides（必须由用户选一边）
PASS  本地为空、云端有数据 → local-empty（适合从云端取回）
PASS  两边都空归到 cloud-empty，而不是 local-empty
PASS  负数按空处理，不会漏出第四种情形
结果：54/54 通过
```

---

## 5. 缺陷与延后项

| # | 项 | 说明 | 计划 |
| --- | --- | --- | --- |
| 1 | `sync_outbox` 只增不减 | S2 起就在记，S3 仍未出队 | S4-T2 出队 |
| 2 | `last_push_at` 在 S3 期间**永远为空** | 没有任何代码写它，界面显示「还没有上传过」 | S4-T3 推送成功后写入 |
| 3 | 用户直接关页面（不点「取消」）会留下云端会话 | Supabase 的 `persistSession` 会把 token 留着 | 影响很小：下次点连接会覆盖。不专门处理 |
| 4 | 断开后本地写入**仍会进队列** | 写入钩子与绑定状态无关（S2 的设计） | 不是缺陷，但 S4 要保证「未绑定时不推送」 |
| 5 | `SyncCard` 每次挂载都跑一次 `countLocalRows()` | 它会 `sanitize` 全部记录，比纯计数重 | 数据量（几百条）下可接受；S4 若频繁调用再加只计数不取数的快路径，**必须复用同一份筛选规则** |
| 6 | 跨标签页并发未处理 | 两个标签页同时绑定 / 断开没有互斥 | S4-T3 的 `navigator.locks` 一并解决 |

---

## 6. 未验证项

**本机没有真实 Supabase 项目（无 `.env.local`），因此下列内容全部未验证**：

1. **连接 / 断开真实云端账号**：`verify:local` 覆盖的是「未配置云端」这一态，
   有凭据时的三分支（`signIn` 成功 / `signUp` 成功 / 邮箱验证开着被拒）从未跑过。
2. **`countCloudRows()` 在 RLS 下的实际返回**：PostgREST 的 `head: true` + `count: exact`
   在带 RLS 的表上返回的是不是「当前用户可见行数」，只能靠真实项目确认。
3. **`abandonCloudSession()` 的实际效果**：Supabase 的 `signOut()` 在「有会话」与「无会话」
   两种情况下是否都返回 `error: null`，未在真实项目确认。
4. **合成邮箱的域名约束**：`.local` 作为 mDNS 保留域不会投递邮件这一点是标准行为，
   但 Supabase 侧是否接受该域名注册未实测。
5. **`docs/18 §9.3` 的人工清单**：连接 / 断开流程的观感、确认框文案是否够清楚，
   需要人对着真实界面看一遍。

> 这些不是「已知有 bug」，而是「本机条件下无法覆盖」。S6-T3 / S6-T4 会在真实项目上逐项补做。

---

## 7. 对下一阶段（S4）的影响

### 7.1 S4 **必须**先删掉一句文案

`SyncCard` 里的 `SYNC_BOUND_TEXT.pendingOnlyNote` = 「当前版本只记录变更，还没有开始上传。」
这是 S3 的事实陈述。S4 一旦开始推送，**这句话就从「诚实」变成「撒谎」**。
`preferencesLabels.ts` 里已在该字段的注释上标明「S4 开始真正上传后，这句必须删掉」。

### 7.2 S4 可以直接用的现成件

- `cloud/rpc.ts` 的 `callRpc()` —— 建好但还没有调用方，S4/S5 的 RPC 走这里。
- `sync/syncState.ts` 的 `readSyncState()` / `writeSyncState()` —— 推送后更新 `last_push_at` /
  `last_error_message` 直接用，**记得 `writeSyncState` 内部已经带了 `{ track: false }`**。
- `sync/bindingRules.ts` —— 推送前判断「值不值得推」时可能用得上。
- `local/outboxRules.ts` 的 `sortChangesForPush` / `layerOf` / `compactionVictims` —— 出队与批次切分。
- `backupService.collectUserRecords()` —— S5 的整体替换取数（S3 提前抽好了）。

### 7.3 三条不能破的约束

1. **推送前必须回主表读当前行**：队列里只有 `store` / `record_id` / `op`，没有数据副本。
   读不到记录就说明它已经被删了——按 `op` 判断该跳过还是该报错。
2. **`users` 永远不进队列**，所以 `cloud_user_id` 只能从 `sync_state` 取，不能从记录里取。
3. **`user_id` 重写**：四张带 `user_id` 的表推送时要把本地 `user_id` 换成 `cloud_user_id`。

### 7.4 `check:sync` 的扩充点

S4 加推送后，队列规则回归要补：「成功出队」「失败写回 `attempts`」「批次上限 100」
「未绑定时不推送」。另外 `verify:sync` 是 S4 的新脚本（CDP 拦截 `*.supabase.co/rest/v1/*`
与 `/rpc/*`，挂内存假云端），`docs/19` §5 的 S4-T5 有完整用例清单。

### 7.5 一句提醒

S3 的验收里，「零跨域请求」这条判据守的是**未配置云端**的情形。
S4 开始推送后，`verify:local` 里那条断言仍然有效（本机没有 `.env.local`），
但**真正需要新判据的是「已配置但未绑定」**——那时应用也不该发请求。
S4 写 `verify:sync` 时应该把这一态也覆盖上。
