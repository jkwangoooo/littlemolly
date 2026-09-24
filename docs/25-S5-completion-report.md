# S5 完成报告：双向整体替换

> 执行文档：`docs/19-sync-execution-plan.md` §5 的 S5 任务表。
> 方案：`docs/18-sync-architecture-plan.md`（§5.4 推送、§5.5 恢复、§9.3 真机清单）。
> 完成日期：2026-09-20。上一阶段报告见 `docs/23-S4-completion-report.md`，其间还有 `docs/24-two-defect-fixes-report.md`。
>
> **状态：代码与 SQL 全部落地、本机全绿；「在真实 Supabase 项目上跑一次完整往返」未做**（需要真实凭据）。
> 所以本报告的 §6「未验证项」不是附注，而是这一阶段剩下的全部工作。

## 1. 任务达成

S5 的目标是**两个手动操作落地**：把本地整体盖到云端、把云端整体盖到本地。
两项都是不可撤销的破坏性操作，因此「只在用户点按钮并二次确认后执行」是硬约束。

| 任务 | 状态 | 落地位置 |
| --- | --- | --- |
| S5-T1 `import_local_backup(payload jsonb)` | ✅ | `database/migrations/202609200002_stage6_replace.sql`（新建） |
| S5-T2 三处历史日期判定加受控豁免 | ✅ | 同上（`set local molly.allow_history = 'on'`） |
| S5-T3 `export_cloud_snapshot()` 与本地备份同形状 | ✅ | 同上（含一条合成 `users` 行） |
| S5-T4 `cloud_sync_summary()` 只读条数摘要 | ✅ | 同上 |
| S5-T5 `sync/replaceCloud.ts` 本地上传云端 | ✅ | `src/services/sync/replaceCloud.ts`（新建） |
| S5-T6 `sync/replaceLocal.ts` 云端恢复到本地 | ✅ | `src/services/sync/replaceLocal.ts`（新建） |
| S5-T7 `check:sync` / `check:cloud-parity` 断言 | ✅ | 两个脚本（第 13、14 组 / 第 ⑩ 组） |
| S5-T8 新增 `npm run verify:sql` | ✅ | `scripts/verify-sql.mjs`（新建，39 项） |

### 1.1 具体改动

**新建（4 个源码文件）**

- `src/services/sync/replaceRules.ts` —— 纯函数，`check:sync` 可直接回归：
  `isUuid()` / `nonUuidValues()` / `replaceCloudProblem()` / `replaceLocalProblem()` / `UUID_FIELDS`。
  单独成文件的理由与 `bindingRules.ts` 相同：`replaceCloud.ts` / `replaceLocal.ts` 都拖着
  `cloud/supabase`，在纯 Node 下 import 会 `MODULE_NOT_FOUND`。
- `src/services/sync/replaceCloud.ts` —— `uploadLocalToCloud()`。
- `src/services/sync/replaceLocal.ts` —— `restoreCloudToLocal()`。
- `database/migrations/202609200002_stage6_replace.sql` —— 三个 RPC + 三处豁免 + 授权。

**新建（1 个验收脚本）**

- `scripts/verify-sql.mjs` —— 起临时 PostgreSQL 真跑六个迁移，39 项。见 §3.1。

**改造**

- `src/services/api/syncService.ts` —— 新增 `uploadLocalToCloud()` / `restoreCloudToLocal()` /
  `readCloudSummary()`，三个都走 `await import()`（静态转发会把 supabase 打进主 chunk）。
- `src/features/preferences/components/SyncCard.tsx` —— 「整体替换」区块、两个按钮、
  确认框（含条数对比）、进行中状态、完成 / 失败结果。
- `src/features/preferences/preferencesLabels.ts` —— `SYNC_REPLACE_TEXT`。
- `scripts/check-sync.mjs` —— 96 → **113** 项（+ 第 13 组前置规则 / 第 14 组快照过 `parseBackup`）。
- `scripts/check-cloud-parity.mjs` —— 66 → **78** 项（+ 第 ⑩ 组）。
- `scripts/verify-sync.mjs` —— 56 → **74** 项（+ 双向替换的真实闭环）。
- `package.json` / `scripts/launcher.mjs` —— 新增 `verify:sql`（任务编号 11，共 15 项，后续编号顺延）。
- `README.md`、`HANDOFF.md`、`docs/19` —— 活文档同步。

---

## 2. 关键决策

### 2.1 「上传到云端」复用 `exportBackup()`，不自己取数

上传的输入**就是一份本地备份**：同样的文件形状、同样的字段清洗、同样带一条合成 `users` 行。
`exportBackup()` 已经把这三件事做完了，再写一遍取数逻辑必然分叉——子表归属要沿父键逐级推导，
是最容易写错的一段。

于是「导出备份」与「上传到云端」在数据层面**是同一个动作**，区别只落在哪一边：
前者写进一个文件，后者写进云端账号。这也让「备份里的内容」与「云端的内容」不可能不一致。

### 2.2 「恢复到本地」复用 `importBackup()`，一条新写入路径都不写

云端的 `export_cloud_snapshot()` 吐出的是**与本地备份完全相同的文件形状**，
所以本地这一侧只要把返回值序列化之后喂给现有的 `importBackup()` 就够了。

这不是巧合，是刻意的：快照与备份走同一条校验路径、同一条写入路径，
就不存在「备份能导入、快照导不进来」这种只在某个方向上出现的问题。
也正因为如此，这里**不再单独调一次 `inspectBackup`**——`importBackup` 内部就是
「`parseBackup` 全量校验 → 单事务写入」，在外面再校验一遍只是把同一份文件解析两次。

两个必须显式处理的地方：

1. **`track: false`**。恢复的数据来源就是云端，回推没有意义。不传的话会立刻产生上百条队列条目
   并被推回云端，一旦失败，界面会在一次**成功**的恢复之后显示「上传失败」。
2. **空云端要拦住**。`parseBackup` 对空内容也会拒绝，但它报的是「备份里没有任何数据」——
   听起来像用户操作错了，而事实是云端本来就是空的。

### 2.3 清空队列必须在替换**成功之后**

顺序反了的话，一旦上传失败，队列里那批「相对云端关系算出来的增量」就凭空消失了，
而云端还是旧的——用户以为传上去了，实际什么都没有。

同理，`import_local_backup` 返回的形状不对时**也不清队列**：没有条数摘要就不能说这次替换成功了，
此时两边是否对齐是一个没有依据的断言。

### 2.4 `sourceTotal` 与 `total` 分开，不一致就如实说

两个返回值都带 `sourceTotal`（源那一侧发出去多少条）与 `total`（落到目标那一侧多少条）。
正常情况下两者相等；不相等就意味着**有一批记录没落到对面**——可能是服务端漏插，
也可能是本地取数时漏了某个仓库。

界面据此追加一句 `mismatchNote`，而不是拿一个对得上的数字说「已替换」。
这与 S4 定下的纪律一致：**说得出证据的才说**。

### 2.5 前置检查放在发请求之前

`replaceRules.ts` 的两类判断都跑在 `callRpc` 之前，为的是把「必然失败的请求」
变成一句能照着做的说明：

- **非 UUID 的 id**。云端每张表的主键都是 `uuid`，而 `localDb.ts` 的 `createId()` 有一条回退分支
  （`${Date.now()}-${Math.random()...}`，用于非安全上下文或很老的浏览器），产出的不是 UUID。
  `docs/13 §5.2` 当初的假设「本地 id 本来就是 uuid v4，可直接复用」在 https / localhost 下成立，
  回退分支会让它不成立。不加这一道，失败会发生在 `jsonb_populate_recordset` 里，
  报 `invalid input syntax for type uuid: "1758…"`——一句用户完全无法据此行动的错误。
- **空的一侧**。用 0 条替换掉云端已有的 N 条，等于一次「上传」把数据全删了。
  本地导入（`importBackup`）对空备份就是这么处理的，两个方向保持同一条纪律。
  拒绝文案还要**指出正确的动作是另一个按钮**，而不是只说「不行」。

### 2.6 豁免用 `set local` 而不是永久开关

三处历史日期判定函数（`reject_historical_day_plan` / `reject_historical_stage3_rows` /
`reject_historical_meal_items`）看到 `current_setting('molly.allow_history', true) = 'on'` 就放行。
`import_local_backup` 在事务内 `set local molly.allow_history = 'on'`。

选 `set local` 而不是 `set`，理由是**作用域**：它只活到本事务结束。
用 `set` 的话，同一个连接在导入过一次之后就能随便改历史——一个只该存在几百毫秒的开关
变成了一个持续生效的后门。`verify:sql` 有一条断言专门钉这一点：
**RPC 返回之后、同一个会话里再改历史，仍然被拒**。

### 2.7 三个 RPC 一律 `security invoker`

`security definer` 会让函数以定义者的权限运行、绕过调用者的 RLS。整体替换是**用户自己的数据**
之间的搬运，没有任何理由提权——一旦某个函数被写成 definer，越权就从「不可能」变成
「取决于函数体写得对不对」。`check:cloud-parity` 第 ⑩ 组与 `verify:sql` 各有一条断言守着。

### 2.8 措辞上的三条纪律（写在 `SYNC_REPLACE_TEXT` 的注释里）

1. **说「替换」，不说「同步」**。写成「同步」会让用户以为两边合并。
2. **「不可撤销」必须出现，并且要说清哪一边会丢**。只说「不可撤销」而不说丢什么，等于没说。
3. **两边条数都写出来**。用户唯一能据此判断覆盖方向的信息就是这个数字对比。

完成后那一句只说**已经发生的事**（哪一边被换成了什么、多少条），
不说「已同步」「数据安全」这类拿不出证据的断言。

---

## 3. 计划外改动

### 3.1 新增 `verify:sql`（本阶段最大的一块计划外工作）

S5 要写 `stage6` 迁移。写的过程中发现一个结构性问题：**`stage1`–`stage5` 五个迁移从写下到此刻
只做过静态检查**。`check:cloud-parity` 是文本比对（正则找函数名、列名、授权语句），
它证明「该写的都写了」，但证明不了「写的东西跑得起来」。语法错、函数名拼错、策略写反、
`jsonb_populate_recordset` 的列不匹配——这一类问题静态检查一个都发现不了，
而它们的症状全都出现在**运行时**，也就是用户那边。

于是新增 `scripts/verify-sql.mjs`（39 项）：向系统要一个空闲端口 → `initdb` 起临时集群 →
打上 `auth` 垫片 → 按文件名顺序真跑六个迁移 → 断言结构与行为 → 关掉删掉。

它证明：迁移能按序执行成功；表 / 触发器 / 策略 / RPC 真的建得出来；三个 RPC 都是
`security invoker`；历史日期豁免真的生效且**不泄漏到事务外**；`import_local_backup` /
`export_cloud_snapshot` 的往返真的跑通；**快照字段集合与本地 `RECORD_SCHEMAS` 逐张表严格一致**；
替换语义（先删后插）真的成立；坏 payload 被拒且一条不写；RLS 双账号隔离有效。

它**不证明**：PostgREST 的 schema cache、GoTrue 的会话、Supabase 的托管配置——那些只有真实项目能验。

**故意不放进 `all`**：`all` 要能在任何开发机上跑完，而它需要本机装 PostgreSQL 16+。
找不到 PostgreSQL 时**直接失败，不静默跳过**——理由与 `findBrowser` 一致：
一个不跑的验收脚本等于没有，而「跳过」在 CI 上看起来和「通过」一模一样。

### 3.2 `pg_isready` 没有 `-X` 这个选项（踩坑）

第一版就绪探测写成 `pg_isready -X -h … -p …`——`-X`（忽略用户级 psqlrc）是 **`psql`** 的选项。
于是每次探测都失败，脚本报「PostgreSQL 在 127.0.0.1:xxxxx 上启动超时」，
而服务器日志证明数据库早就起来了。

排查方向一开始被误导到 Node 的 `spawn` 上（写了个最小复现才排除）。顺手在超时分支加了
「把服务器日志打出来」——这类问题下次一眼可见。

### 3.3 Windows 版 `psql` 的 stdout 是 CRLF（踩坑）

多行输出 `split('\n')` 之后，每行末尾留一个**不可见的 `\r`**。逐行比对会**整片假失败**：
10 张表全红，而把两侧字符串打印出来看，**一模一样**。

归一放在 `query()` 一处（`\r\n` → `\n`），不让调用方各自处理。
单值查询被 `trim()` 顺手盖住了，所以只有多行输出会中招——这也是它藏得深的原因。

### 3.4 空表的字段集合无从比对（踩坑）

「快照字段集合 vs 本地契约」这条断言只能从**快照里真实存在的行**反推字段。
一张表没有数据时，它那一行冒号后面是空的，比对会以「云端=[] 契约=N 项」失败——
看起来像「云端字段清单与本地契约分叉」，其实是**夹具没覆盖到这张表**。
第一版夹具漏了 `exercise_options` / `supplement_templates`，正是这个症状。

修法分两步：① 夹具给**每一张**用户数据表都留一条数据；
② 另立一条断言「**夹具覆盖了快照里的每一张表**」，把「夹具缺表」和「字段清单分叉」
两类失败分开——看到前者红就去补夹具，看到后者红才去查迁移。

### 3.5 `check-sync.mjs` 的组号重复

S5 新增的两组里有一组被标成了「12」，与 S4 的「本地行 → 云端行映射」撞号。
已改成 13 / 14，`README.md`、`HANDOFF.md`、`docs/19` 里的引用同步更新。
（这类编号只活在注释里，不影响运行——所以它不会自己暴露。）

### 3.6 断言做了**反证**，不是空断言

新加的两条最要紧的断言都验证过「它们真的会红」：

| 反证动作 | 报出的失败 |
| --- | --- |
| 给 stage6 的 `supplement_templates` 快照清单故意多加一列 | `supplement_templates: 云端=[…,legacy_note,…] 契约=[…]`（精确指出多出的列名） |
| 把 `exercise_options` 从夹具清空 | `夹具覆盖了快照里的每一张表 → 快照里没有数据的表：exercise_options` |

反证完**必须还原并复验全绿**（两条都做了）。

### 3.7 部署配置（S6-T1 / T2 提前落地）

原以为「S6 没有代码可写」，实际核对后发现**部署配置根本还不存在**——`vercel.json` 没有、
`public/_headers` 没有。于是本轮把它们补上，并配了四条断言。

| 文件 | 内容 |
| --- | --- |
| `vercel.json`（仓库根） | `rewrites` 把未命中路径回退到 `/index.html`；`/sw.js`、`/manifest.webmanifest`、`/index.html` 一律 `no-cache`；`/assets/(.*)` 一年 `immutable` |
| `public/_headers` | Cloudflare Pages 的等价物，随构建复制进 `dist/`，`/assets/*` 用单星号 |
| `public/_redirects` | **刻意不写**，理由见下 |

**为什么不写 `public/_redirects`**（与 `docs/19` 计划原文相反）。Cloudflare 官方文档原文：

> Redirects defined in `_redirects` are **always executed, whether or not there is a matching static asset**.

计划里的 `/* /index.html 200` 是 catch-all，按这条语义会把 `/sw.js` 与 `/assets/*`
一起改写成 HTML——浏览器拿 HTML 当 JS 解析，**整站白屏**，而且本地怎么跑都看不出来。
Cloudflare Pages 在产物**没有顶层 `404.html`** 时自带 SPA 回退
（官方：*Pages assumes that you are deploying a single-page application*），所以根本不需要它。

**新加的四条断言**（`verify:pwa` 43 → **49**）：`vercel.json` 有通配 rewrite 指向 `/index.html`；
两份配置缓存口径一致且都进了产物；产物没有顶层 `404.html`；产物没有 `_redirects`。

**四条都做了反证**（八次破坏动作，逐条确认只红对应那一条，再还原复验 6/6 绿）：

| 反证动作 | 报出的失败 |
| --- | --- |
| `rewrites` 的 `destination` 改成 `/index2.html` | 「没有指向 /index.html 的 rewrite」 |
| 删掉整个 `rewrites` | 同上（证明它不是靠 `headers` 顺带过的） |
| `/sw.js` 的 `no-cache` 改成 `immutable` | 「sw.js=public, max-age=31536000, immutable …」精确指出坏的是哪一条 |
| `vercel.json` 写成非法 JSON | 三条 vercel 相关断言同时红，`_headers` 两条仍绿（互不牵连） |
| 删掉 `dist/_headers` | 「dist/_headers 不存在（public/_headers 没被复制进产物）」 |
| `_headers` 里删掉 `/sw.js` 那一段 | 「sw.js=[] · assets=[…]」——精确到块，说明解析器真的按路径分块 |
| 往 `dist` 塞一个 `404.html` | 「dist/404.html 会让 Pages 不再走 SPA 回退，深链接将 404」 |
| 往 `dist` 塞一个 `_redirects` | 「dist/_redirects 存在：确认它的规则不会命中 /sw.js 与 /assets/*」 |

反证用的探针是临时脚本（把六条判定逻辑原样搬出来、只读文件不起浏览器），
跑完已删除；破坏动作全部还原并复验全绿。

### 3.8 `verify:sql` 的「假失败」：超时被当成 SQL 被拒（2026-09-21 修）

**症状**：把 `verify:sql` 与 `verify:local` / `verify:sync` **并行**跑时，它报出 6 条
「替换 / 历史豁免」失败（`33/39`）；单独跑则 8 次全绿（`39/39`）。看起来像业务规则坏了。

**根因**：`query()` 用 `spawnSync` 跑 psql 且带 `timeout: 60_000`，但**漏了 `result.error` 检查**
（同一个文件里的 `run()` 有，`query()` 没有）。超时时 `result.status` 是 `null`，
被 `code: result.status ?? 1` 落成 `1`，即「查询失败」——于是
`count()` 得到 0、`scalar()` 得到 null、`expectFailure()` 得到「（无错误信息）」，
六个依赖 psql 输出的断言一起以**业务规则错误**的形式报红。
并行跑时有三个重型套件（两个 Chrome + 两个 Vite + PostgreSQL）抢 CPU，psql 撞上 60s 超时。

**修法**：`query()` 里显式检查 `result.error || result.signal || result.status === null` 并**抛错**。
「psql 没跑起来」（基础设施坏）与「SQL 被数据库拒绝」（被测行为）从此不再混为一谈。
`run()` 早就有这个检查，`query()` 是漏掉的那一处。

**反证**（把超时压到 1ms 强制触发，两条都做了）：

| 条件 | 表现 |
| --- | --- |
| 带修复 + 1ms 超时 | `无法完成 SQL 验收：psql 未能正常执行（ETIMEDOUT）：select count(*) …`（退出码 1，原因一目了然） |
| 去掉修复 + 1ms 超时 | 一长串假失败，最前面正是那 6 条「替换 / 历史豁免」——与真实偶发一模一样 |

修复后连跑 3 次 `39/39`。**项数不变（仍 39），所以不需要改任何基线。**

**推论（写进了 `docs/26` §7.2）**：`verify:sql` 不要与其它验收脚本并行跑，串行既更快也更可信。

---

## 4. 验收证据

### 4.1 项数（全部实测）

| 命令 | S4 后 / 缺陷修复后 | S5 后 | 变化 |
| --- | --- | --- | --- |
| `check:dates` | 48 | 48 | — |
| `check:local-data` | 62 | 62 | — |
| `check:backup` | 62 | 62 | — |
| `check:cloud-parity` | 66 | **78** | + 第 ⑩ 组 |
| `check:sync` | 96 | **113** | + 第 13、14 组 |
| `verify:local` | 119 | 119 | — |
| `verify:pwa` | 43 | **49** | + 四条部署配置断言（见 §3.7） |
| `verify:sync` | 56 | **74** | + 双向整体替换 |
| `verify:sql` | — | **39（新增）** | 新脚本 |

`npm run typecheck` / `npm run lint` 通过。

### 4.2 `verify:sql` 的关键输出

六个迁移全部真实执行成功；10 张业务表全部建出且都开了 RLS、都有策略；三处历史日期触发器
命中 7 个触发器；三个 RPC 都存在且 `prosecdef` 全为假。

往返部分（导入一份「每张表各一条、日期全在过去」的备份，`total=10`）：

- 导入成功，且 `plan_date=2026-01-05` 的行数 = 1（**豁免真的生效**，否则第一条 insert 就会撞上历史日期）。
- 摘要口径与本地一致：10 张表、含子表、只数非空。
- **快照每张表的字段集合与本地 `recordSchemas` 严格一致 → 比对了 11 张表 / 期望 11 张**。
- 同一份数据导出两次，`records` 逐字节相同。
- 再次导入（只有 `day_plans`）后：`food_options=0 · daily_meals=0 · day_plans=1` → **是替换不是合并**。
- 日常写入（不走 RPC）仍拒历史日期、放行未来日期；**RPC 返回后同一会话里改历史仍被拒**（豁免不泄漏）。
- 坏 payload 三次被拒（app/format 不对、出现不认识的仓库、格式版本不受支持），且**三次拒绝之后条数一点没变**。
- B 的摘要一条都数不到、直接查表也看不到 A 的行、冒用 A 的 `user_id` 插入被 RLS 拒绝；
  B 导入自己的备份后 A 的数据没被牵连。
- anon 调用摘要与整体替换都拿不到任何数据。

### 4.3 `verify:sync` 的替换断言（假云端 + 真实浏览器）

- 点「从云端恢复到本地」弹出二次确认；替换失败前确认框照常弹出（**探测没被掐**）。
- 确认后云端被整份替换，界面如实报出结果（`云端已替换为本地内容：共 N 条（日计划 …）`）。
- 确认后本地被整份替换，**本地独有的那条被删掉**（证明是替换不是合并）。
- **替换失败时如实报错，绝不出现「已替换」**；且**失败时云端数据一行没动**（失败前 22 / 失败后 22）。
- 控制台断言拆成两段：注入 500 之前完全干净、之后只多出刻意制造的那条噪声。

### 4.4 静态断言

- `check:cloud-parity` 第 ⑩ 组：三个 RPC 存在、都显式 `security invoker`、三处豁免**写在日期比较之前**
  （顺序反了等于没豁免：函数会先在日期比较处抛错）、豁免用事务级 `set local` 打开。
- `check:sync` 第 13 组：`isUuid` / `nonUuidValues` 的边界（空字符串与 `null` 外键合法、只挑非空非 UUID）、
  空的一侧被拒且文案指向另一个按钮；第 14 组：快照能过 `parseBackup`，
  少了合成 `users` 行或多出云端遗留列都必须**整份被拒**。

---

## 5. 缺陷与延后项

- **`verify:sql` 只覆盖 SQL 层**。它证明迁移跑得起来，但 PostgREST 的 schema cache 什么时候刷新、
  GoTrue 的会话怎么带进 RPC、连接池会不会把 `set local` 的作用域搞乱——都要真实项目才能验。
- **`stage6` 是只追加迁移，未在真实项目上执行过**。本机临时集群里它是从空库顺序跑通的，
  真实项目里可能已有数据，`create or replace function` 与授权语句的幂等性只做过静态复核。
- **`saveMeals` 的读-改-写仍是两次调用**（`docs/24` §5 的已知残余，本轮未动）。
- **`docs/24` 里列的三处同类残余**同样未动。

---

## 6. 未验证项（本阶段剩下的全部工作）

1. **真实项目上跑一次完整往返**：本地导出 → 上传云端 → 清空本地 → 从云端恢复 → 逐项核对。
   前置条件是真实 Supabase 凭据（`.env.local`）。
2. **六个迁移在真实项目上的执行**（按文件名顺序）+ 核对表 / 策略 / 触发器 / 授权。
3. **关闭邮箱验证（或配好 SMTP）**，否则 `signUp` 拿不到会话——适配器会明确报错，不会假装登录成功。
4. **真实链路**：注册 / 登录 / 刷新恢复 / 断网失败 / RLS 双账号隔离。
5. **真机 PWA**（`docs/19` §5 的 S6-T4 清单里那部分）。
6. **`crypto.randomUUID` 回退分支下的上传**：`replaceRules.ts` 会拦下并给出可读理由，
   但「拦下之后用户怎么办」这条路径只在单测里走过，没在真机浏览器上验过。

---

## 7. 对下一阶段（S6）的影响

- **S6-T3（Supabase Auth 配置）与 S6-T4（真实凭据人工清单）现在是唯一的阻塞项**，
  它们没有代码可写，只有凭据与环境。
- **S6-T5（文档收口）** 里要补的活文档已在本轮同步过一遍（`README.md` / `HANDOFF.md` / `docs/19`），
  剩下的是把 S6 自己的执行结果写进 `docs/26`。
- **本机验收的完整清单现在有九条**：`typecheck`、`lint`、`build`、五个 `check:*`、
  三个 `verify:*`（local / pwa / sync）+ `verify:sql`。其中 `verify:sql` 需要本机 PostgreSQL，
  所以它不在 `all` 里，要单独跑。
